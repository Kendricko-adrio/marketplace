import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";

import {
  createScratchDatabase,
  resolveTestDatabaseUrl,
  runMigrate,
  type ScratchDatabase,
} from "../testing/disposable-database";

// =========================================================
// Public CLI coverage on a disposable PostgreSQL database.
//
// Every assertion goes through the real CLI process and the real migration
// runner. Requires a dedicated TEST_DATABASE_URL (database name must look like
// a test database); otherwise the suite is skipped instead of touching a
// developer database.
// =========================================================

const baseUrl = resolveTestDatabaseUrl();
const describeDb = baseUrl ? describe : describe.skip;
const DB_PACKAGE_DIR = path.resolve(__dirname, "../..");

let scratch!: ScratchDatabase;
let configDir!: string;

function runCli(
  args: string[],
  env: Record<string, string | undefined> = {}
) {
  const result = spawnSync(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["tsx", "src/production-bootstrap.ts", ...args],
    {
      cwd: DB_PACKAGE_DIR,
      env: {
        ...process.env,
        DATABASE_URL: scratch.appUrl,
        APP_ENV: "production",
        ...env,
      },
      encoding: "utf8",
      shell: process.platform === "win32",
      timeout: 120_000,
    }
  );
  return {
    status: result.status,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

function runOwnerCli(args: string[], env: Record<string, string | undefined> = {}) {
  const result = spawnSync(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["tsx", "src/bootstrap-owner.ts", ...args],
    {
      cwd: DB_PACKAGE_DIR,
      env: { ...process.env, DATABASE_URL: scratch.appUrl, ...env },
      encoding: "utf8",
      shell: process.platform === "win32",
      timeout: 120_000,
    }
  );
  return {
    status: result.status,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

function runCliAsync(
  args: string[],
  env: Record<string, string | undefined> = {}
): Promise<{ status: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.platform === "win32" ? "npx.cmd" : "npx",
      ["tsx", "src/production-bootstrap.ts", ...args],
      {
        cwd: DB_PACKAGE_DIR,
        env: {
          ...process.env,
          DATABASE_URL: scratch.appUrl,
          APP_ENV: "production",
          ...env,
        },
        shell: process.platform === "win32",
      }
    );
    let output = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, output }));
  });
}

function writeConfig(overrides: Record<string, unknown> = {}): string {
  const file = path.join(
    configDir,
    `bootstrap-${Math.random().toString(36).slice(2, 8)}.json`
  );
  writeFileSync(
    file,
    `${JSON.stringify(
      {
        version: 1,
        expectedDatabase: scratch.database,
        systemConfig: {
          reservationTtlMinutes: 15,
          taxPpnRatePercent: 11,
          discountsContractVersion: 0,
        },
        ...overrides,
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  return file;
}

async function query<T extends Record<string, unknown>>(
  text: string,
  values: unknown[] = []
): Promise<T[]> {
  const client = new Client({ connectionString: scratch.appUrl });
  await client.connect();
  try {
    const result = await client.query(text, values);
    return result.rows as T[];
  } finally {
    await client.end();
  }
}

describeDb("production bootstrap CLI (disposable database)", () => {
  beforeAll(async () => {
    scratch = await createScratchDatabase(baseUrl as string);
    configDir = mkdtempSync(path.join(tmpdir(), "bootstrap-config-"));
    const migrate = runMigrate(scratch.appUrl);
    if (migrate.status !== 0) {
      throw new Error(
        `release migration failed on the disposable database:\n${migrate.stderr}`
      );
    }
  }, 300_000);

  afterAll(async () => {
    if (scratch) await scratch.drop();
  }, 60_000);

  it("refuses a wrong target before any write", () => {
    const config = writeConfig({ expectedDatabase: "some_other_production" });
    const result = runCli([
      "preflight",
      "--config",
      config,
      "--phase",
      "before-migrate",
    ]);

    expect(result.status).toBe(2);
    expect(result.output).toContain("PRODUCTION_TARGET_MISMATCH");
  });

  it.each([
    { APP_ENV: "production", NODE_ENV: "production" },
    { APP_ENV: "staging", NODE_ENV: "production" },
  ])("accepts the migrated release in the after-migrate preflight: %o", (environment) => {
    const config = writeConfig();
    const result = runCli([
      "preflight",
      "--config",
      config,
      "--phase",
      "after-migrate",
    ], environment);

    expect(result.output).toContain("PREFLIGHT_OK");
    expect(result.status).toBe(0);
  });

  it("seeds only system references and serializes concurrent first seeds", async () => {
    const config = writeConfig();
    // Two first seeds at once: the transaction advisory lock must serialize
    // them — exactly one initializes, the other reports a no-op.
    const [first, second] = await Promise.all([
      runCliAsync(["seed", "--config", config]),
      runCliAsync(["seed", "--config", config]),
    ]);

    expect([first.status, second.status]).toEqual([0, 0]);
    const outputs = [first.output, second.output];
    expect(
      outputs.filter((output) => output.includes("REFERENCE_SEED_APPLIED"))
    ).toHaveLength(1);
    expect(
      outputs.filter((output) =>
        output.includes("REFERENCE_SEED_ALREADY_APPLIED")
      )
    ).toHaveLength(1);

    const marker = await query<{ value: string }>(
      "select value from system_config where key = 'production.bootstrapReferenceVersion'"
    );
    expect(marker[0]?.value).toBe("1");
    const paused = await query<{ value: string }>(
      "select value from system_config where key = 'checkout.paused'"
    );
    expect(paused[0]?.value).toBe("true");

    for (const table of ["user", "client", "product", "orders"]) {
      const [row] = await query<{ count: number }>(
        `select count(*)::int as count from "${table}"`
      );
      expect(row.count).toBe(0);
    }
    const hq = await query<{ id: string; jubelio_location_id: number | null }>(
      "select id, jubelio_location_id from branch where code = 'HQ'"
    );
    expect(hq).toHaveLength(1);
    expect(hq[0]?.jubelio_location_id).toBeNull();
  });

  it("keeps operator changes on rerun instead of repairing them", async () => {
    await query("update system_config set value = 'false' where key = 'checkout.paused'");
    await query(
      "delete from admin_role_grant where role_id = (select id from admin_role where key = 'hq') and module = 'prices'"
    );
    await query(
      "update branch set operating_hours = '{\"monday\":{\"open\":\"09:00\",\"close\":\"21:00\"}}'::jsonb where code = 'HQ'"
    );

    const config = writeConfig();
    const result = runCli(["seed", "--config", config]);

    expect(result.output).toContain("REFERENCE_SEED_ALREADY_APPLIED");
    expect(result.status).toBe(0);

    const paused = await query<{ value: string }>(
      "select value from system_config where key = 'checkout.paused'"
    );
    expect(paused[0]?.value).toBe("false");
    const revoked = await query<{ count: number }>(
      "select count(*)::int as count from admin_role_grant where role_id = (select id from admin_role where key = 'hq') and module = 'prices'"
    );
    expect(revoked[0]?.count).toBe(0);
    const hours = await query<{ operating_hours: Record<string, unknown> }>(
      "select operating_hours from branch where code = 'HQ'"
    );
    expect(hours[0]?.operating_hours).toEqual({
      monday: { open: "09:00", close: "21:00" },
    });
  });

  it("creates one Owner from a mounted secret file and never resets it", async () => {
    const secretFile = path.join(configDir, "owner_password");
    writeFileSync(secretFile, "owner-secret-from-file\n", { encoding: "utf8", mode: 0o600 });

    const first = runOwnerCli([
      "--name",
      "System Owner",
      "--email",
      "owner@example.invalid",
      "--username",
      "owner",
      "--expected-database",
      scratch.database,
      "--password-file",
      secretFile,
    ]);
    expect(first.status).toBe(0);
    expect(first.output).not.toContain("owner-secret-from-file");

    const owners = await query<{ must_reset_password: boolean; password: string }>(
      `select u.must_reset_password, a.password
       from "user" u
       join admin_role r on r.id = u.role_id
       join admin_account a on a.user_id = u.id and a.provider_id = 'credential'
       where r.key = 'system_owner'`
    );
    expect(owners).toHaveLength(1);
    expect(owners[0]?.must_reset_password).toBe(true);

    const second = runOwnerCli([
      "--name",
      "System Owner",
      "--email",
      "owner@example.invalid",
      "--username",
      "owner",
      "--expected-database",
      scratch.database,
      "--password-file",
      secretFile,
    ]);
    expect(second.status).toBe(1);
    expect(second.output).toContain("OWNER_EXISTS");

    const after = await query<{ password: string }>(
      `select a.password from admin_account a
       join "user" u on u.id = a.user_id
       join admin_role r on r.id = u.role_id
       where r.key = 'system_owner'`
    );
    expect(after[0]?.password).toBe(owners[0]?.password);
  });

  it("reports an incomplete bootstrap when the import evidence is missing", async () => {
    const config = writeConfig();
    const reportFile = path.join(configDir, "import-missing.json");
    writeFileSync(
      reportFile,
      JSON.stringify({
        formatVersion: 1,
        runId: "fixture-run",
        database: scratch.database,
        status: "incomplete",
        finishedAt: null,
        counts: { sourceProductGroups: 0, sourceSkus: 1 },
        source: { productGroupIds: [], skuIds: [] },
      }),
      "utf8"
    );

    const result = runCli([
      "verify",
      "--config",
      config,
      "--import-report",
      reportFile,
    ]);

    expect(result.output).toContain("BOOTSTRAP_INCOMPLETE");
    expect(result.status).toBe(4);
  });

  it("refuses to run without an explicit production environment", () => {
    const config = writeConfig();
    const result = runCli(["seed", "--config", config], {
      APP_ENV: "staging",
      NODE_ENV: "development",
    });

    expect(result.status).toBe(2);
    expect(result.output).toContain("PRODUCTION_ENV_REQUIRED");
  });
});

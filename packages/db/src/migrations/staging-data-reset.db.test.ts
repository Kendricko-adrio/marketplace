import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { createScratchDatabase, resolveTestDatabaseUrl, runMigrate, type ScratchDatabase } from "../testing/disposable-database";

const base = resolveTestDatabaseUrl();
const root = path.resolve(__dirname, "../../../..");
const packageDirectory = path.resolve(__dirname, "../..");
const resetFile = path.join(root, "deployment/staging/reset-data.sql");
const cli = path.join(root, "node_modules/drizzle-kit/bin.cjs");
let scratch: ScratchDatabase;
let temporary: string;

async function query(text: string, values: unknown[] = [], url = scratch.appUrl) {
  const client = new Client({ connectionString: url });
  await client.connect();
  try { return (await client.query(text, values)).rows; }
  finally { await client.end(); }
}

async function reset(overrides: Record<string, string> = {}, url = scratch.appUrl) {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    for (const [key, value] of Object.entries({
      "app.deployment_environment": "staging",
      "app.staging_reset_expected_database": scratch.database,
      "app.staging_reset_expected_role": scratch.role,
      "app.staging_reset_confirmation": scratch.database,
      ...overrides,
    })) await client.query("select set_config($1, $2, false)", [key, value]);
    await client.query(readFileSync(resetFile, "utf8"));
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
}

(base ? describe : describe.skip)("public staging reset SQL on disposable PostgreSQL", () => {
  beforeAll(async () => {
    scratch = await createScratchDatabase(base as string);
    temporary = mkdtempSync(path.join(tmpdir(), "staging-upgrade-test-"));
    // Build the historical 0015 baseline with the REAL migrator, not manual SQL replay.
    const migrations = path.join(temporary, "drizzle");
    mkdirSync(path.join(migrations, "meta"), { recursive: true });
    const release = path.join(packageDirectory, "drizzle");
    const journal = JSON.parse(readFileSync(path.join(release, "meta/_journal.json"), "utf8"));
    const baseline = { ...journal, entries: journal.entries.slice(0, 16) };
    writeFileSync(path.join(migrations, "meta/_journal.json"), JSON.stringify(baseline));
    for (const entry of baseline.entries) copyFileSync(path.join(release, `${entry.tag}.sql`), path.join(migrations, `${entry.tag}.sql`));
    const config = path.join(temporary, "baseline.config.ts");
    writeFileSync(config, `export default ${JSON.stringify({ dialect: "postgresql", out: migrations, dbCredentials: { url: scratch.appUrl } })};`);
    const first = spawnSync(process.execPath, [cli, "migrate", `--config=${config}`], { cwd: packageDirectory, encoding: "utf8", timeout: 120_000 });
    expect(first.status, first.stderr).toBe(0);
    expect((await query('select count(*)::int as count from drizzle.__drizzle_migrations'))[0].count).toBe(16);
    await query("insert into branch(id,name,code,city,address) values ('legacy-branch','Legacy','LEGACY','Test','Fixture')");
    await query(`insert into "user"(id,name,username,email,role,branch_id) values ('legacy-user','Legacy','legacy','legacy@example.invalid','admin','legacy-branch')`);
    const upgrade = runMigrate(scratch.appUrl);
    expect(upgrade.status, upgrade.stderr).toBe(0);
    expect((await query('select count(*)::int as count from drizzle.__drizzle_migrations'))[0].count).toBe(59);
    await query("create table staging_reset_canary(id integer primary key); insert into staging_reset_canary values (1)");
  }, 300_000);

  afterAll(async () => {
    if (scratch) await scratch.drop();
    if (temporary) rmSync(temporary, { recursive: true, force: true });
  }, 60_000);

  it.each([
    { "app.deployment_environment": "production" },
    { "app.deployment_environment": "" },
    { "app.staging_reset_expected_database": "wrong_database" },
    { "app.staging_reset_expected_database": "" },
    { "app.staging_reset_expected_role": "wrong_role" },
    { "app.staging_reset_expected_role": "" },
    { "app.staging_reset_confirmation": "wrong_confirmation" },
    { "app.staging_reset_confirmation": "" },
  ])("refuses incorrect or missing session settings without losing canary data: %o", async (settings) => {
    await expect(reset(settings as Record<string, string>)).rejects.toThrow(/STAGING_RESET_REFUSED/);
    expect(await query("select id from staging_reset_canary")).toEqual([{ id: 1 }]);
  });

  it("refuses superuser even when expected role matches", async () => {
    await expect(reset({ "app.staging_reset_expected_role": decodeURIComponent(new URL(scratch.url).username) }, scratch.url))
      .rejects.toThrow(/superuser forbidden/);
    expect(await query("select id from staging_reset_canary")).toEqual([{ id: 1 }]);
  });

  it("refuses missing migration journal before truncation", async () => {
    await query("alter schema drizzle rename to saved_drizzle");
    try { await expect(reset()).rejects.toThrow(/migration journal required/); }
    finally { await query("alter schema saved_drizzle rename to drizzle"); }
    expect(await query("select id from staging_reset_canary")).toEqual([{ id: 1 }]);
  });

  it("never cascades to a foreign schema or the journal", async () => {
    await query("create schema outside_scope; create table outside_scope.dependent(id int references public.staging_reset_canary(id)); insert into outside_scope.dependent values (1)");
    try {
      await expect(reset()).rejects.toThrow(/dependency outside public/);
      expect(await query("select id from outside_scope.dependent")).toEqual([{ id: 1 }]);
      expect((await query('select count(*)::int as count from drizzle.__drizzle_migrations'))[0].count).toBe(59);
    } finally { await query("drop schema outside_scope cascade"); }
  });

  it("rolls back all application truncations if any table rejects the reset", async () => {
    await query(`create function reject_test_truncate() returns trigger language plpgsql as $$ begin raise exception 'TEST_TRUNCATE_REJECTED'; end $$;
      create trigger refuse_reset after truncate on staging_reset_canary execute function reject_test_truncate()`);
    try {
      await expect(reset()).rejects.toThrow(/TEST_TRUNCATE_REJECTED/);
      expect(await query("select id from staging_reset_canary")).toEqual([{ id: 1 }]);
      expect((await query("select count(*)::int as count from branch"))[0].count).toBe(1);
      expect((await query('select count(*)::int as count from "user"'))[0].count).toBe(1);
    } finally { await query("drop trigger refuse_reset on staging_reset_canary; drop function reject_test_truncate()"); }
  });

  it("truncates application data atomically but preserves schema/journal, migrator no-op and reference reseed", async () => {
    const journal = await query('select id,hash,created_at from drizzle.__drizzle_migrations order by id');
    const structure = await query("select oid,relname from pg_class where relnamespace='public'::regnamespace and relkind in ('r','i','p') order by oid");
    await reset();
    const tables = await query("select tablename from pg_tables where schemaname='public' order by tablename");
    for (const { tablename } of tables) {
      const escaped = String(tablename).replaceAll('"', '""');
      expect((await query(`select count(*)::int as count from "${escaped}"`))[0].count, tablename).toBe(0);
    }
    expect(await query('select id,hash,created_at from drizzle.__drizzle_migrations order by id')).toEqual(journal);
    expect(await query("select oid,relname from pg_class where relnamespace='public'::regnamespace and relkind in ('r','i','p') order by oid")).toEqual(structure);
    const rerun = runMigrate(scratch.appUrl);
    expect(rerun.status, rerun.stderr).toBe(0);
    expect(await query('select id,hash,created_at from drizzle.__drizzle_migrations order by id')).toEqual(journal);
    const config = path.join(temporary, "bootstrap.json");
    writeFileSync(config, JSON.stringify({ version: 1, expectedDatabase: scratch.database,
      systemConfig: { reservationTtlMinutes: 15, taxPpnRatePercent: 11, discountsContractVersion: 0 } }));
    const seed = spawnSync(process.execPath, [path.join(root, "node_modules/tsx/dist/cli.mjs"), "src/production-bootstrap.ts", "seed", "--config", config], {
      cwd: packageDirectory, env: { ...process.env, DATABASE_URL: scratch.appUrl, NODE_ENV: "production", APP_ENV: "staging" }, encoding: "utf8", timeout: 120_000,
    });
    expect(seed.status, seed.stderr).toBe(0);
    expect(seed.stdout).toContain("REFERENCE_SEED_APPLIED");
    expect((await query('select count(*)::int as count from "user"'))[0].count).toBe(0);
    expect((await query("select value from system_config where key='checkout.paused'"))[0].value).toBe("true");
  }, 300_000);
});

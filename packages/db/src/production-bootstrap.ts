// =========================================================
// Production bootstrap CLI — preflight / seed / verify
// =========================================================
// Deliberately does NOT load a development `.env`: the manifest path and every
// credential are explicit inputs from the operator/container environment.
// Exit codes: 0 ok, 2 refused input/target/precondition, 3 dependency failure,
// 4 incomplete verification.

import { readFile } from "node:fs/promises";

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema";
import { createModuleLogger, withExecutionContext } from "./logger";
import {
  BOOTSTRAP_EXIT,
  ProductionBootstrapInputError,
  parseProductionBootstrapInput,
  validateProductionBootstrapConfig,
} from "./production-bootstrap/bootstrap-input";
import {
  loadReleaseMigrations,
  resolveMigrationsDir,
  type BootstrapDb,
} from "./production-bootstrap/production-bootstrap-repository";
import { preflightProduction } from "./production-bootstrap/preflight-production-service";
import { seedProductionReferenceData } from "./production-bootstrap/seed-production-reference-service";
import { verifyProductionBootstrap } from "./production-bootstrap/verify-production-service";

const log = createModuleLogger("production-bootstrap");

class Refusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Refusal";
  }
}

async function readJsonFile(path: string, what: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch {
    throw new Refusal(`${what} could not be read as JSON: ${path}`);
  }
}

async function runPreflight(
  db: BootstrapDb,
  input: ReturnType<typeof parseProductionBootstrapInput>,
  config: ReturnType<typeof validateProductionBootstrapConfig>
) {
  const report = await preflightProduction(
    {
      phase: input.phase ?? "before-migrate",
      config,
      migrations: loadReleaseMigrations(resolveMigrationsDir()),
    },
    { db }
  );
  for (const check of report.checks) {
    if (!check.ok) {
      log.warn(`preflight ${check.id} gagal: ${check.detail ?? "tidak diketahui"}`);
    }
  }
  log.info(
    `kode=${report.code} phase=${report.phase} database=${report.database} role=${report.role}`
  );
  return report.code === "PREFLIGHT_OK"
    ? BOOTSTRAP_EXIT.ok
    : BOOTSTRAP_EXIT.refused;
}

async function runSeed(
  db: BootstrapDb,
  config: ReturnType<typeof validateProductionBootstrapConfig>
) {
  const result = await seedProductionReferenceData({ config }, { db });
  if (result.refusal) {
    log.error(
      `kode=${result.code} reason=${result.refusal.code} keys=${result.refusal.keys.join(",")}`
    );
    log.error(result.refusal.message);
    return BOOTSTRAP_EXIT.refused;
  }
  if (result.written) {
    log.info(
      `kode=${result.code} marker=${result.marker} roles=${result.written.roles} grants=${result.written.grants} branches=${result.written.branches} config_rows=${result.written.configRows}`
    );
  } else {
    log.info(`kode=${result.code} marker=${result.marker}`);
  }
  if (result.preservedConfigKeys.length > 0) {
    log.info(
      `config existing dipertahankan: ${result.preservedConfigKeys.join(", ")}`
    );
  }
  return BOOTSTRAP_EXIT.ok;
}

async function runVerify(
  db: BootstrapDb,
  input: ReturnType<typeof parseProductionBootstrapInput>,
  config: ReturnType<typeof validateProductionBootstrapConfig>
) {
  if (input.importReportPath === null) {
    throw new Refusal("verify requires --import-report <file>");
  }
  const importReport = await readJsonFile(
    input.importReportPath,
    "import report"
  );
  const report = await verifyProductionBootstrap(
    {
      config,
      migrations: loadReleaseMigrations(resolveMigrationsDir()),
      importReport,
      environment: process.env,
    },
    { db }
  );

  for (const check of report.checks) {
    if (!check.ok) log.warn(`verifikasi ${check.id} gagal: ${check.detail ?? "tidak diketahui"}`);
  }
  log.info(`kode=${report.code} database=${report.database} role=${report.role}`);
  if (report.launchBlockers.length > 0) {
    log.info(
      `launch blockers (bukan bukti siap live): ${report.launchBlockers.join(" | ")}`
    );
  }
  return report.code === "BOOTSTRAP_VERIFIED"
    ? BOOTSTRAP_EXIT.ok
    : BOOTSTRAP_EXIT.incomplete;
}

async function main(): Promise<number> {
  const input = parseProductionBootstrapInput(process.argv.slice(2), process.env);
  const config = validateProductionBootstrapConfig(
    await readJsonFile(input.configPath, "bootstrap config")
  );

  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Refusal("DATABASE_URL is required for a production bootstrap");
  }

  const pool = new Pool({ connectionString: databaseUrl, max: 2 });
  const db = drizzle(pool, { schema }) as unknown as BootstrapDb;
  try {
    switch (input.subcommand) {
      case "preflight":
        return await runPreflight(db, input, config);
      case "seed":
        return await runSeed(db, config);
      case "verify":
        return await runVerify(db, input, config);
    }
  } finally {
    await pool.end();
  }
}

void withExecutionContext(async () => {
  try {
    process.exitCode = await main();
  } catch (error: unknown) {
    if (error instanceof ProductionBootstrapInputError) {
      log.error(`kode=${error.code} ${error.message}`);
      process.exitCode = BOOTSTRAP_EXIT.refused;
      return;
    }
    if (error instanceof Refusal) {
      log.error(`kode=BOOTSTRAP_REFUSED ${error.message}`);
      process.exitCode = BOOTSTRAP_EXIT.refused;
      return;
    }
    log.error(
      `kode=BOOTSTRAP_FAILED ${error instanceof Error ? error.message : "unexpected error"}`,
      error
    );
    process.exitCode = BOOTSTRAP_EXIT.failed;
  }
});

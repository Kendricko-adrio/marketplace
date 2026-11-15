import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "../schema";
import {
  inspectMigrationState,
  inspectSchemaContract,
  loadReleaseMigrations,
  resolveMigrationsDir,
  type BootstrapDb,
} from "../production-bootstrap/production-bootstrap-repository";
import {
  createScratchDatabase,
  resolveTestDatabaseUrl,
  runMigrate,
  type ScratchDatabase,
} from "../testing/disposable-database";

// =========================================================
// Fresh-install rehearsal with the REAL release migration runner.
//
// Proves that the audited chain (0000 → latest) builds the schema on an empty
// PostgreSQL database and that a second `drizzle-kit migrate` is a no-op.
// Skipped unless TEST_DATABASE_URL points at a test database.
// =========================================================

const baseUrl = resolveTestDatabaseUrl();
const describeDb = baseUrl ? describe : describe.skip;

let scratch: ScratchDatabase;
let pool: Pool;
let db: BootstrapDb;

describeDb("fresh production migration rehearsal", () => {
  beforeAll(async () => {
    scratch = await createScratchDatabase(baseUrl as string);
    pool = new Pool({ connectionString: scratch.appUrl });
    db = drizzle(pool, { schema }) as unknown as BootstrapDb;
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    if (scratch) await scratch.drop();
  }, 60_000);

  it("builds the release schema from empty and is a no-op on the second run", async () => {
    const release = loadReleaseMigrations(resolveMigrationsDir());

    const first = runMigrate(scratch.appUrl);
    expect(first.status, first.stderr).toBe(0);

    const afterFirst = await inspectMigrationState(db, release);
    expect(afterFirst.journalPresent).toBe(true);
    expect(afterFirst.appliedCount).toBe(release.length);
    expect(afterFirst.missingTags).toEqual([]);
    expect(afterFirst.unknownAppliedHashes).toEqual([]);
    expect(afterFirst.appTablesPresent).toEqual([
      "admin_role",
      "branch",
      "client",
      "orders",
      "product",
      "system_config",
      "user",
    ]);
    expect(await inspectSchemaContract(db)).toEqual([]);

    const second = runMigrate(scratch.appUrl);
    expect(second.status, second.stderr).toBe(0);

    const afterSecond = await inspectMigrationState(db, release);
    expect(afterSecond.appliedCount).toBe(afterFirst.appliedCount);
    expect(afterSecond.missingTags).toEqual([]);
    expect(afterSecond.unknownAppliedHashes).toEqual([]);
    expect(afterSecond.journalPresent).toBe(true);
  }, 300_000);
});

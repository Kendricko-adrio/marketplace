// Test-only helper for disposable PostgreSQL bootstrap coverage.
//
// Safety rules:
//   - The base URL comes from TEST_DATABASE_URL (never the developer's .env).
//   - Its database name must look like a test database; otherwise this module
//     refuses to run rather than dropping user data.
//   - Each suite creates and drops its own scratch database, so a failed run
//     cannot leave the base test database in a half-migrated state.

import { spawnSync } from "node:child_process";
import path from "node:path";

import { Client } from "pg";

const SAFE_TEST_DATABASE = /(?:^|[_-])test(?:$|[_-])/i;

export interface ScratchDatabase {
  /** Superuser/admin URL used only for create/drop of the scratch database. */
  url: string;
  /** Non-superuser role that owns the database — the production-like target. */
  appUrl: string;
  database: string;
  role: string;
  drop(): Promise<void>;
}

/** Validated base test URL, or null when TEST_DATABASE_URL is not set. */
export function resolveTestDatabaseUrl(): string | null {
  const raw = process.env.TEST_DATABASE_URL?.trim();
  if (!raw) return null;
  const parsed = new URL(raw);
  const database = parsed.pathname.replace(/^\//, "");
  if (!SAFE_TEST_DATABASE.test(database)) {
    throw new Error(
      `TEST_DATABASE_URL database "${database}" is not a test database; refusing to create/drop data`
    );
  }
  return raw;
}

async function connect(url: string, database: string): Promise<Client> {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  const client = new Client({ connectionString: parsed.toString() });
  await client.connect();
  return client;
}

export async function createScratchDatabase(
  baseUrl: string
): Promise<ScratchDatabase> {
  const base = new URL(baseUrl);
  const baseDatabase = base.pathname.replace(/^\//, "");
  const suffix = `${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  const database = `${baseDatabase.slice(0, 36)}_${suffix}`;
  const role = `bt_${suffix}`;
  const password = Math.random().toString(36).slice(2, 14);

  const admin = await connect(baseUrl, baseDatabase);
  try {
    await admin.query(`CREATE ROLE "${role}" LOGIN PASSWORD '${password}' NOSUPERUSER`);
    await admin.query(`CREATE DATABASE "${database}" OWNER "${role}"`);
  } finally {
    await admin.end();
  }

  const appUrl = new URL(baseUrl);
  appUrl.username = role;
  appUrl.password = password;
  appUrl.pathname = `/${database}`;

  return {
    url: (() => {
      const url = new URL(baseUrl);
      url.pathname = `/${database}`;
      return url.toString();
    })(),
    appUrl: appUrl.toString(),
    database,
    role,
    async drop() {
      const cleanup = await connect(baseUrl, baseDatabase);
      try {
        await cleanup.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
        await cleanup.query(`DROP ROLE IF EXISTS "${role}"`);
      } finally {
        await cleanup.end();
      }
    },
  };
}

export interface MigrateResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

const DB_PACKAGE_DIR = path.resolve(__dirname, "../..");

/**
 * Run the real release migrator (`drizzle-kit migrate`) against a disposable
 * database. This is the runner the production container uses — a hand-rolled
 * SQL replay would not prove the real path.
 */
export function runMigrate(databaseUrl: string): MigrateResult {
  const result = spawnSync(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["drizzle-kit", "migrate"],
    {
      cwd: DB_PACKAGE_DIR,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      encoding: "utf8",
      shell: process.platform === "win32",
      timeout: 300_000,
    }
  );
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

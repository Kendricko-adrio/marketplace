// =========================================================
// Production bootstrap persistence + introspection
// =========================================================
// All database access for the one-shot bootstrap commands lives here: target
// identity, migration history, the atomic reference seed, and the read
// projections used by the verifier. Services decide allow/refuse; this module
// returns typed facts and performs the transaction.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import * as schema from "../schema";
import { ensureInitialRoles } from "../rbac/ensure-roles";
import { hqBranchSeedRow } from "../seed-hq";
import {
  CONTRACT_CONFIG_KEYS,
  REFERENCE_MARKER_KEY,
  REFERENCE_MARKER_VERSION,
  type ProductionBootstrapConfig,
  type TargetIdentity,
} from "./bootstrap-input";

export type BootstrapDb = NodePgDatabase<typeof schema>;

export interface ReleaseMigration {
  tag: string;
  hash: string;
  folderMillis: number;
}

/** Migration files shipped with this release (audit record + history hashes). */
export function loadReleaseMigrations(
  migrationsDir: string
): ReleaseMigration[] {
  const journalPath = path.join(migrationsDir, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
    entries: Array<{ tag: string; when: number }>;
  };
  return journal.entries.map((entry) => {
    const filePath = path.join(migrationsDir, `${entry.tag}.sql`);
    const content = readFileSync(filePath, "utf8");
    return {
      tag: entry.tag,
      hash: createHash("sha256").update(content).digest("hex"),
      folderMillis: entry.when,
    };
  });
}

/** Default location of the shipped migrations (src/ and dist/ share depth). */
export function resolveMigrationsDir(): string {
  return path.resolve(__dirname, "../../drizzle");
}

/** Tables the bootstrap and the running application require after migration. */
export const REQUIRED_SCHEMA_OBJECTS: ReadonlyArray<readonly [string, string]> =
  [
    ["admin_role", "key"],
    ["admin_role_grant", "module"],
    ["branch", "jubelio_location_id"],
    ["branch_stock", "reserved_stock"],
    ["client", "email"],
    ["order_item", "order_id"],
    ["orders", "status"],
    ["product", "jubelio_item_group_id"],
    ["product_to_category", "product_id"],
    ["product_variant", "jubelio_item_id"],
    ["system_config", "value"],
    ["user", "must_reset_password"],
  ];

const APP_TABLES = [
  "admin_role",
  "branch",
  "client",
  "orders",
  "product",
  "system_config",
  "user",
] as const;

export async function readTargetIdentity(
  db: BootstrapDb
): Promise<TargetIdentity> {
  const result = await db.execute<{
    database: string;
    role: string;
    is_superuser: boolean;
    can_create: boolean;
  }>(sql`
    select
      current_database() as database,
      current_user as role,
      coalesce((select rolsuper from pg_roles where rolname = current_user), true) as is_superuser,
      coalesce(has_schema_privilege(current_user, 'public', 'CREATE'), false) as can_create
  `);
  const row = result.rows[0];
  if (!row) {
    throw new Error("could not read the target database identity");
  }
  return {
    database: row.database,
    role: row.role,
    isSuperuser: row.is_superuser,
    canCreateInPublic: row.can_create,
  };
}

export interface MigrationState {
  journalPresent: boolean;
  appliedCount: number;
  expectedCount: number;
  missingTags: string[];
  unknownAppliedHashes: string[];
  appTablesPresent: string[];
}

async function readAppliedMigrationHashes(
  db: BootstrapDb
): Promise<string[] | null> {
  const table = await db.execute<{ present: boolean }>(sql`
    select to_regclass('drizzle.__drizzle_migrations') is not null as present
  `);
  if (!table.rows[0]?.present) return null;

  const applied = await db.execute<{ hash: string }>(sql`
    select hash from drizzle."__drizzle_migrations" order by id
  `);
  return applied.rows.map((row) => row.hash);
}

export async function inspectMigrationState(
  db: BootstrapDb,
  release: readonly ReleaseMigration[]
): Promise<MigrationState> {
  const appliedHashes = await readAppliedMigrationHashes(db);
  const applied = appliedHashes ?? [];
  const expected = new Set(release.map((migration) => migration.hash));
  const appliedSet = new Set(applied);

  const tables = await db.execute<{ table_name: string }>(sql`
    select table_name
    from information_schema.tables
    where table_schema = 'public'
      and table_name in (${sql.join(
        APP_TABLES.map((name) => sql`${name}`),
        sql`, `
      )})
    order by table_name
  `);

  return {
    journalPresent: appliedHashes !== null,
    appliedCount: applied.length,
    expectedCount: release.length,
    missingTags: release
      .filter((migration) => !appliedSet.has(migration.hash))
      .map((migration) => migration.tag),
    unknownAppliedHashes: applied.filter((hash) => !expected.has(hash)),
    appTablesPresent: tables.rows.map((row) => row.table_name),
  };
}

export async function inspectSchemaContract(
  db: BootstrapDb
): Promise<string[]> {
  const missing: string[] = [];
  for (const [table, column] of REQUIRED_SCHEMA_OBJECTS) {
    const result = await db.execute<{ present: boolean }>(sql`
      select exists (
        select 1 from information_schema.columns
        where table_schema = 'public'
          and table_name = ${table}
          and column_name = ${column}
      ) as present
    `);
    if (!result.rows[0]?.present) missing.push(`${table}.${column}`);
  }
  return missing;
}

export type ReferenceSeedResult =
  | {
      kind: "applied";
      marker: number;
      written: {
        roles: number;
        grants: number;
        branches: number;
        configRows: number;
      };
      preservedConfigKeys: string[];
    }
  | { kind: "already-applied"; marker: number }
  | {
      kind: "refused";
      code:
        | "OPERATIONAL_DATA_PRESENT"
        | "MARKER_UNKNOWN_VERSION"
        | "CONFIG_DRIFT";
      message: string;
      keys: string[];
    };

/**
 * First reference seed: Initial Roles/grants, the local HQ branch, and the
 * production system config, plus the bootstrap marker — all in one transaction
 * behind an advisory lock.
 *
 * Re-running is a no-op: no grant, config value, branch or marker is rewritten,
 * so a deliberate operator change survives. A marker is only treated as a fresh
 * initialization when no operational data exists yet.
 */
export async function initializeProductionReferences(
  db: BootstrapDb,
  config: ProductionBootstrapConfig
): Promise<ReferenceSeedResult> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext('production_reference_seed'))`
    );

    const existingMarker = await tx
      .select({ value: schema.systemConfig.value })
      .from(schema.systemConfig)
      .where(sql`${schema.systemConfig.key} = ${REFERENCE_MARKER_KEY}`)
      .limit(1);

    if (existingMarker.length > 0) {
      const raw = existingMarker[0].value.trim();
      const parsed = Number(raw);
      if (!Number.isInteger(parsed) || parsed !== REFERENCE_MARKER_VERSION) {
        return {
          kind: "refused",
          code: "MARKER_UNKNOWN_VERSION",
          message: `existing bootstrap marker version "${raw}" is not understood by this release`,
          keys: [REFERENCE_MARKER_KEY],
        };
      }
      return { kind: "already-applied", marker: parsed };
    }

    const operationalRows = await tx.execute<{
      users: number;
      clients: number;
      products: number;
      orders: number;
    }>(sql`
      select
        (select count(*)::int from ${sql.identifier("user")}) as users,
        (select count(*)::int from ${sql.identifier("client")}) as clients,
        (select count(*)::int from ${sql.identifier("product")}) as products,
        (select count(*)::int from ${sql.identifier("orders")}) as orders
    `);
    const counts = operationalRows.rows[0];
    const operational = [
      (counts?.users ?? 0) > 0 ? "user" : null,
      (counts?.clients ?? 0) > 0 ? "client" : null,
      (counts?.products ?? 0) > 0 ? "product" : null,
      (counts?.orders ?? 0) > 0 ? "orders" : null,
    ].filter((value): value is string => value !== null);
    if (operational.length > 0) {
      return {
        kind: "refused",
        code: "OPERATIONAL_DATA_PRESENT",
        message:
          "a missing bootstrap marker on a database with operational data requires manual audit; this is not a fresh database",
        keys: operational,
      };
    }

    const configKeys = config.systemConfig.map((row) => row.key);
    const existingConfig = await tx
      .select({
        key: schema.systemConfig.key,
        value: schema.systemConfig.value,
      })
      .from(schema.systemConfig)
      .where(sql`${schema.systemConfig.key} in (${sql.join(
        configKeys.map((key) => sql`${key}`),
        sql`, `
      )})`);
    const existingByKey = new Map(
      existingConfig.map((row) => [row.key, row.value])
    );

    const contractKeys = CONTRACT_CONFIG_KEYS.filter((key) =>
      configKeys.includes(key)
    );
    const drifted = contractKeys.filter((key) => {
      const existing = existingByKey.get(key);
      const desired = config.systemConfig.find((row) => row.key === key);
      return existing !== undefined && desired !== undefined && existing !== desired.value;
    });
    if (drifted.length > 0) {
      return {
        kind: "refused",
        code: "CONFIG_DRIFT",
        message:
          "existing contract config differs from the manifest; resolve it explicitly before seeding",
        keys: [...drifted],
      };
    }

    const grantsBefore = await tx.execute<{ count: number }>(
      sql`select count(*)::int as count from ${sql.identifier("admin_role_grant")}`
    );
    const roleIds = await ensureInitialRoles(tx);
    const grantsAfter = await tx.execute<{ count: number }>(
      sql`select count(*)::int as count from ${sql.identifier("admin_role_grant")}`
    );

    const insertedBranches = await tx
      .insert(schema.branches)
      .values(hqBranchSeedRow)
      .onConflictDoNothing({ target: schema.branches.id })
      .returning({ id: schema.branches.id });

    const insertedConfig = await tx
      .insert(schema.systemConfig)
      .values(
        config.systemConfig.map((row) => ({
          key: row.key,
          value: row.value,
          type: row.type,
          description: row.description,
        }))
      )
      .onConflictDoNothing({ target: schema.systemConfig.key })
      .returning({ key: schema.systemConfig.key });

    await tx.insert(schema.systemConfig).values({
      key: REFERENCE_MARKER_KEY,
      value: String(REFERENCE_MARKER_VERSION),
      type: "number",
      description:
        "Marker internal seed referensi production. Versi dikenal berarti seed pertama sudah diterapkan.",
    });

    const insertedKeys = new Set(insertedConfig.map((row) => row.key));
    return {
      kind: "applied",
      marker: REFERENCE_MARKER_VERSION,
      written: {
        roles: roleIds.size,
        grants:
          (grantsAfter.rows[0]?.count ?? 0) -
          (grantsBefore.rows[0]?.count ?? 0),
        branches: insertedBranches.length,
        configRows: insertedConfig.length,
      },
      preservedConfigKeys: configKeys.filter(
        (key) => existingByKey.has(key) && !insertedKeys.has(key)
      ),
    };
  });
}

export interface ProductionVerificationState {
  markerValue: string | null;
  roleKeys: string[];
  hqBranchPresent: boolean;
  config: Record<string, { value: string; type: string }>;
  systemOwnerCount: number;
  ownersMissingCredential: number;
  productGroups: number;
  skus: number;
  providerBranches: number;
  negativeHolds: number;
  productGroupIds: number[];
  skuIds: number[];
  /** SKU×provider-branch pairs that should carry a stock observation. */
  stockPairsPossible: number;
  stockPairsCovered: number;
  /** Covered pairs whose provider observation timestamp is missing. */
  stockRowsMissingTimestamp: number;
  oldestStockSyncedAt: string | null;
}

export async function readProductionVerificationState(
  db: BootstrapDb
): Promise<ProductionVerificationState> {
  const configRows = await db.execute<{
    key: string;
    value: string;
    type: string;
  }>(sql`select key, value, type from ${sql.identifier("system_config")}`);
  const config: Record<string, { value: string; type: string }> = {};
  for (const row of configRows.rows) {
    config[row.key] = { value: row.value, type: row.type };
  }

  const roleRows = await db.execute<{ key: string }>(
    sql`select key from ${sql.identifier("admin_role")} where key in ('system_owner', 'hq', 'admin')`
  );

  const hq = await db.execute<{ present: boolean }>(sql`
    select exists (
      select 1 from ${sql.identifier("branch")} where id = ${hqBranchSeedRow.id}
    ) as present
  `);

  const owners = await db.execute<{ count: number; missing_credential: number }>(sql`
    select
      count(*)::int as count,
      count(*) filter (
        where not exists (
          select 1 from ${sql.identifier("admin_account")} account
          where account.user_id = ${sql.identifier("user")}.id
            and account.provider_id = 'credential'
        )
      )::int as missing_credential
    from ${sql.identifier("user")}
    join ${sql.identifier("admin_role")} role on role.id = ${sql.identifier("user")}.role_id
    where role.key = 'system_owner'
  `);

  const catalog = await db.execute<{
    product_groups: number;
    skus: number;
    provider_branches: number;
  }>(sql`
    select
      (select count(*)::int from ${sql.identifier("product")} where jubelio_item_group_id is not null) as product_groups,
      (select count(*)::int from ${sql.identifier("product_variant")} where jubelio_item_id is not null) as skus,
      (select count(*)::int from ${sql.identifier("branch")} where jubelio_location_id is not null) as provider_branches
  `);

  const holds = await db.execute<{ negative: number }>(sql`
    select count(*)::int as negative
    from ${sql.identifier("branch_stock")}
    where reserved_stock < 0
  `);

  const stock = await db.execute<{
    possible: number;
    covered: number;
    missing_timestamp: number;
    oldest: string | Date | null;
  }>(sql`
    select
      (select count(*)::int from ${sql.identifier("product_variant")} where jubelio_item_id is not null)
        * (select count(*)::int from ${sql.identifier("branch")} where jubelio_location_id is not null) as possible,
      (select count(*)::int
         from ${sql.identifier("branch_stock")} bs
         join ${sql.identifier("product_variant")} v on v.id = bs.product_variant_id
         join ${sql.identifier("branch")} b on b.id = bs.branch_id
        where v.jubelio_item_id is not null and b.jubelio_location_id is not null) as covered,
      (select count(*)::int
         from ${sql.identifier("branch_stock")} bs
         join ${sql.identifier("product_variant")} v on v.id = bs.product_variant_id
         join ${sql.identifier("branch")} b on b.id = bs.branch_id
        where v.jubelio_item_id is not null and b.jubelio_location_id is not null
          and bs.provider_stock_synced_at is null) as missing_timestamp,
      (select min(bs.provider_stock_synced_at)
         from ${sql.identifier("branch_stock")} bs
         join ${sql.identifier("product_variant")} v on v.id = bs.product_variant_id
         join ${sql.identifier("branch")} b on b.id = bs.branch_id
        where v.jubelio_item_id is not null and b.jubelio_location_id is not null) as oldest
  `);
  const oldest = stock.rows[0]?.oldest ?? null;

  const groupIds = await db.execute<{ id: number }>(sql`
    select jubelio_item_group_id as id
    from ${sql.identifier("product")}
    where jubelio_item_group_id is not null
    order by id
  `);
  const skuIds = await db.execute<{ id: number }>(sql`
    select jubelio_item_id as id
    from ${sql.identifier("product_variant")}
    where jubelio_item_id is not null
    order by id
  `);

  return {
    markerValue: config[REFERENCE_MARKER_KEY]?.value ?? null,
    roleKeys: roleRows.rows.map((row) => row.key),
    hqBranchPresent: hq.rows[0]?.present ?? false,
    config,
    systemOwnerCount: owners.rows[0]?.count ?? 0,
    ownersMissingCredential: owners.rows[0]?.missing_credential ?? 0,
    productGroups: catalog.rows[0]?.product_groups ?? 0,
    skus: catalog.rows[0]?.skus ?? 0,
    providerBranches: catalog.rows[0]?.provider_branches ?? 0,
    negativeHolds: holds.rows[0]?.negative ?? 0,
    productGroupIds: groupIds.rows.map((row) => row.id),
    skuIds: skuIds.rows.map((row) => row.id),
    stockPairsPossible: stock.rows[0]?.possible ?? 0,
    stockPairsCovered: stock.rows[0]?.covered ?? 0,
    stockRowsMissingTimestamp: stock.rows[0]?.missing_timestamp ?? 0,
    oldestStockSyncedAt:
      oldest === null
        ? null
        : oldest instanceof Date
          ? oldest.toISOString()
          : new Date(oldest).toISOString(),
  };
}

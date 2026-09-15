import { randomUUID } from "crypto";
import { eq, inArray } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { adminRoleGrants, adminRoles } from "../schema";
import { INITIAL_ROLE_SEED } from "./seed-defaults";

// =========================================================
// RBAC: idempotent Initial Role provisioning
// =========================================================
// The one-time Owner bootstrap must work on a production database where
// `db:seed` never ran. This ensures the three code-owned Initial Roles
// (system_owner, hq, admin) and their grant rows exist before an Owner is
// created. It is idempotent: existing roles are left untouched and only
// missing roles/missing grant rows are created, so running it against an
// already-seeded database is a no-op.

type Executor =
  | NodePgDatabase<Record<string, never>>
  | Parameters<Parameters<NodePgDatabase["transaction"]>[0]>[0];

export async function ensureInitialRoles(
  executor: Executor
): Promise<Map<string, string>> {
  const keys = INITIAL_ROLE_SEED.map((seed) => seed.key);
  const existing = await executor
    .select({ id: adminRoles.id, key: adminRoles.key })
    .from(adminRoles)
    .where(inArray(adminRoles.key, [...keys]));

  const idByKey = new Map<string, string>();
  for (const row of existing) {
    if (row.key) idByKey.set(row.key, row.id);
  }

  const roleIdsByKey = new Map<string, string>();
  for (const seed of INITIAL_ROLE_SEED) {
    let roleId = idByKey.get(seed.key);
    if (!roleId) {
      roleId = randomUUID();
      await executor.insert(adminRoles).values({
        id: roleId,
        key: seed.key,
        name: seed.name,
        isSystem: seed.isSystem,
        version: 1,
      });
    }
    roleIdsByKey.set(seed.key, roleId);

    // Repair missing grant rows for existing system Roles (idempotent).
    const rows = await executor
      .select({
        module: adminRoleGrants.module,
        action: adminRoleGrants.action,
      })
      .from(adminRoleGrants)
      .where(eq(adminRoleGrants.roleId, roleId));
    const have = new Set(rows.map((r) => `${r.module}:${r.action}`));
    const missing = seed.grants.filter(
      (grant) => !have.has(`${grant.module}:${grant.action}`)
    );
    if (missing.length > 0) {
      await executor.insert(adminRoleGrants).values(
        missing.map((grant) => ({
          id: randomUUID(),
          roleId,
          module: grant.module,
          action: grant.action,
          scope: grant.scope,
        }))
      );
    }
  }
  return roleIdsByKey;
}
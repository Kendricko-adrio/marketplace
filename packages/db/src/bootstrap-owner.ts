import dotenv from "dotenv";
dotenv.config({ path: "../../.env" });
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, sql } from "drizzle-orm";
import { Pool } from "pg";
import bcrypt from "bcryptjs";
import * as schema from "./schema";
import { planBootstrapOwner, type BootstrapOwnerInput } from "./rbac/bootstrap-owner-core";
import { ensureInitialRoles } from "./rbac/ensure-roles";
import { parseArgs, resolvePassword } from "./rbac/bootstrap-owner-input";

// =========================================================
// One-time System Owner bootstrap CLI.
// =========================================================
// Usage (from the repository root):
//   npm run db:bootstrap-owner -- --name "System Owner" \
//     --email owner@example.invalid --username owner --password '<password>'
// Secret alternatives (preferred — keep the secret out of shell history and
// the process list):
//   --password-file /run/secrets/owner_password
//   RBAC_BOOTSTRAP_PASSWORD='<password>' npm run db:bootstrap-owner -- …
//
// Provisioning: the CLI idempotently ensures the three Initial Roles exist
// (ensureInitialRoles) so it works on a production database where db:seed
// never ran; it does not require a prior seed.
//
// Refuses to run once a System Owner exists (exit code 1, OWNER_EXISTS).
// Never ships default production credentials and there is no web bootstrap
// endpoint. Protects concurrent first-Owner attempts with a transaction-level
// advisory lock (pg_advisory_xact_lock) re-checked inside the transaction —
// not a race-prone bare count.
//
// Structured JSON logs only; the password is never logged.

interface ParsedArgs {
  name?: string;
  email?: string;
  username?: string;
  password?: string;
  passwordFile?: string;
}

// Argument parsing and secret resolution live in
// ./rbac/bootstrap-owner-input.ts (unit-tested); --password on argv is
// accepted for scripted runs but a file (--password-file) or the
// RBAC_BOOTSTRAP_PASSWORD environment variable avoids placing the secret in
// shell history or the process list.

function log(level: "info" | "error", event: string, fields?: Record<string, unknown>) {
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      level,
      event: `rbac.bootstrap_owner.${event}`,
      ...fields,
    })
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let password: string | undefined;
  try {
    password = await resolvePassword({
      argvPassword: args.password,
      passwordFile: args.passwordFile,
      envPassword: process.env.RBAC_BOOTSTRAP_PASSWORD,
    });
  } catch (error) {
    log("error", "invalid_input", {
      code: "INVALID_PASSWORD_INPUT",
      reason: error instanceof Error ? error.message : String(error),
    });
    console.error("Bootstrap refused: INVALID_PASSWORD_INPUT");
    process.exitCode = 2;
    return;
  }
  const input: BootstrapOwnerInput = {
    name: args.name ?? "",
    email: args.email ?? "",
    username: args.username ?? "",
    password: password ?? "",
  };

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
  });
  const db = drizzle(pool);

  try {
    const result = await db.transaction(async (tx) => {
      // Transaction-level serialization for concurrent first-Owner attempts.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext('rbac_bootstrap_owner'))`
      );

      // Count existing System Owners inside the lock.
      const [{ count }] = (await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.users)
        .innerJoin(schema.adminRoles, eq(schema.users.roleId, schema.adminRoles.id))
        .where(eq(schema.adminRoles.key, "system_owner"))) as { count: number }[];

      const plan = planBootstrapOwner(input, count);
      if (!plan.ok) {
        return { ok: false as const, code: plan.code };
      }

      const roleIds = await ensureInitialRoles(tx);
      const ownerRoleId = roleIds.get("system_owner");
      if (!ownerRoleId) {
        throw new Error("system_owner Role could not be provisioned.");
      }

      const userId = crypto.randomUUID();
      const assignment = plan.assignment;
      await tx.insert(schema.users).values({
        id: userId,
        name: assignment.name,
        username: assignment.username,
        displayUsername: assignment.username,
        email: assignment.email,
        emailVerified: true,
        roleId: ownerRoleId,
        isActive: true,
        branchId: null, // Owners are global — no Home Branch
        mustResetPassword: true,
      });

      // Credential with the admin auth convention (bcrypt, cost 10).
      const passwordHash = await bcrypt.hash(input.password, 10);
      await tx.insert(schema.adminAccounts).values({
        id: crypto.randomUUID(),
        userId,
        accountId: userId,
        providerId: "credential",
        password: passwordHash,
      });

      return { ok: true as const, userId };
    });

    if (!result.ok) {
      log("error", "refused", { code: result.code });
      console.error(`Bootstrap refused: ${result.code}`);
      process.exitCode = result.code === "OWNER_EXISTS" ? 1 : 2;
      return;
    }

    log("info", "created", {
      userId: result.userId,
      roleKey: "system_owner",
      mustResetPassword: true,
    });
    console.log("System Owner created. Change the password on first sign-in.");
  } catch (error) {
    log("error", "failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    console.error("Bootstrap failed:", error);
    process.exitCode = 3;
  } finally {
    await pool.end();
  }
}

main();
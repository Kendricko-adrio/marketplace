import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createAuthMiddleware } from "better-auth/api";
import { db } from "@/db";
import * as schema from "@/db";
import bcrypt from "bcryptjs";
import { username } from "better-auth/plugins";
import { APIError } from "better-auth/api";
import { sendResetPasswordEmail } from "@/lib/email";
import { getPasswordPolicyError } from "@/lib/password-policy";
import { eq } from "drizzle-orm";

async function clearMustResetPassword(userId: string) {
  await db
    .update(schema.users)
    .set({ mustResetPassword: false, updatedAt: new Date() })
    .where(eq(schema.users.id, userId));
}

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.users,
      session: schema.adminSessions,
      account: schema.adminAccounts,
      verification: schema.adminVerifications,
    },
  }),
  plugins: [
    username({
      minUsernameLength: 2,
    }),
  ],
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
    password: {
      hash: async (password) => {
        return await bcrypt.hash(password, 10);
      },
      verify: async ({ hash, password }) => {
        return await bcrypt.compare(password, hash);
      },
    },
    async sendResetPassword(data) {
      await sendResetPasswordEmail({
        to: data.user.email,
        name: data.user.name,
        resetUrl: data.url,
      });
    },
    revokeSessionsOnPasswordReset: true,
    onPasswordReset: async ({ user }) => {
      await clearMustResetPassword(user.id);
    },
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      const policyError = getPasswordPolicyError(ctx.path, ctx.method, ctx.body);
      if (policyError) {
        throw new APIError("BAD_REQUEST", { message: policyError });
      }
    }),
    after: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== "/change-password") return;
      const userId = ctx.context.session?.user.id;
      if (userId) await clearMustResetPassword(userId);
    }),
  },
  socialProviders: {},
  user: {
    additionalFields: {
      // Server-owned RBAC assignment fields: exactly one dynamic Role and the
      // soft-deactivation flag. Clients cannot set either at auth time.
      roleId: {
        type: "string",
        required: false,
        input: false,
      },
      isActive: {
        type: "boolean",
        required: false,
        defaultValue: true,
        input: false,
      },
      branchId: {
        type: "string",
        required: false,
        input: false,
      },
      mustResetPassword: {
        type: "boolean",
        required: false,
        defaultValue: false,
        input: false,
      },
    },
  },
  advanced: {
    cookiePrefix: "admin",
  },
  databaseHooks: {
    session: {
      create: {
        before: async (session, ctx) => {
          if (!ctx) return;
          // Session admission (Current Policy): only an ACTIVE user with a
          // valid, non-archived Role assignment may create an admin session.
          // There is no legacy role-name field — admission relies solely on
          // roleId + isActive, and the per-request policy resolver denies
          // everything else.
          const user = (await ctx.context.internalAdapter.findUserById(
            session.userId
          )) as
            | { isActive?: boolean | null; roleId?: string | null }
            | null;
          if (!user) {
            throw new APIError("FORBIDDEN", {
              message: "Invalid credentials",
              code: "INVALID_USER_TYPE",
            });
          }
          if (user.isActive === false) {
            throw new APIError("FORBIDDEN", {
              message: "Account is deactivated",
              code: "INACTIVE_USER",
            });
          }
          if (!user.roleId) {
            throw new APIError("FORBIDDEN", {
              message: "Assigned role is not available",
              code: "INVALID_ROLE_ASSIGNMENT",
            });
          }
          const rows = await db
            .select({ archivedAt: schema.adminRoles.archivedAt })
            .from(schema.adminRoles)
            .where(eq(schema.adminRoles.id, user.roleId))
            .limit(1);
          const assignedRole = rows[0];
          if (!assignedRole || assignedRole.archivedAt !== null) {
            throw new APIError("FORBIDDEN", {
              message: "Assigned role is not available",
              code: "INVALID_ROLE_ASSIGNMENT",
            });
          }
        },
      },
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // 1 day
  },
});

export type Session = typeof auth.$Infer.Session;
export type User = typeof auth.$Infer.Session.user;

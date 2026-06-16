import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@/db";
import * as schema from "@/db";
import bcrypt from "bcryptjs";
import { username } from "better-auth/plugins";
import { APIError } from "better-auth/api";

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
    password: {
      hash: async (password) => {
        return await bcrypt.hash(password, 10);
      },
      verify: async ({ hash, password }) => {
        return await bcrypt.compare(password, hash);
      },
    },
    async sendResetPassword(data) {
      console.log("Reset password URL:", data.url);
      // TODO: Implement email sending
    },
  },
  socialProviders: {},
  user: {
    additionalFields: {
      role: {
        type: ["admin", "hq"],
        defaultValue: "admin",
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
          const user = (await ctx.context.internalAdapter.findUserById(
            session.userId
          )) as { role?: string } | null;
          // Only admins/hq are allowed to create admin sessions
          if (!user || !user.role || !["admin", "hq"].includes(user.role)) {
            throw new APIError("FORBIDDEN", {
              message: "Invalid credentials",
              code: "INVALID_USER_TYPE",
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

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@/db";
import * as schema from "@/db";
import bcrypt from "bcryptjs";
import { APIError } from "better-auth/api";

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.clients,
      session: schema.clientSessions,
      account: schema.clientAccounts,
      verification: schema.clientVerifications,
    },
  }),
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
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID || "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
    },
  },
  advanced: {
    cookiePrefix: "client",
  },
  databaseHooks: {
    session: {
      create: {
        before: async (session, ctx) => {
          if (!ctx) return;
          const user = await ctx.context.internalAdapter.findUserById(
            session.userId
          );
          // Reject if the user is not a client (e.g., admin trying to sign in on store)
          if (!user || "role" in user) {
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

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@/db";
import * as schema from "@/db";
import bcrypt from "bcryptjs";
import { APIError } from "better-auth/api";
import { sendVerificationEmail } from "@/lib/email";

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
    requireEmailVerification: true,
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
      // TODO: Implement reset password email (out of scope for this pass)
    },
  },
  emailVerification: {
    sendVerificationEmail: async ({ user, url }) => {
      await sendVerificationEmail({
        to: user.email,
        name: user.name,
        verificationUrl: url,
      });
    },
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    expiresIn: 60 * 60, // 1 hour
    afterEmailVerification: async (user) => {
      // Email just got verified via the password sign-up flow.
      // Onboarding is still required; the verify landing page redirects to /onboarding.
      void user;
    },
  },
  user: {
    additionalFields: {
      phone: {
        type: "string",
        required: false,
      },
      birthDate: {
        type: "string",
        required: false,
      },
      gender: {
        type: "string",
        required: false,
      },
      onboardingCompleted: {
        type: "boolean",
        required: false,
        defaultValue: false,
      },
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
    user: {
      create: {
        before: async (user, ctx) => {
          // Google (and other social) users come through the OAuth callback path.
          // Their email is already verified by the provider, so auto-verify + flag onboarding.
          if (ctx?.path === "/callback/google" || ctx?.path === "/callback/:id") {
            return {
              data: {
                ...user,
                emailVerified: true,
                onboardingCompleted: false,
              },
            };
          }
          // Password sign-up: emailVerified stays false (set by signUp flow),
          // onboarding must wait until after they verify their email.
          return {
            data: {
              ...user,
              onboardingCompleted: false,
            },
          };
        },
      },
    },
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

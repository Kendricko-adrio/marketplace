import path from "node:path";

// Absolute paths to the saved auth states (gitignored, contain session
// cookies). Playwright resolves relative storageState paths from the config
// file, so keeping them absolute here avoids cwd surprises.
const authDir = path.resolve(__dirname, ".auth");

export const AUTH = {
  store: path.join(authDir, "store.json"),
  admin: path.join(authDir, "admin.json"),
} as const;

// Test users must exist in the local DB — these match the seeder
// (packages/db/src/seed.ts). Override via env vars when your dev DB differs.
export const TEST_USERS = {
  // Customer whose onboarding is completed by the auth setup — used for the
  // authenticated (storageState) store session.
  store: {
    email: process.env.E2E_STORE_EMAIL || "john@example.com",
    password: process.env.E2E_STORE_PASSWORD || "password123",
  },
  // Customer that is NEVER onboarded by the setup — used by login-flow specs
  // that assert the fresh-user landing on /onboarding.
  storeFresh: {
    email: process.env.E2E_STORE_FRESH_EMAIL || "jane@example.com",
    password: process.env.E2E_STORE_FRESH_PASSWORD || "password123",
  },
  admin: {
    // Email or username — admintoko is the seeded admin user.
    identifier: process.env.E2E_ADMIN_IDENTIFIER || "admintoko",
    password: process.env.E2E_ADMIN_PASSWORD || "admin123",
  },
} as const;

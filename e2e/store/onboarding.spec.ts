import { test, expect } from "@playwright/test";
import { Pool } from "pg";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import crypto from "node:crypto";

// Onboarding flow: fresh user → /onboarding → complete form → redirect home
// with the client.onboarding=1 cookie.
//
// The seeded fresh user (jane) is used by login.spec.ts, so this spec creates
// its own isolated fresh client directly in the DB (emailVerified, not
// onboarded) and deletes it afterwards — no shared state, no parallel races.

// This spec drives the login flow itself — start from a clean browser
// context (no saved session), like login.spec.ts.
test.use({ storageState: { cookies: [], origins: [] } });

// The second test depends on the first completing onboarding — run serially.
test.describe.configure({ mode: "serial" });

dotenv.config({ path: ".env" });

const FRESH_EMAIL = `e2e-fresh-${crypto.randomUUID().slice(0, 8)}@example.com`;
const FRESH_PASSWORD = "Password123";

let pool: Pool;
let freshClientId: string;

test.beforeAll(async () => {
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  freshClientId = crypto.randomUUID();
  const hashed = await bcrypt.hash(FRESH_PASSWORD, 10);
  await pool.query(
    `INSERT INTO client (id, name, email, email_verified, onboarding_completed)
     VALUES ($1, $2, $3, true, false)`,
    [freshClientId, "E2E Fresh", FRESH_EMAIL]
  );
  await pool.query(
    `INSERT INTO client_account (id, user_id, account_id, provider_id, password)
     VALUES ($1, $2, $3, 'credential', $4)`,
    [crypto.randomUUID(), freshClientId, freshClientId, hashed]
  );
});

test.afterAll(async () => {
  // Cascade deletes the account + any sessions.
  await pool.query("DELETE FROM client WHERE id = $1", [freshClientId]);
  await pool.end();
});

test("fresh user lands on /onboarding, completes it, and gets the cookie", async ({
  page,
}) => {
  await page.goto("/login");
  // The submit button is disabled until the session check finishes — waiting
  // for it guarantees hydration + readiness before submitting.
  const submit = page.getByRole("main").getByRole("button", { name: "Masuk", exact: true });
  await expect(submit).toBeEnabled();
  await page.getByLabel("Email").fill(FRESH_EMAIL);
  await page.keyboard.press("Tab");
  await page.getByLabel("Password").fill(FRESH_PASSWORD);
  await submit.click();

  // Middleware gates the fresh user to /onboarding.
  await page.waitForURL("**/onboarding");
  await expect(page.getByLabel("Nomor Telepon")).toBeVisible();

  // Complete the identity form.
  await page.getByLabel("Nomor Telepon").fill("81234567890");
  await page.getByLabel("Tanggal Lahir").fill("2000-01-01");
  await page.getByRole("radio", { name: "Laki-laki" }).check();
  await page.getByRole("button", { name: "Selesaikan Pendaftaran" }).click();

  // Redirects home with the onboarding cookie set.
  await page.waitForURL((url) => url.pathname === "/", { waitUntil: "commit" });
  const cookies = await page.context().cookies();
  const onboardingCookie = cookies.find((c) => c.name === "client.onboarding");
  expect(onboardingCookie?.value).toBe("1");
});

test("onboarded user is not gated anymore (DB is the source of truth)", async ({
  page,
}) => {
  // The previous test completed onboarding for this user — a fresh login must
  // land on / (not /onboarding) and protected routes must not bounce.
  await page.goto("/login");
  const submit = page.getByRole("main").getByRole("button", { name: "Masuk", exact: true });
  await expect(submit).toBeEnabled();
  await page.getByLabel("Email").fill(FRESH_EMAIL);
  await page.keyboard.press("Tab");
  await page.getByLabel("Password").fill(FRESH_PASSWORD);
  await submit.click();

  await page.waitForURL((url) => url.pathname === "/", { waitUntil: "commit" });
  await page.goto("/account");
  await expect(
    page.getByRole("heading", { name: "Riwayat Pesanan" })
  ).toBeVisible();
});

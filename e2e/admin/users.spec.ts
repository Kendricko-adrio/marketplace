import { test, expect } from "@playwright/test";
import { Pool } from "pg";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import dotenv from "dotenv";

dotenv.config({ path: ".env" });

const targetId = crypto.randomUUID();
const suffix = targetId.slice(0, 8);
const targetUsername = `reset.e2e.${suffix}`;
const targetEmail = `reset-e2e-${suffix}@example.com`;
let pool: Pool;

test.use({ storageState: { cookies: [], origins: [] } });

test.beforeAll(async () => {
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const oldHash = await bcrypt.hash("old-password-123", 10);
  // The target is a throwaway non-Owner admin user; assign the seeded HQ
  // Role (normalized roleId FK — there is no legacy `role` column anymore).
  // branch_id stays NULL: the fixture user never reaches an admin page (the
  // forced password reset happens before any home-branch check).
  await pool.query(
    `INSERT INTO "user" (id, name, username, display_username, email, email_verified, role_id, branch_id, must_reset_password)
     VALUES ($1, 'Reset E2E Target', $2, $2, $3, true, (SELECT id FROM admin_role WHERE "key" = 'hq'), NULL, false)`,
    [targetId, targetUsername, targetEmail]
  );
  await pool.query(
    `INSERT INTO admin_account (id, user_id, account_id, provider_id, password)
     VALUES ($1, $2, $2, 'credential', $3)`,
    [crypto.randomUUID(), targetId, oldHash]
  );
});

test.afterAll(async () => {
  await pool.query(`DELETE FROM "user" WHERE id = $1`, [targetId]);
  await pool.end();
});

test("HQ can generate a password and the target is forced to reset it", async ({ page, browser }) => {
  await page.goto("/login");
  await page.getByLabel("Email atau Username").fill("hqmanager");
  await page.getByLabel("Password").fill("hq123");
  await page.getByRole("button", { name: "Masuk", exact: true }).click();
  await page.waitForURL("**/admin/**");
  await page.goto("/admin/users");
  const row = page.locator("tr", { hasText: targetEmail });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("menuitem", { name: "Reset Password" }).click();

  const resetResponse = page.waitForResponse((response) =>
    response.url().includes(`/api/admin/users/${targetId}/reset-password`) &&
    response.request().method() === "POST"
  );
  await page.getByRole("button", { name: "Reset Kata Sandi" }).click();
  expect((await resetResponse).status()).toBe(200);

  const credentials = page.getByRole("dialog", { name: "Kata Sandi Baru" });
  await expect(credentials).toBeVisible();
  const generatedPassword = await credentials.locator("input").nth(3).inputValue();
  expect(generatedPassword.length).toBeGreaterThanOrEqual(8);

  const context = await browser.newContext({ baseURL: "http://localhost:3001" });
  const targetPage = await context.newPage();
  await targetPage.goto("/login");
  await targetPage.getByLabel("Email atau Username").fill(targetUsername);
  await targetPage.getByLabel("Password").fill(generatedPassword);
  await targetPage.getByRole("button", { name: "Masuk", exact: true }).click();
  await expect(targetPage).toHaveURL(/\/reset-password\?force=1/);
  await context.close();
});

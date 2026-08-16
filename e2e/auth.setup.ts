import { mkdirSync } from "node:fs";
import path from "node:path";
import { test as setup, expect, type Page } from "@playwright/test";
import { AUTH, TEST_USERS } from "./config";

// Log in once per app and persist the session (Playwright's "login once,
// reuse everywhere" pattern). Every other test file starts from these saved
// storageState files, so they don't repeat the login flow.
//
// The store setup also completes onboarding through the real UI: seeded
// customers haven't onboarded, and middleware forces /onboarding until the
// `client.onboarding=1` cookie is set. Completing it means the saved session
// can reach protected store routes without being bounced back to /onboarding.

async function saveState(page: Page, file: string) {
  mkdirSync(path.dirname(file), { recursive: true });
  await page.context().storageState({ path: file });
}

setup("store: sign in john@example.com + complete onboarding", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(TEST_USERS.store.email);
  await page.keyboard.press("Tab");
  await page.getByLabel("Password").fill(TEST_USERS.store.password);
  await page.keyboard.press("Enter");

  // A successful store login lands on /onboarding if the user hasn't onboarded
  // yet, or on / if they already have. Wait for either outcome.
  await page.waitForURL((url) =>
    url.pathname === "/onboarding" || url.pathname === "/"
  );

  if (page.url().includes("/onboarding")) {
    await expect(page.getByLabel("Nomor Telepon")).toBeVisible();

    await page.getByLabel("Nomor Telepon").fill("81234567890");
    await page.getByLabel("Tanggal Lahir").fill("2000-01-01");
    await page.getByRole("radio", { name: "Laki-laki" }).check();
    await page.getByRole("button", { name: "Selesaikan Pendaftaran" }).click();

    // Onboarding redirects home.
    await page.waitForURL((url) => url.pathname === "/");
  }

  await saveState(page, AUTH.store);
});

setup("admin: sign in admintoko", async ({ page }) => {
  await page.goto("http://localhost:3001/login");
  await page.getByLabel("Email atau Username").fill(TEST_USERS.admin.identifier);
  await page.getByLabel("Password").fill(TEST_USERS.admin.password);
  await page.getByRole("button", { name: "Masuk", exact: true }).click();

  // Admin login lands on /admin/<first-viewable module> (products for admin).
  await page.waitForURL("**/admin/**");
  await expect(
    page.getByRole("heading", { name: "Admin Dashboard" })
  ).toBeVisible();

  await saveState(page, AUTH.admin);
});

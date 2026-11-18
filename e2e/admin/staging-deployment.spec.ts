import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

test.skip(process.env.STAGING_SMOKE !== "true", "Smoke staging hanya melalui config opt-in");
const admin = "https://dev-admin.adfsport.cloud";
const store = "https://dev-store.adfsport.cloud";

// Password/session tidak direkam dalam trace/video/screenshot. Tidak mengganti
// password pribadi pemilik secara otomatis hanya demi membuka halaman admin.
test("Owner dapat login, wajib reset password, dan bukan client store", async ({ context, page }) => {
  const source = process.env.STAGING_OWNER_FILE;
  if (!source) throw new Error("STAGING_OWNER_FILE required outside repository");
  const owner = JSON.parse(readFileSync(source, "utf8")) as { username: string; password: string };
  if (!owner.username || !owner.password) throw new Error("Owner input unavailable");
  const failures: string[] = [];
  await context.route("**/*", async route => {
    const req = route.request();
    const url = new URL(req.url());
    const allowedRead = [admin, store].includes(url.origin) && ["GET", "HEAD"].includes(req.method());
    const allowedLogin = url.origin === admin && url.pathname === "/api/auth/sign-in/username" && req.method() === "POST";
    if (!allowedRead && !allowedLogin) {
      failures.push("request di luar allowlist login/read-only");
      return route.abort();
    }
    return route.continue();
  });
  page.on("pageerror", () => failures.push("browser pageerror"));
  page.on("response", response => { if (response.status() >= 500) failures.push(`HTTP ${response.status()}`); });
  await page.goto(`${admin}/login`, { waitUntil: "networkidle" });
  await expect(page.getByLabel("Email atau Username")).toBeVisible();
  try {
    await page.getByLabel("Email atau Username").fill(owner.username);
    await page.getByLabel("Password", { exact: true }).fill(owner.password);
    await page.getByRole("button", { name: "Masuk", exact: true }).click();
  } catch {
    // Jangan meneruskan Playwright action error yang dapat memuat input privat.
    throw new Error("Owner login action failed; private input omitted");
  }
  await expect(page).toHaveURL(`${admin}/reset-password?force=1`);
  await expect(page.getByText("Anda wajib mengganti kata sandi sebelum dapat melanjutkan.")).toBeVisible();
  await expect(page.getByLabel("Password Saat Ini")).toBeVisible();
  await expect(page.getByLabel("Password Baru", { exact: true })).toBeVisible();
  const session = await context.request.get(`${admin}/api/admin/session-check`);
  expect(session.ok()).toBe(true);
  expect(await session.json()).toMatchObject({ success: true, authenticated: true, mustResetPassword: true });
  const storeSession = await context.request.get(`${store}/api/auth/get-session`);
  expect(storeSession.ok()).toBe(true);
  const client = await storeSession.json();
  expect(client?.user ?? null).toBeNull();
  await page.goto(`${admin}/admin/orders`, { waitUntil: "networkidle" });
  await expect(page).toHaveURL(`${admin}/reset-password?force=1`);
  expect(failures).toEqual([]);
  test.info().annotations.push({ type: "handover", description: "List admin menunggu pemilik menyelesaikan forced reset; tidak dilewati melalui SQL/mutasi password" });
});

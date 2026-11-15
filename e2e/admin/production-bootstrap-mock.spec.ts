/**
 * Production-bootstrap smoke (admin, mock/isolated run).
 *
 * Runs ONLY when `E2E_BOOTSTRAP_SMOKE=true` and the mock config's database was
 * bootstrapped by the production flow (one System Owner created through the
 * Owner CLI, `mustResetPassword=true`). It asserts:
 *   1. the Owner can sign in through the public HTTP seam,
 *   2. the admin session-check reports the forced password reset,
 *   3. an admin session is NOT a store client session (independent Better Auth
 *      instances: admin cookies/tables vs client cookies/tables).
 *
 * It writes nothing and does not touch checkout, provider writes, or orders.
 * Without the env contract it is skipped instead of failing another mock spec.
 */
import { expect, test } from "@playwright/test";

const ENABLED = process.env.E2E_BOOTSTRAP_SMOKE === "true";
const ADMIN_BASE_URL =
  process.env.E2E_MOCK_ADMIN_BASE_URL ?? "http://localhost:3111";
const STORE_BASE_URL =
  process.env.E2E_MOCK_STORE_BASE_URL ?? "http://localhost:3110";
const OWNER_IDENTIFIER = process.env.E2E_BOOTSTRAP_OWNER ?? "";
const OWNER_PASSWORD = process.env.E2E_BOOTSTRAP_OWNER_PASSWORD ?? "";

test.skip(
  !ENABLED ||
    OWNER_IDENTIFIER.length === 0 ||
    OWNER_PASSWORD.length === 0,
  "production bootstrap smoke requires E2E_BOOTSTRAP_SMOKE=true with E2E_BOOTSTRAP_OWNER/E2E_BOOTSTRAP_OWNER_PASSWORD against a bootstrapped disposable database"
);

test("bootstrapped Owner signs in with a forced reset and keeps admin/store sessions separate", async ({
  request,
}) => {
  const signIn = await request.post(
    `${ADMIN_BASE_URL}/api/auth/sign-in/username`,
    { data: { username: OWNER_IDENTIFIER, password: OWNER_PASSWORD } }
  );
  expect(
    signIn.ok(),
    `Owner sign-in failed: ${await signIn.text()}`
  ).toBe(true);

  const session = await request.get(
    `${ADMIN_BASE_URL}/api/admin/session-check`
  );
  expect(session.ok()).toBe(true);
  const body = (await session.json()) as {
    success: boolean;
    authenticated: boolean;
    mustResetPassword: boolean;
  };
  expect(body).toMatchObject({
    success: true,
    authenticated: true,
    mustResetPassword: true,
  });

  // Same browser context, store origin: the admin session must not be
  // accepted as a store client session.
  const storeSession = await request.get(`${STORE_BASE_URL}/api/auth/get-session`);
  expect(storeSession.ok()).toBe(true);
  const storeBody = (await storeSession.json()) as { user?: unknown } | null;
  expect(storeBody?.user ?? null).toBeNull();
});

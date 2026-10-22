/**
 * Ticket 12 — ops usage/privacy/capacity personas on the isolated admin app.
 *
 * Browser (B) coverage for the documented read interfaces:
 *   - a promo viewer WITHOUT Orders:view gets the global aggregate only (no
 *     order/customer/branch identity in the DOM or the raw API body);
 *   - a Jakarta own-branch Orders viewer sees only Jakarta entries: a direct
 *     entry id or a foreign branchId cannot open the Surabaya row;
 *   - a promo editor (HQ) navigates summary → scoped entries → order link →
 *     immutable history and still sees the code literal in the protected
 *     detail interface while usage/history stay masked;
 *   - pausing an Offer stops NEW use only: existing entries/statuses stay, and
 *     no reset/force-release/refund control exists.
 *
 * Fixtures are run-unique SQL rows (Offer/revision/benefit/code/orders/
 * redemptions/events/allocations/audit) plus two Admin Users created through the
 * Roles/Users APIs. Cleanup is FK-ordered; failures are thrown from afterAll.
 *
 * Run under playwright.mock.config.ts with a disposable
 * `marketplace_discounts_test_*` DATABASE_URL.
 */
import { test, expect, type BrowserContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import dotenv from "dotenv";
dotenv.config({ path: ".env" });

const ADMIN_BASE_URL = process.env.E2E_MOCK_ADMIN_BASE_URL ?? "http://localhost:3111";
const RUN = Date.now().toString(36);
const PREFIX = `zz-usage12-${RUN}`;
const PASSWORD = `Pw-${RUN}-usage!`;

const HQ = {
  identifier: process.env.E2E_ADMIN_HQ_IDENTIFIER || "hqmanager",
  password: process.env.E2E_ADMIN_HQ_PASSWORD || "hq123",
};

const DISPOSABLE_DB = /^marketplace_discounts_test_/;

function databaseName(raw: string | undefined): string {
  try {
    return decodeURIComponent(new URL(String(raw)).pathname.replace(/^\//, ""));
  } catch {
    return "";
  }
}

function requireIsolatedDisposableRun(): void {
  if (process.env.E2E_PROVIDER_MOCKS !== "true" || !process.env.E2E_MOCK_ADMIN_BASE_URL) {
    throw new Error(
      "discounts-usage-mock.spec.ts must run under playwright.mock.config.ts (E2E_PROVIDER_MOCKS=true + isolated admin origin)"
    );
  }
  const admin = new URL(ADMIN_BASE_URL);
  if (admin.hostname !== "127.0.0.1" && admin.hostname !== "localhost") {
    throw new Error(`refusing non-loopback admin origin ${ADMIN_BASE_URL}`);
  }
  const db = databaseName(process.env.DATABASE_URL);
  if (!DISPOSABLE_DB.test(db)) {
    throw new Error(
      `refusing DATABASE_URL database "${db}": this spec only seeds/cleans marketplace_discounts_test_*`
    );
  }
}

requireIsolatedDisposableRun();
test.describe.configure({ mode: "serial" });

let pool: Pool;
let hqContext: BrowserContext;
let previousGate: string | null = null;

const OFFER = randomUUID();
const REVISION = randomUUID();
const BENEFIT = randomUUID();
const CODE = randomUUID();
const CODE_LITERAL = "OPS12HEMAT";
const PRODUCT = randomUUID();
const VARIANT = randomUUID();
const CLIENT = `${PREFIX}-client`;
const JKT_ORDER = `${PREFIX}-order-jkt`;
const SBY_ORDER = `${PREFIX}-order-sby`;
const JKT_REDEMPTION = `${PREFIX}-red-jkt`;
const SBY_REDEMPTION = `${PREFIX}-red-sby`;
const OFFER_NAME = `Ops12 ${RUN} Kode Hemat`;
const EMAIL_NO_ORDERS = `${PREFIX}-no-orders@example.test`;
const EMAIL_JKT = `${PREFIX}-jkt@example.test`;

async function signIn(context: BrowserContext, identifier: string, password: string) {
  const response = await context.request.post(
    `${ADMIN_BASE_URL}/api/auth/sign-in/username`,
    { data: { username: identifier, password } }
  );
  expect(response.ok(), `HTTP sign-in failed for ${identifier}`).toBe(true);
}

/** Users created by the API get a generated username; sign in with that. */
async function signInAsCreatedUser(context: BrowserContext, email: string) {
  const row = await pool.query<{ username: string }>(
    `SELECT username FROM "user" WHERE email=$1 LIMIT 1`,
    [email]
  );
  const username = row.rows[0]?.username;
  if (!username) throw new Error(`created user ${email} has no username`);
  await signIn(context, username, PASSWORD);
}

async function insertActor(input: {
  roleName: string;
  email: string;
  branchId: string;
  grants: Array<{ module: string; action: string; scope: string }>;
}): Promise<void> {
  const response = await hqContext.request.post("/api/admin/roles", {
    data: { name: input.roleName, grants: input.grants },
  });
  expect(response.ok(), `role create failed: ${await response.text()}`).toBe(true);
  const role = (await response.json()) as { data: { id: string } };
  const user = await hqContext.request.post("/api/admin/users", {
    data: {
      name: input.roleName,
      email: input.email,
      roleId: role.data.id,
      branchId: input.branchId,
      passwordMode: "manual",
      password: PASSWORD,
    },
  });
  expect(user.ok(), `user create failed: ${await user.text()}`).toBe(true);
  const createdUser = (await user.json()) as { data: { id: string } };
  // The Users API forces a first-login password change; clear it so the viewer
  // lands on /admin instead of /reset-password.
  await pool.query(`UPDATE "user" SET must_reset_password = false WHERE id=$1`, [
    createdUser.data.id,
  ]);
}

async function createFixture(): Promise<void> {
  const branches = await pool.query<{ id: string; city: string }>(
    `SELECT id, city FROM branch ORDER BY city`
  );
  const jkt = branches.rows.find((row) => row.city === "Jakarta Pusat")?.id;
  const sby = branches.rows.find((row) => row.city !== "Jakarta Pusat")?.id;
  if (!jkt || !sby) throw new Error("branch fixture missing (seed required)");

  await pool.query(
    `INSERT INTO product (id, name, slug, base_price) VALUES ($1,$2,$3,'150000')`,
    [PRODUCT, `Ops12 Fixture ${RUN}`, PREFIX]
  );
  await pool.query(
    `INSERT INTO product_variant (id, product_id, sku, price) VALUES ($1,$2,$3,'150000')`,
    [VARIANT, PRODUCT, `${PREFIX}-sku`]
  );
  await pool.query(
    `INSERT INTO client (id, name, email, email_verified) VALUES ($1,$2,$3,true)`,
    [CLIENT, `Ops12 Client ${RUN}`, `${PREFIX}-client@example.test`]
  );

  await pool.query(
    `INSERT INTO discount_offer (id, key, activation_kind, actor_identity, per_client_limit)
     VALUES ($1,$2,'manual_only','fixture',4)`,
    [OFFER, `${PREFIX}-offer-key`]
  );
  await pool.query(
    `INSERT INTO discount_offer_revision
       (id, offer_id, revision_no, name, currency, min_subtotal, published_at, actor_identity)
     VALUES ($1,$2,1,$3,'IDR','0',now(),'fixture')`,
    [REVISION, OFFER, OFFER_NAME]
  );
  await pool.query(
    `INSERT INTO discount_benefit (id, revision_id, kind, scope, fixed_amount)
     VALUES ($1,$2,'fixed_goods','goods','25000')`,
    [BENEFIT, REVISION]
  );
  await pool.query(
    `UPDATE discount_offer
        SET state='enabled', current_revision_id=$2, quota_count=20, budget_amount='500000'
      WHERE id=$1`,
    [OFFER, REVISION]
  );
  await pool.query(
    `INSERT INTO discount_offer_usage
       (offer_id, reserved_count, consumed_count, reserved_amount, consumed_amount, version)
     VALUES ($1,1,1,'25000','25000',2)`,
    [OFFER]
  );
  await pool.query(
    `INSERT INTO discount_code
       (id, offer_id, activation_kind, canonical_code, state, version, published_at, actor_identity)
     VALUES ($1,$2,'manual_only',$3,'active',1,now(),'fixture')`,
    [CODE, OFFER, CODE_LITERAL]
  );
  await pool.query(
    `INSERT INTO discount_client_usage
       (offer_id, client_id, reserved_count, consumed_count, reserved_amount, consumed_amount, version)
     VALUES ($1,$2,1,1,'25000','25000',2)`,
    [OFFER, CLIENT]
  );

  for (const order of [
    { id: JKT_ORDER, branch: jkt, status: "completed" },
    { id: SBY_ORDER, branch: sby, status: "pending_payment" },
  ]) {
    await pool.query(
      `INSERT INTO orders (id, user_id, branch_id, status, payment_status, contact_phone, contact_email, subtotal, total)
       VALUES ($1,$2,$3,$4,'paid','081200000000','fixture@example.test','150000','138750')`,
      [order.id, CLIENT, order.branch, order.status]
    );
    await pool.query(
      `INSERT INTO order_item (id, order_id, variant_id, product_name, price, quantity)
       VALUES ($1,$2,$3,'Fixture','150000',1)`,
      [`${order.id}-item`, order.id, VARIANT]
    );
  }

  for (const redemption of [
    { id: JKT_REDEMPTION, order: JKT_ORDER, status: "consumed" as const },
    { id: SBY_REDEMPTION, order: SBY_ORDER, status: "reserved" as const },
  ]) {
    const now = new Date();
    await pool.query(
      `INSERT INTO discount_redemption
         (id, order_id, client_id, offer_id, revision_id, benefit_id, activation_kind,
          code_id, status, benefit_amount, deadline, policy_version,
          terms_snapshot, result_snapshot, reserved_at, consumed_at)
       VALUES ($1,$2,$3,$4,$5,$6,'manual_only',$7,$8,'25000',$9,1,
               '{"name":"Fixture"}'::jsonb,'{"version":1}'::jsonb,$10,$11)`,
      [
        redemption.id,
        redemption.order,
        CLIENT,
        OFFER,
        REVISION,
        BENEFIT,
        CODE,
        redemption.status,
        new Date(now.getTime() + 15 * 60_000),
        now,
        redemption.status === "consumed" ? now : null,
      ]
    );
    await pool.query(
      `INSERT INTO discount_redemption_event
         (id, redemption_id, event_key, kind, previous_status, next_status, amount, source)
       VALUES ($1,$2,$3,'reserved',NULL,'reserved','25000','checkout')`,
      [randomUUID(), redemption.id, `${redemption.id}:reserved`]
    );
    await pool.query(
      `INSERT INTO order_discount_allocation
         (id, order_id, order_item_id, component, redemption_id, benefit_id, amount)
       VALUES ($1,$2,$3,'offer_goods',$4,$5,'25000')`,
      [randomUUID(), redemption.order, `${redemption.order}-item`, redemption.id, BENEFIT]
    );
  }

  // Immutable history: a code event with a masked label (never the literal) and
  // a draft event named by the seeded HQ actor.
  const hq = await pool.query<{ id: string }>(
    `SELECT id FROM "user" WHERE username='hqmanager' LIMIT 1`
  );
  const hqId = hq.rows[0]?.id;
  if (!hqId) throw new Error("seeded HQ user missing");
  await pool.query(
    `INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, changes, policy_version, branch_scope)
     VALUES ($1,$2,'DISCOUNT_CODE_ADDED','discount_offer',$3,$4::jsonb,1,'global'),
            ($5,$6,'DISCOUNT_OFFER_PUBLISHED','discount_offer',$3,$7::jsonb,1,'global')`,
    [
      randomUUID(),
      hqId,
      OFFER,
      JSON.stringify({
        actorIdentity: hqId,
        codeId: CODE,
        maskedCode: "OP••••••AT",
        revisionNo: 1,
        policyVersionAfter: 1,
      }),
      randomUUID(),
      hqId,
      JSON.stringify({
        actorIdentity: hqId,
        revisionId: REVISION,
        revisionNo: 1,
        policyVersionAfter: 1,
      }),
    ]
  );

  await insertActor({
    roleName: `Ops12 Agg ${RUN}`,
    email: EMAIL_NO_ORDERS,
    branchId: jkt,
    grants: [{ module: "discounts", action: "view", scope: "global" }],
  });
  await insertActor({
    roleName: `Ops12 Jkt ${RUN}`,
    email: EMAIL_JKT,
    branchId: jkt,
    grants: [
      { module: "discounts", action: "view", scope: "global" },
      { module: "orders", action: "view", scope: "own_branch" },
    ],
  });
}

test.beforeAll(async ({ browser }) => {
  pool = new Pool({ connectionString: process.env.DATABASE_URL });

  const gate = await pool.query<{ value: string }>(
    `SELECT value FROM system_config WHERE key='discounts.contractVersion'`
  );
  previousGate = gate.rows[0]?.value ?? null;
  await pool.query(
    `INSERT INTO system_config (key, value, type, description)
     VALUES ('discounts.contractVersion','1','number','usage12 e2e gate')
     ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`
  );

  hqContext = await browser.newContext({ baseURL: ADMIN_BASE_URL });
  await signIn(hqContext, HQ.identifier, HQ.password);
  await createFixture();
});

test.afterAll(async () => {
  const failures: string[] = [];
  try {
    if (pool) {
      await pool.query(`DELETE FROM audit_log WHERE entity_id=$1`, [OFFER]);
      await pool.query(
        `DELETE FROM discount_redemption_event WHERE redemption_id IN
           (SELECT id FROM discount_redemption WHERE offer_id=$1)`,
        [OFFER]
      );
      await pool.query(`DELETE FROM order_discount_allocation WHERE order_id = ANY($1::text[])`, [
        [JKT_ORDER, SBY_ORDER],
      ]);
      await pool.query(`DELETE FROM discount_redemption WHERE offer_id=$1`, [OFFER]);
      await pool.query(`DELETE FROM discount_client_usage WHERE offer_id=$1`, [OFFER]);
      await pool.query(`DELETE FROM discount_offer_usage WHERE offer_id=$1`, [OFFER]);
      await pool.query(`DELETE FROM discount_code WHERE offer_id=$1`, [OFFER]);
      await pool.query(`DELETE FROM discount_benefit WHERE revision_id=$1`, [REVISION]);
      await pool.query(
        `UPDATE discount_offer SET state='draft', current_revision_id=NULL WHERE id=$1`,
        [OFFER]
      );
      await pool.query(`DELETE FROM discount_offer_revision WHERE offer_id=$1`, [OFFER]);
      await pool.query(`DELETE FROM discount_offer WHERE id=$1`, [OFFER]);
      await pool.query(`DELETE FROM order_item WHERE order_id = ANY($1::text[])`, [
        [JKT_ORDER, SBY_ORDER],
      ]);
      await pool.query(`DELETE FROM orders WHERE id = ANY($1::text[])`, [
        [JKT_ORDER, SBY_ORDER],
      ]);
      await pool.query(`DELETE FROM product_variant WHERE id=$1`, [VARIANT]);
      await pool.query(`DELETE FROM product WHERE id=$1`, [PRODUCT]);
      await pool.query(`DELETE FROM client WHERE id=$1`, [CLIENT]);
      await pool.query(`DELETE FROM "user" WHERE email = ANY($1::text[])`, [
        [EMAIL_NO_ORDERS, EMAIL_JKT],
      ]);
      await pool.query(
        `DELETE FROM admin_role_grant WHERE role_id IN
           (SELECT id FROM admin_role WHERE name LIKE $1)`,
        [`Ops12 %${RUN}`]
      );
      await pool.query(`DELETE FROM admin_role WHERE name LIKE $1`, [
        `Ops12 %${RUN}`,
      ]);
      await pool.query(
        `UPDATE system_config SET value=$1 WHERE key='discounts.contractVersion'`,
        [previousGate ?? "0"]
      );
    }
  } catch (error) {
    failures.push((error as Error).message);
  } finally {
    try {
      await hqContext?.close();
    } catch (error) {
      failures.push((error as Error).message);
    }
    try {
      await pool?.end();
    } catch (error) {
      failures.push((error as Error).message);
    }
  }
  if (failures.length > 0) {
    throw new Error(`[discounts-usage-mock] cleanup failed:\n- ${failures.join("\n- ")}`);
  }
});

async function openOfferFromList(context: BrowserContext, name: string) {
  const page = await context.newPage();
  await page.goto("/admin/discounts");
  await expect(page.getByText("Offer publik", { exact: true })).toBeVisible();
  const row = page.getByRole("row", { name: new RegExp(name) });
  await expect(row).toBeVisible();
  await row.getByRole("link", { name: "Kelola" }).click();
  await page.waitForURL(`**/admin/discounts/${OFFER}`);
  return page;
}

test("editor navigates summary → scoped entries → history with masked usage", async () => {
  const page = await openOfferFromList(hqContext, OFFER_NAME);

  // Global authority: 20 quota, 1 consumed + 1 held → 18 available.
  await expect(page.getByText("Kapasitas global (otoritas)")).toBeVisible();
  await expect(
    page.getByText(/consumed 1 · held 1 · tersedia 18 pemakaian/)
  ).toBeVisible();
  await expect(
    page.getByText(/Amount: consumed Rp 25\.000 · held Rp 25\.000 · tersedia Rp 450\.000/)
  ).toBeVisible();

  // Scoped list (all branches) shows both orders and never the code literal.
  await expect(page.getByText("Pemakaian redemption (semua cabang)")).toBeVisible();
  await expect(page.locator(`a[href="/admin/orders/${JKT_ORDER}"]`)).toBeVisible();
  await expect(page.locator(`a[href="/admin/orders/${SBY_ORDER}"]`)).toBeVisible();
  // The usage table only ever shows the masked label; the protected code panel
  // above is the editor-only literal channel.
  await expect(page.getByText(/^OP.+AT$/).first()).toBeVisible();
  const usageApi = await hqContext.request.get(`/api/admin/discounts/${OFFER}/usage`);
  const usageRaw = await usageApi.text();
  expect(usageRaw).not.toContain(CODE_LITERAL);
  const usageBody = JSON.parse(usageRaw) as {
    data: { entries: { total: number; items: Array<{ maskedCode: string | null; codeId: string | null }> } };
  };
  expect(usageBody.data.entries.total).toBe(2);
  for (const entry of usageBody.data.entries.items) {
    expect(entry.codeId).not.toBeNull();
    expect(entry.maskedCode).toMatch(/^OP.+AT$/);
    expect(entry.maskedCode).not.toBe(CODE_LITERAL);
  }
  const historyApi = await hqContext.request.get(`/api/admin/discounts/${OFFER}/history`);
  expect(await historyApi.text()).not.toContain(CODE_LITERAL);

  // History: actual revision/actor/time from the immutable audit rows.
  await expect(page.getByText("Histori audit")).toBeVisible();
  await expect(page.getByText("Aktor: HQ Manager").first()).toBeVisible();
  await expect(page.getByText(/revision 1/).first()).toBeVisible();

  // The protected editor detail is the literal channel.
  const detail = await hqContext.request.get(`/api/admin/discounts/${OFFER}`);
  const detailBody = await detail.text();
  expect(detail.status()).toBe(200);
  expect(detailBody).toContain(CODE_LITERAL);
  expect(detailBody).toContain('"codeLiteralVisible":true');

  // No reset/force-release/refund control exists.
  await expect(page.getByRole("button", { name: /reset usage|force release|refund/i })).toHaveCount(0);
  await page.close();
});

test("promo viewer without Orders:view gets the aggregate only", async ({ browser }) => {
  const context = await browser.newContext({ baseURL: ADMIN_BASE_URL });
  await signInAsCreatedUser(context, EMAIL_NO_ORDERS);
  try {
    const page = await openOfferFromList(context, OFFER_NAME);
    await expect(page.getByText("Pemakaian redemption (agregat saja)")).toBeVisible();
    await expect(
      page.getByText(/hanya agregat global yang ditampilkan/)
    ).toBeVisible();
    await expect(page.locator(`a[href="/admin/orders/${JKT_ORDER}"]`)).toHaveCount(0);
    await expect(page.locator(`a[href="/admin/orders/${SBY_ORDER}"]`)).toHaveCount(0);

    const usage = await context.request.get(`/api/admin/discounts/${OFFER}/usage`);
    expect(usage.status()).toBe(200);
    const raw = await usage.text();
    for (const secret of [JKT_ORDER, SBY_ORDER, CLIENT, "Ops12 Client", "Jakarta Ops12", "Surabaya Ops12"]) {
      expect(raw).not.toContain(secret);
    }
    expect(raw).toContain('"entriesAccess":"aggregate_only"');
    expect(raw).toContain('"basis":"global"');
    await page.close();
  } finally {
    await context.close();
  }
});

test("Jakarta own-branch viewer cannot open the Surabaya entry by filter, id or count", async ({
  browser,
}) => {
  const context = await browser.newContext({ baseURL: ADMIN_BASE_URL });
  await signInAsCreatedUser(context, EMAIL_JKT);
  try {
    const page = await openOfferFromList(context, OFFER_NAME);
    await expect(page.getByText("Pemakaian redemption (cabang Anda)")).toBeVisible();
    await expect(page.locator(`a[href="/admin/orders/${JKT_ORDER}"]`)).toBeVisible();
    await expect(page.locator(`a[href="/admin/orders/${SBY_ORDER}"]`)).toHaveCount(0);

    const usage = await context.request.get(
      `/api/admin/discounts/${OFFER}/usage`
    );
    const body = (await usage.json()) as {
      data: { entries: { total: number; items: Array<{ orderId: string }> } };
    };
    expect(body.data.entries.total).toBe(1);
    expect(body.data.entries.items.map((item) => item.orderId)).toEqual([JKT_ORDER]);

    const direct = await context.request.get(
      `/api/admin/discounts/${OFFER}/usage?entryId=${SBY_REDEMPTION}`
    );
    expect(direct.status()).toBe(404);

    const widened = await context.request.get(
      `/api/admin/discounts/${OFFER}/usage?branchId=other-branch&page=2&limit=1`
    );
    expect(widened.status()).toBe(403);

    // The raw viewer payload never carries the Surabaya order or the literal.
    const raw = await usage.text();
    expect(raw).not.toContain(SBY_ORDER);
    expect(raw).not.toContain(CODE_LITERAL);
    await page.close();
  } finally {
    await context.close();
  }
});

test("safe pause stops new use without cancelling or resetting held entries", async () => {
  const page = await openOfferFromList(hqContext, OFFER_NAME);
  const usageBefore = await hqContext.request.get(
    `/api/admin/discounts/${OFFER}/usage`
  );
  const before = (await usageBefore.json()) as {
    data: { entries: { items: Array<{ id: string; status: string }> }; availability: unknown };
  };

  await page.getByRole("button", { name: "Jeda", exact: true }).click();
  await expect(page.getByText("Jeda offer?")).toBeVisible();
  await expect(
    page.getByText(/Hold yang sudah ada tidak dibatalkan dan usage tidak di-reset/)
  ).toBeVisible();
  await page.getByRole("button", { name: "Ya, lanjutkan" }).click();
  await expect(page.getByText("Dijeda", { exact: true })).toBeVisible();

  const usageAfter = await hqContext.request.get(
    `/api/admin/discounts/${OFFER}/usage`
  );
  const after = (await usageAfter.json()) as typeof before;
  expect(after.data.entries.items, "pause must not cancel or reorder held entries").toEqual(
    before.data.entries.items
  );
  expect(after.data.availability).toEqual(before.data.availability);
  await expect(page.getByRole("button", { name: /reset usage|force release/i })).toHaveCount(0);
  await page.close();
});

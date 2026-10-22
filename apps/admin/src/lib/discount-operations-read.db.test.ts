import dotenv from "dotenv";
import path from "node:path";
dotenv.config({ path: path.resolve(import.meta.dirname, "../../../../.env"), quiet: true });

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";

import {
  addDiscountCode,
  createPublicDraftOffer,
  getDiscountOfferDetail,
  setDiscountOfferPolicy,
  setDiscountOfferState,
} from "./discounts-administration";
import {
  readDiscountOfferHistory,
  readDiscountOfferUsage,
} from "./discount-operations-read";

// =========================================================
// Seam T — real usage reads, Orders scope, capacity races and retention
// (ticket 12)
// =========================================================
// Fixtures are written through SQL because this file needs a *real* ledger
// (orders + redemptions + allocations + events + counters) that only the
// lifecycle slices can create in production. Every ASSERTION goes through the
// documented read/mutation interface; SQL is used for fixture setup, the
// deliberate projection drift, and schema-constraint probes.
//
// Expected values are independent literals:
//   quota 100 / held 1 / consumed 1 → available 98
//   budget 100000 / held 25000 / consumed 25000 → available 50000
//   per-client max commitment 2 → lowering the limit to 1 is refused
//
// DATABASE_URL must point at a disposable `marketplace_discounts_test_*` DB.

const url = process.env.DATABASE_URL;
const TEST_PREFIX = "marketplace_discounts_test_";

function databaseNameOf(connectionString: string): string | null {
  try {
    const parsed = new URL(connectionString);
    const name = decodeURIComponent(parsed.pathname).replace(/^\/+/, "").split("/")[0];
    return name || null;
  } catch {
    return null;
  }
}

if (url) {
  const name = databaseNameOf(url);
  if (!name || !name.startsWith(TEST_PREFIX)) {
    throw new Error(
      `[discount-ops-read-db] Refusing to mutate database "${name ?? "<unknown>"}": ` +
        `DATABASE_URL must point at a "${TEST_PREFIX}*" database.`
    );
  }
}

const RUN = crypto.randomUUID();
const PREFIX = `zz-ops12-${RUN}`;
const JKT = `${PREFIX}-branch-jkt`;
const SBY = `${PREFIX}-branch-sby`;
const PRODUCT = `${PREFIX}-product`;
const VARIANT = `${PREFIX}-variant`;
const CLIENT_A = `${PREFIX}-client-a`;
const CLIENT_B = `${PREFIX}-client-b`;

// Admin read/write interfaces validate Offer ids as UUIDs, so the Offer-side
// fixtures use real UUIDs; order/redemption ids may keep the readable prefix.
const PUBLIC_OFFER = randomUUID();
const PUBLIC_REVISION = randomUUID();
const PUBLIC_BENEFIT = randomUUID();
const MANUAL_OFFER = randomUUID();
const MANUAL_REVISION = randomUUID();
const MANUAL_BENEFIT = randomUUID();
const MANUAL_CODE = randomUUID();
const MANUAL_CODE_LITERAL = "HEMATFIXTURE";

const ORDER_PUB_JKT_RESERVED = `${PREFIX}-order-pub-jkt-reserved`;
const ORDER_MAN_JKT_RESERVED = `${PREFIX}-order-man-jkt-reserved`;
const ORDER_MAN_SBY_RELEASED = `${PREFIX}-order-man-sby-released`;
const ORDER_MAN_JKT_CONSUMED = `${PREFIX}-order-man-jkt-consumed`;

const RED_PUB_JKT_RESERVED = `${PREFIX}-red-pub-jkt-reserved`;
const RED_MAN_JKT_RESERVED = `${PREFIX}-red-man-jkt-reserved`;
const RED_MAN_SBY_RELEASED = `${PREFIX}-red-man-sby-released`;
const RED_MAN_JKT_CONSUMED = `${PREFIX}-red-man-jkt-consumed`;

const ROLE_EDITOR = `${PREFIX}-role-editor`;
const ROLE_NO_ORDERS = `${PREFIX}-role-no-orders`;
const ROLE_JKT = `${PREFIX}-role-jkt`;
const ROLE_SBY = `${PREFIX}-role-sby`;
const ROLE_REVOKED = `${PREFIX}-role-revoked`;
const ACTOR_EDITOR = `${PREFIX}-actor-editor`;
const ACTOR_NO_ORDERS = `${PREFIX}-actor-no-orders`;
const ACTOR_JKT = `${PREFIX}-actor-jkt`;
const ACTOR_SBY = `${PREFIX}-actor-sby`;
const ACTOR_REVOKED = `${PREFIX}-actor-revoked`;
const ROLE_IDS = [ROLE_EDITOR, ROLE_NO_ORDERS, ROLE_JKT, ROLE_SBY, ROLE_REVOKED];
const ACTOR_IDS = [ACTOR_EDITOR, ACTOR_NO_ORDERS, ACTOR_JKT, ACTOR_SBY, ACTOR_REVOKED];

const pool = url ? new Pool({ connectionString: url, max: 6 }) : null;

async function ready(): Promise<boolean> {
  if (!pool) return false;
  const result = await pool.query(
    `select to_regclass('public.discount_redemption') is not null
        and to_regclass('public.discount_redemption_event') is not null
        and to_regclass('public.discount_offer_usage') is not null as ok`
  );
  return result.rows[0]?.ok === true;
}

const dbReady = await ready();

it.skipIf(dbReady)(
  "environment blocker: usage/privacy/capacity reads NOT verified (requires PostgreSQL)",
  () => {
    throw new Error(
      "Usage/privacy/capacity tests NOT run — ticket 12 remains UNVERIFIED without a disposable PostgreSQL database."
    );
  }
);

async function setGate(value: "0" | "1"): Promise<void> {
  await pool!.query(
    `INSERT INTO system_config (key, value, type, description)
     VALUES ('discounts.contractVersion', $1, 'number', 'ops12 test gate')
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [value]
  );
}

async function insertActor(input: {
  roleId: string;
  roleName: string;
  userId: string;
  email: string;
  homeBranchId: string | null;
  grants: Array<[string, string, string]>;
}): Promise<void> {
  await pool!.query(
    `INSERT INTO admin_role (id, key, name, description, is_system, version)
     VALUES ($1, NULL, $2, 'ops12 fixture', false, 1)`,
    [input.roleId, input.roleName]
  );
  await pool!.query(
    `INSERT INTO "user" (id, name, email, role_id, is_active, email_verified, branch_id)
     VALUES ($1, $2, $3, $4, true, true, $5)`,
    [input.userId, input.roleName, input.email, input.roleId, input.homeBranchId]
  );
  for (const [module, action, scope] of input.grants) {
    await pool!.query(
      `INSERT INTO admin_role_grant (id, role_id, module, action, scope)
       VALUES ($1, $2, $3, $4, $5)`,
      [`${input.roleId}-${module}-${action}`, input.roleId, module, action, scope]
    );
  }
}

async function insertOrder(input: {
  id: string;
  clientId: string;
  branchId: string;
  status: string;
  paymentStatus: string;
  blocked?: string | null;
}): Promise<void> {
  await pool!.query(
    `INSERT INTO orders
       (id, user_id, branch_id, status, payment_status, contact_phone, contact_email,
        subtotal, shipping_cost, discount, service_fee, ppn_rate, ppn_amount, total,
        fulfillment_blocked_reason)
     VALUES ($1,$2,$3,$4,$5,'081200000000','fixture@example.test',
             '150000','0','25000','0','11','13750','138750', $6)`,
    [
      input.id,
      input.clientId,
      input.branchId,
      input.status,
      input.paymentStatus,
      input.blocked ?? null,
    ]
  );
  await pool!.query(
    `INSERT INTO order_item
       (id, order_id, variant_id, product_name, price, quantity,
        pricing_contract_version, source_unit_price, markdown_amount,
        goods_discount_amount, net_line_amount)
     VALUES ($1,$2,$3,'Fixture','150000',1,1,'150000','0','25000','125000')`,
    [`${input.id}-item`, input.id, VARIANT]
  );
}

async function insertRedemption(input: {
  id: string;
  orderId: string;
  clientId: string;
  offerId: string;
  revisionId: string;
  benefitId: string;
  status: "reserved" | "consumed" | "released";
  activationKind: "public" | "manual_only";
  codeId?: string | null;
  latePaidReview?: boolean;
}): Promise<void> {
  const amount = "25000";
  const now = new Date();
  await pool!.query(
    `INSERT INTO discount_redemption
       (id, order_id, client_id, offer_id, revision_id, benefit_id, activation_kind,
        code_id, status, benefit_amount, deadline, policy_version,
        terms_snapshot, result_snapshot, reserved_at, consumed_at, released_at,
        terminal_reason, release_source)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,1,
             '{"name":"Fixture"}'::jsonb,'{"version":1}'::jsonb,$12,$13,$14,$15,$16)`,
    [
      input.id,
      input.orderId,
      input.clientId,
      input.offerId,
      input.revisionId,
      input.benefitId,
      input.activationKind,
      input.codeId ?? null,
      input.status,
      amount,
      new Date(now.getTime() + 15 * 60_000),
      now,
      input.status === "consumed" ? now : null,
      input.status === "released" ? now : null,
      input.status === "released" ? "late paid after release" : null,
      input.status === "released" ? "midtrans" : null,
    ]
  );
  await pool!.query(
    `INSERT INTO discount_redemption_event
       (id, redemption_id, event_key, kind, previous_status, next_status, amount, source)
     VALUES ($1,$2,$3,'reserved',NULL,'reserved',$4,'checkout')`,
    [randomUUID(), input.id, `${input.id}:reserved`, amount]
  );
  if (input.status === "consumed") {
    await pool!.query(
      `INSERT INTO discount_redemption_event
         (id, redemption_id, event_key, kind, previous_status, next_status, amount, source)
       VALUES ($1,$2,$3,'consumed','reserved','consumed',$4,'midtrans')`,
      [randomUUID(), input.id, `${input.id}:consumed`, amount]
    );
  }
  if (input.status === "released") {
    await pool!.query(
      `INSERT INTO discount_redemption_event
         (id, redemption_id, event_key, kind, previous_status, next_status, amount, source)
       VALUES ($1,$2,$3,'released','reserved','released',$4,'midtrans')`,
      [randomUUID(), input.id, `${input.id}:released`, amount]
    );
  }
  if (input.latePaidReview) {
    await pool!.query(
      `INSERT INTO discount_redemption_event
         (id, redemption_id, event_key, kind, previous_status, next_status, amount, source, reason)
       VALUES ($1,$2,$3,'late_paid_review','released','released',$4,'midtrans','paid after release')`,
      [randomUUID(), input.id, `${input.id}:late_paid_review:fixture`, amount]
    );
  }
  await pool!.query(
    `INSERT INTO order_discount_allocation
       (id, order_id, order_item_id, component, redemption_id, benefit_id, amount)
     VALUES ($1,$2,$3,'offer_goods',$4,$5,$6)`,
    [randomUUID(), input.orderId, `${input.orderId}-item`, input.id, input.benefitId, amount]
  );
}

async function cleanup(): Promise<void> {
  if (!pool) return;
  const offerIds = [PUBLIC_OFFER, MANUAL_OFFER];
  await pool.query(`DELETE FROM audit_log WHERE entity_id = ANY($1::text[])`, [offerIds]);
  await pool.query(
    `DELETE FROM discount_redemption_event
      WHERE redemption_id IN (SELECT id FROM discount_redemption WHERE offer_id = ANY($1::text[]))`,
    [offerIds]
  );
  await pool.query(
    `DELETE FROM order_discount_allocation
      WHERE order_id IN (SELECT id FROM orders WHERE user_id = ANY($1::text[]))`,
    [[CLIENT_A, CLIENT_B]]
  );
  await pool.query(`DELETE FROM discount_redemption WHERE offer_id = ANY($1::text[])`, [offerIds]);
  await pool.query(`DELETE FROM discount_client_usage WHERE offer_id = ANY($1::text[])`, [offerIds]);
  await pool.query(`DELETE FROM discount_offer_usage WHERE offer_id = ANY($1::text[])`, [offerIds]);
  await pool.query(`DELETE FROM discount_code WHERE offer_id = ANY($1::text[])`, [offerIds]);
  await pool.query(`DELETE FROM discount_benefit WHERE revision_id = ANY($1::text[])`, [
    [PUBLIC_REVISION, MANUAL_REVISION],
  ]);
  await pool.query(
    `UPDATE discount_offer SET state='draft', current_revision_id=NULL WHERE id = ANY($1::text[])`,
    [offerIds]
  );
  await pool.query(`DELETE FROM discount_offer_revision WHERE offer_id = ANY($1::text[])`, [offerIds]);
  await pool.query(`DELETE FROM discount_offer WHERE id = ANY($1::text[])`, [offerIds]);
  await pool.query(
    `DELETE FROM order_item
      WHERE order_id IN (SELECT id FROM orders WHERE user_id = ANY($1::text[]))`,
    [[CLIENT_A, CLIENT_B]]
  );
  await pool.query(`DELETE FROM orders WHERE user_id = ANY($1::text[])`, [[CLIENT_A, CLIENT_B]]);
  await pool.query(`DELETE FROM product_variant WHERE id=$1`, [VARIANT]);
  await pool.query(`DELETE FROM product WHERE id=$1`, [PRODUCT]);
  await pool.query(`DELETE FROM client WHERE id = ANY($1::text[])`, [[CLIENT_A, CLIENT_B]]);
  // Admin Users reference their Home Branch: receipts/grants/users before it.
  await pool.query(`DELETE FROM discount_admin_request WHERE actor_identity = ANY($1::text[])`, [
    ACTOR_IDS,
  ]);
  await pool.query(`DELETE FROM admin_role_grant WHERE role_id = ANY($1::text[])`, [ROLE_IDS]);
  await pool.query(`DELETE FROM "user" WHERE id = ANY($1::text[])`, [ACTOR_IDS]);
  await pool.query(`DELETE FROM admin_role WHERE id = ANY($1::text[])`, [ROLE_IDS]);
  await pool.query(`DELETE FROM branch WHERE id = ANY($1::text[])`, [[JKT, SBY]]);
}

describe.skipIf(!dbReady)("discount ops reads, privacy and capacity (disposable DB)", () => {
  beforeAll(async () => {
    if (!pool) return;
    await cleanup();
    await setGate("1");

    await pool.query(
      `INSERT INTO branch (id, name, code, city, address) VALUES
         ($1,'Jakarta Ops12',$3,'Jakarta Pusat','Fixture'),
         ($2,'Surabaya Ops12',$4,'Surabaya','Fixture')`,
      [JKT, SBY, `O12JKT-${RUN.slice(0, 8)}`, `O12SBY-${RUN.slice(0, 8)}`]
    );
    await pool.query(
      `INSERT INTO product (id, name, slug, base_price) VALUES ($1,'Ops12 Fixture',$2,'150000')`,
      [PRODUCT, PREFIX]
    );
    await pool.query(
      `INSERT INTO product_variant (id, product_id, sku, price) VALUES ($1,$2,$3,'150000')`,
      [VARIANT, PRODUCT, `${PREFIX}-sku`]
    );
    await pool.query(
      `INSERT INTO client (id, name, email, email_verified) VALUES
         ($1,'Ops Client A','ops-a@example.test',true),
         ($2,'Ops Client B','ops-b@example.test',true)`,
      [CLIENT_A, CLIENT_B]
    );

    // Public Offer: quota100 / budget100000 (the unit test pins the 90+10
    // example; here the ledger must drive the same arithmetic).
    await pool.query(
      `INSERT INTO discount_offer
         (id, key, activation_kind, actor_identity, per_client_limit)
       VALUES ($1,$2,'public','fixture',4)`,
      [PUBLIC_OFFER, `${PUBLIC_OFFER}-key`]
    );
    await pool.query(
      `INSERT INTO discount_offer_revision
         (id, offer_id, revision_no, name, currency, min_subtotal, published_at, actor_identity)
       VALUES ($1,$2,1,'Kupon Ops12','IDR','0',now(),'fixture')`,
      [PUBLIC_REVISION, PUBLIC_OFFER]
    );
    await pool.query(
      `INSERT INTO discount_benefit (id, revision_id, kind, scope, fixed_amount)
       VALUES ($1,$2,'fixed_goods','goods','25000')`,
      [PUBLIC_BENEFIT, PUBLIC_REVISION]
    );
    await pool.query(
      `UPDATE discount_offer
          SET state='enabled', current_revision_id=$2, quota_count=100,
              budget_amount='100000'
        WHERE id=$1`,
      [PUBLIC_OFFER, PUBLIC_REVISION]
    );
    await pool.query(
      `INSERT INTO discount_offer_usage
         (offer_id, reserved_count, consumed_count, reserved_amount, consumed_amount, version)
       VALUES ($1, 1, 0, '25000', '0', 2)`,
      [PUBLIC_OFFER]
    );

    // Manual Offer: one reserved code, one consumed Redemption sharing the SAME
    // projection as the public offer would if it were the same identity.
    await pool.query(
      `INSERT INTO discount_offer
         (id, key, activation_kind, actor_identity, per_client_limit)
       VALUES ($1,$2,'manual_only','fixture',4)`,
      [MANUAL_OFFER, `${MANUAL_OFFER}-key`]
    );
    await pool.query(
      `INSERT INTO discount_offer_revision
         (id, offer_id, revision_no, name, currency, min_subtotal, published_at, actor_identity)
       VALUES ($1,$2,1,'Kode Ops12','IDR','0',now(),'fixture')`,
      [MANUAL_REVISION, MANUAL_OFFER]
    );
    await pool.query(
      `INSERT INTO discount_benefit (id, revision_id, kind, scope, fixed_amount)
       VALUES ($1,$2,'fixed_goods','goods','25000')`,
      [MANUAL_BENEFIT, MANUAL_REVISION]
    );
    await pool.query(
      `UPDATE discount_offer
          SET state='enabled', current_revision_id=$2, quota_count=10
        WHERE id=$1`,
      [MANUAL_OFFER, MANUAL_REVISION]
    );
    await pool.query(
      `INSERT INTO discount_offer_usage (offer_id, reserved_count, consumed_count, reserved_amount, consumed_amount, version)
       VALUES ($1, 1, 1, '25000', '25000', 2)`,
      [MANUAL_OFFER]
    );
    await pool.query(
      `INSERT INTO discount_code
         (id, offer_id, activation_kind, canonical_code, state, version, published_at, actor_identity)
       VALUES ($1,$2,'manual_only',$3,'active',1,now(),'fixture')`,
      [MANUAL_CODE, MANUAL_OFFER, MANUAL_CODE_LITERAL]
    );
    await pool.query(
      `INSERT INTO discount_client_usage
         (offer_id, client_id, reserved_count, consumed_count, reserved_amount, consumed_amount, version)
       VALUES ($1,$2,1,0,'25000','0',1),
              ($3,$2,1,1,'25000','25000',2)`,
      [PUBLIC_OFFER, CLIENT_A, MANUAL_OFFER]
    );

    // Orders/Redemptions:
    //   public Offer  → one JKT reserved hold (JKT order)
    //   manual Offer  → one JKT reserved hold, one SBY paid-but-blocked
    //                   released hold with a late_paid_review, one JKT consumed
    //                   Redemption naming the manual code.
    await insertOrder({
      id: ORDER_PUB_JKT_RESERVED,
      clientId: CLIENT_A,
      branchId: JKT,
      status: "pending_payment",
      paymentStatus: "pending",
    });
    await insertOrder({
      id: ORDER_MAN_JKT_RESERVED,
      clientId: CLIENT_A,
      branchId: JKT,
      status: "pending_payment",
      paymentStatus: "pending",
    });
    await insertOrder({
      id: ORDER_MAN_SBY_RELEASED,
      clientId: CLIENT_B,
      branchId: SBY,
      status: "processing",
      paymentStatus: "paid",
      blocked: "sales-settlement-unverified",
    });
    await insertOrder({
      id: ORDER_MAN_JKT_CONSUMED,
      clientId: CLIENT_A,
      branchId: JKT,
      status: "completed",
      paymentStatus: "paid",
    });

    await insertRedemption({
      id: RED_PUB_JKT_RESERVED,
      orderId: ORDER_PUB_JKT_RESERVED,
      clientId: CLIENT_A,
      offerId: PUBLIC_OFFER,
      revisionId: PUBLIC_REVISION,
      benefitId: PUBLIC_BENEFIT,
      status: "reserved",
      activationKind: "public",
    });
    await insertRedemption({
      id: RED_MAN_JKT_RESERVED,
      orderId: ORDER_MAN_JKT_RESERVED,
      clientId: CLIENT_A,
      offerId: MANUAL_OFFER,
      revisionId: MANUAL_REVISION,
      benefitId: MANUAL_BENEFIT,
      status: "reserved",
      activationKind: "public",
    });
    await insertRedemption({
      id: RED_MAN_SBY_RELEASED,
      orderId: ORDER_MAN_SBY_RELEASED,
      clientId: CLIENT_B,
      offerId: MANUAL_OFFER,
      revisionId: MANUAL_REVISION,
      benefitId: MANUAL_BENEFIT,
      status: "released",
      activationKind: "public",
      latePaidReview: true,
    });
    await insertRedemption({
      id: RED_MAN_JKT_CONSUMED,
      orderId: ORDER_MAN_JKT_CONSUMED,
      clientId: CLIENT_A,
      offerId: MANUAL_OFFER,
      revisionId: MANUAL_REVISION,
      benefitId: MANUAL_BENEFIT,
      status: "consumed",
      activationKind: "manual_only",
      codeId: MANUAL_CODE,
    });

    // Actors: editor (all grants), aggregate-only viewer (no Orders), Jakarta
    // own-branch viewer, Surabaya own-branch viewer, revoked editor.
    await insertActor({
      roleId: ROLE_EDITOR,
      roleName: `Ops12 Editor ${RUN.slice(0, 8)}`,
      userId: ACTOR_EDITOR,
      email: `${ACTOR_EDITOR}@example.test`,
      homeBranchId: JKT,
      grants: [
        ["discounts", "view", "global"],
        ["discounts", "edit", "global"],
        ["discount_capacity", "view", "global"],
        ["discount_capacity", "edit", "global"],
        ["orders", "view", "all_branches"],
      ],
    });
    await insertActor({
      roleId: ROLE_NO_ORDERS,
      roleName: `Ops12 Aggregate ${RUN.slice(0, 8)}`,
      userId: ACTOR_NO_ORDERS,
      email: `${ACTOR_NO_ORDERS}@example.test`,
      homeBranchId: JKT,
      grants: [["discounts", "view", "global"]],
    });
    await insertActor({
      roleId: ROLE_JKT,
      roleName: `Ops12 Jakarta ${RUN.slice(0, 8)}`,
      userId: ACTOR_JKT,
      email: `${ACTOR_JKT}@example.test`,
      homeBranchId: JKT,
      grants: [
        ["discounts", "view", "global"],
        ["orders", "view", "own_branch"],
      ],
    });
    await insertActor({
      roleId: ROLE_SBY,
      roleName: `Ops12 Surabaya ${RUN.slice(0, 8)}`,
      userId: ACTOR_SBY,
      email: `${ACTOR_SBY}@example.test`,
      homeBranchId: SBY,
      grants: [
        ["discounts", "view", "global"],
        ["orders", "view", "own_branch"],
      ],
    });
    await insertActor({
      roleId: ROLE_REVOKED,
      roleName: `Ops12 Revoked ${RUN.slice(0, 8)}`,
      userId: ACTOR_REVOKED,
      email: `${ACTOR_REVOKED}@example.test`,
      homeBranchId: JKT,
      grants: [["discounts", "view", "global"]],
    });

    // Immutable history fixtures: a code event carrying only a masked label and
    // an actor identity string that survives its FK becoming NULL.
    await pool.query(
      `INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, changes, policy_version, branch_scope)
       VALUES ($1,$2,'DISCOUNT_CODE_ADDED','discount_offer',$3,$4::jsonb,1,'global'),
              ($5,$2,'DISCOUNT_OFFER_DRAFT_SAVED','discount_offer',$3,$6::jsonb,1,'global')`,
      [
        randomUUID(),
        ACTOR_EDITOR,
        MANUAL_OFFER,
        JSON.stringify({
          actorIdentity: ACTOR_EDITOR,
          codeId: MANUAL_CODE,
          maskedCode: "HE•••••••••RE",
        }),
        randomUUID(),
        JSON.stringify({
          actorIdentity: ACTOR_EDITOR,
          draftRevisionId: MANUAL_REVISION,
          draftVersionAfter: 2,
        }),
      ]
    );
  }, 60_000);

  afterAll(async () => {
    if (!pool) return;
    try {
      await cleanup();
      await setGate("0");
    } finally {
      await pool.end();
    }
  });

  it("reports global consumed+held+available and never conflates the scoped list", async () => {
    const result = await readDiscountOfferUsage({
      offerId: PUBLIC_OFFER,
      actorUserId: ACTOR_EDITOR,
    });
    expect(result.availability).toEqual({
      basis: "global",
      consumedCount: 0,
      heldCount: 1,
      consumedAmount: "0",
      heldAmount: "25000",
      availableCount: 99,
      availableAmount: "75000",
    });
    expect(result.capacity).toEqual({
      quotaCount: 100,
      budgetAmount: "100000",
      perClientLimit: 4,
    });
    expect(result.drift).toMatchObject({ detected: false, action: null });
    expect(result.entriesAccess).toBe("scoped");
    expect(result.entries).toMatchObject({ total: 1, page: 1, limit: 20, totalPages: 1 });
    expect(result.note).toContain("tidak mewakili total global");

    // The Offer detail carries the same global summary (consumed + held +
    // available) so the editor page never has to derive capacity from a scoped
    // entries list.
    const detail = await getDiscountOfferDetail(PUBLIC_OFFER, ACTOR_EDITOR);
    expect(detail?.capacitySummary).toEqual({
      basis: "global",
      consumedCount: 0,
      heldCount: 1,
      consumedAmount: "0",
      heldAmount: "25000",
      availableCount: 99,
      availableAmount: "75000",
    });
  });

  it("returns the aggregate only (no order/customer identity) without Orders:view", async () => {
    const result = await readDiscountOfferUsage({
      offerId: MANUAL_OFFER,
      actorUserId: ACTOR_NO_ORDERS,
      filters: { branchId: SBY, entryId: RED_MAN_SBY_RELEASED },
    });
    expect(result.entriesAccess).toBe("aggregate_only");
    expect(result.entries).toBeNull();
    expect(result.scope).toBeNull();
    expect(result.availability.heldCount).toBe(1);
    const payload = JSON.stringify(result);
    for (const secret of [ORDER_MAN_SBY_RELEASED, CLIENT_B, "Ops Client B", "Surabaya Ops12"]) {
      expect(payload).not.toContain(secret);
    }
  });

  it("scopes Jakarta entries and refuses to open Bandung/Surabaya by id, filter, page or count", async () => {
    const jkt = await readDiscountOfferUsage({
      offerId: MANUAL_OFFER,
      actorUserId: ACTOR_JKT,
    });
    expect(jkt.scope).toEqual({ mode: "own", branchId: JKT });
    expect(jkt.entries?.total).toBe(2);
    expect(jkt.entries?.items.map((item) => item.orderId).sort()).toEqual(
      [ORDER_MAN_JKT_CONSUMED, ORDER_MAN_JKT_RESERVED].sort()
    );
    expect(JSON.stringify(jkt.entries)).not.toContain(ORDER_MAN_SBY_RELEASED);

    // Direct id of the Surabaya entry: 404, not an empty page.
    await expect(
      readDiscountOfferUsage({
        offerId: MANUAL_OFFER,
        actorUserId: ACTOR_JKT,
        filters: { entryId: RED_MAN_SBY_RELEASED },
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    // A foreign branchId cannot widen the predicate; count/page stay Jakarta.
    await expect(
      readDiscountOfferUsage({
        offerId: MANUAL_OFFER,
        actorUserId: ACTOR_JKT,
        filters: { branchId: SBY },
      })
    ).rejects.toMatchObject({ code: "DENIED" });
    const pageWidened = await readDiscountOfferUsage({
      offerId: MANUAL_OFFER,
      actorUserId: ACTOR_JKT,
      filters: { page: 2, limit: 1 },
    });
    expect(pageWidened.entries?.total).toBe(2);
    expect(pageWidened.entries?.items).toHaveLength(1);
    expect(JSON.stringify(pageWidened.entries)).not.toContain(ORDER_MAN_SBY_RELEASED);

    // The Surabaya viewer sees the complementary half, never Jakarta.
    const sby = await readDiscountOfferUsage({
      offerId: MANUAL_OFFER,
      actorUserId: ACTOR_SBY,
    });
    expect(sby.entries?.items.map((item) => item.orderId)).toEqual([ORDER_MAN_SBY_RELEASED]);
    expect(JSON.stringify(sby.entries)).not.toContain(ORDER_MAN_JKT_RESERVED);

    // All-branch may narrow explicitly.
    const narrowed = await readDiscountOfferUsage({
      offerId: MANUAL_OFFER,
      actorUserId: ACTOR_EDITOR,
      filters: { branchId: SBY, status: "released" },
    });
    expect(narrowed.entries).toMatchObject({ total: 1 });
    expect(narrowed.entries?.items[0]).toMatchObject({
      status: "released",
      review: { latePaidReview: true },
      order: {
        fulfillmentBlocked: true,
        fulfillmentBlockedReason: "sales-settlement-unverified",
      },
      branch: { id: SBY, name: "Surabaya Ops12" },
    });
  });

  it("masks code labels in detail/usage/history for non-editors while an editor still traces id+literal", async () => {
    const viewerDetail = await getDiscountOfferDetail(MANUAL_OFFER, ACTOR_JKT);
    expect(viewerDetail?.codeLiteralVisible).toBe(false);
    const viewerCode = viewerDetail?.codes.find((code) => code.id === MANUAL_CODE);
    expect(viewerCode?.maskedCode).not.toBe(MANUAL_CODE_LITERAL);
    expect(viewerCode?.maskedCode?.startsWith("HE")).toBe(true);
    expect(viewerCode?.code).toBeUndefined();

    const viewerUsage = await readDiscountOfferUsage({
      offerId: MANUAL_OFFER,
      actorUserId: ACTOR_NO_ORDERS,
    });
    const viewerHistory = await readDiscountOfferHistory({
      offerId: MANUAL_OFFER,
      actorUserId: ACTOR_NO_ORDERS,
    });
    const viewerPayloads = JSON.stringify([viewerDetail, viewerUsage, viewerHistory]);
    expect(viewerPayloads).not.toContain(MANUAL_CODE_LITERAL);

    // History carries the code id + masked label, never the literal, even for
    // the editor interface; the protected detail remains the literal channel.
    const editorHistory = await readDiscountOfferHistory({
      offerId: MANUAL_OFFER,
      actorUserId: ACTOR_EDITOR,
    });
    expect(JSON.stringify(editorHistory)).not.toContain(MANUAL_CODE_LITERAL);
    expect(
      editorHistory.some(
        (entry) =>
          entry.references.codeId === MANUAL_CODE &&
          entry.references.maskedCode !== null
      )
    ).toBe(true);

    const editorDetail = await getDiscountOfferDetail(MANUAL_OFFER, ACTOR_EDITOR);
    expect(editorDetail?.codeLiteralVisible).toBe(true);
    expect(editorDetail?.codes.find((code) => code.id === MANUAL_CODE)?.code).toBe(
      MANUAL_CODE_LITERAL
    );

    // The usage entry is masked for every reader.
    const editorUsage = await readDiscountOfferUsage({
      offerId: MANUAL_OFFER,
      actorUserId: ACTOR_EDITOR,
    });
    expect(JSON.stringify(editorUsage)).not.toContain(MANUAL_CODE_LITERAL);
    expect(
      editorUsage.entries?.items.find((item) => item.codeId === MANUAL_CODE)?.maskedCode
    ).toMatch(/^HE.+RE$/);
  });

  it("keeps safe actor attribution after the Admin User FK becomes NULL", async () => {
    await pool!.query(
      `UPDATE audit_log SET user_id = NULL
        WHERE entity_type='discount_offer' AND entity_id=$1
          AND action='DISCOUNT_OFFER_DRAFT_SAVED'`,
      [MANUAL_OFFER]
    );
    const history = await readDiscountOfferHistory({
      offerId: MANUAL_OFFER,
      actorUserId: ACTOR_EDITOR,
    });
    const entry = history.find(
      (row) => row.action === "DISCOUNT_OFFER_DRAFT_SAVED"
    );
    expect(entry?.actor).toEqual({
      id: null,
      identity: ACTOR_EDITOR,
      label: null,
      available: false,
    });
    expect(entry?.references).toMatchObject({
      draftRevisionId: MANUAL_REVISION,
      draftVersion: 2,
    });
  });

  it("refuses a per-account limit below the indexed client commitment", async () => {
    const before = await getDiscountOfferDetail(MANUAL_OFFER, ACTOR_EDITOR);
    expect(before).not.toBeNull();
    const command = {
      offerId: MANUAL_OFFER,
      requestKey: randomUUID(),
      expectedOfferVersion: before!.version,
      expectedPolicyVersion: before!.policyVersion,
      quotaCount: 10,
      budgetAmount: null,
      perClientLimit: 1,
    };
    await expect(setDiscountOfferPolicy(command, ACTOR_EDITOR)).rejects.toMatchObject({
      code: "CAPACITY_BELOW_COMMITMENTS",
    });

    // The same command at the actual max commitment (2 reserved+consumed for
    // client A) is accepted and never resets usage.
    const current = await getDiscountOfferDetail(MANUAL_OFFER, ACTOR_EDITOR);
    const lowered = await setDiscountOfferPolicy(
      {
        ...command,
        requestKey: randomUUID(),
        expectedOfferVersion: current!.version,
        expectedPolicyVersion: current!.policyVersion,
        perClientLimit: 2,
      },
      ACTOR_EDITOR
    );
    expect(lowered.data.perClientLimit).toBe(2);
    expect(lowered.data.usage).toMatchObject({ reservedCount: 1, consumedCount: 1 });
  });

  it("serialises a capacity reduction behind a concurrent reservation commit", async () => {
    const detail = await getDiscountOfferDetail(PUBLIC_OFFER, ACTOR_EDITOR);
    expect(detail).not.toBeNull();

    const lock = await pool!.connect();
    let settled = false;
    try {
      await lock.query("BEGIN");
      await lock.query(`SELECT id FROM discount_offer WHERE id=$1 FOR UPDATE`, [
        PUBLIC_OFFER,
      ]);
      // The reservation write set (same counters the store module mutates in
      // its commit): one more reserved Redemption, its event and the projection.
      const concurrentOrder = randomUUID();
      const concurrentRedemption = randomUUID();
      const now = new Date();
      await lock.query(
        `INSERT INTO orders (id, user_id, branch_id, status, payment_status, contact_phone, contact_email, subtotal, total)
         VALUES ($1,$2,$3,'pending_payment','pending','081200000001','fixture@example.test','150000','138750')`,
        [concurrentOrder, CLIENT_A, JKT]
      );
      await lock.query(
        `INSERT INTO order_item (id, order_id, variant_id, product_name, price, quantity)
         VALUES ($1,$2,$3,'Fixture','150000',1)`,
        [`${concurrentOrder}-item`, concurrentOrder, VARIANT]
      );
      await lock.query(
        `INSERT INTO discount_redemption
           (id, order_id, client_id, offer_id, revision_id, benefit_id, activation_kind,
            status, benefit_amount, deadline, policy_version, terms_snapshot, result_snapshot)
         VALUES ($1,$2,$3,$4,$5,$6,'public','reserved','25000',$7,1,
                 '{"name":"Fixture"}'::jsonb,'{"version":1}'::jsonb)`,
        [
          concurrentRedemption,
          concurrentOrder,
          CLIENT_A,
          PUBLIC_OFFER,
          PUBLIC_REVISION,
          PUBLIC_BENEFIT,
          new Date(now.getTime() + 15 * 60_000),
        ]
      );
      await lock.query(
        `INSERT INTO discount_redemption_event
           (id, redemption_id, event_key, kind, next_status, amount, source)
         VALUES ($1,$2,$3,'reserved','reserved','25000','checkout')`,
        [randomUUID(), concurrentRedemption, `${concurrentRedemption}:reserved`]
      );
      await lock.query(
        `UPDATE discount_offer_usage
            SET reserved_count = reserved_count + 1,
                reserved_amount = reserved_amount + 25000,
                version = version + 1
          WHERE offer_id=$1`,
        [PUBLIC_OFFER]
      );

      const pending = setDiscountOfferPolicy(
        {
          offerId: PUBLIC_OFFER,
          requestKey: randomUUID(),
          expectedOfferVersion: detail!.version,
          expectedPolicyVersion: detail!.policyVersion,
          // Before the concurrent commit the projection total is 1, so quota 1
          // looks acceptable — only serialisation behind the Offer lock makes
          // this read 2 held and refuse.
          quotaCount: 1,
          budgetAmount: "100000",
          perClientLimit: 4,
        },
        ACTOR_EDITOR
      );
      pending.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        }
      );
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(settled).toBe(false); // blocked on the Offer row lock

      await lock.query("COMMIT");
      await expect(pending).rejects.toMatchObject({
        code: "CAPACITY_BELOW_COMMITMENTS",
      });
    } finally {
      lock.release();
    }

    const after = await getDiscountOfferDetail(PUBLIC_OFFER, ACTOR_EDITOR);
    expect(after?.quotaCount).toBe(100);
    expect(after?.usage).toMatchObject({ reservedCount: 2, consumedCount: 0 });
  });

  it("refuses a global quota/budget reduction below the real reserved commitment", async () => {
    const detail = await getDiscountOfferDetail(PUBLIC_OFFER, ACTOR_EDITOR);
    // Two real reserved holds (25000 each) exist in the ledger: quota 1 and
    // budget 20000 are both below the commitment.
    await expect(
      setDiscountOfferPolicy(
        {
          offerId: PUBLIC_OFFER,
          requestKey: randomUUID(),
          expectedOfferVersion: detail!.version,
          expectedPolicyVersion: detail!.policyVersion,
          quotaCount: 1,
          budgetAmount: "100000",
          perClientLimit: 4,
        },
        ACTOR_EDITOR
      )
    ).rejects.toMatchObject({ code: "CAPACITY_BELOW_COMMITMENTS" });
    await expect(
      setDiscountOfferPolicy(
        {
          offerId: PUBLIC_OFFER,
          requestKey: randomUUID(),
          expectedOfferVersion: detail!.version,
          expectedPolicyVersion: detail!.policyVersion,
          quotaCount: 100,
          budgetAmount: "20000",
          perClientLimit: 4,
        },
        ACTOR_EDITOR
      )
    ).rejects.toMatchObject({ code: "CAPACITY_BELOW_COMMITMENTS" });
    const after = await getDiscountOfferDetail(PUBLIC_OFFER, ACTOR_EDITOR);
    expect(after?.quotaCount).toBe(100);
    expect(after?.budgetAmount).toBe("100000");
    expect(after?.usage).toMatchObject({ reservedCount: 2, consumedCount: 0 });
  });

  it("fails closed on projection drift for capacity writes but still allows a safe pause", async () => {
    // Deliberate drift: the projection claims an extra held Redemption that the
    // append-only ledger does not contain.
    await pool!.query(
      `UPDATE discount_offer_usage SET reserved_count = reserved_count + 1 WHERE offer_id=$1`,
      [PUBLIC_OFFER]
    );
    const usage = await readDiscountOfferUsage({
      offerId: PUBLIC_OFFER,
      actorUserId: ACTOR_EDITOR,
    });
    expect(usage.drift.detected).toBe(true);
    expect(usage.drift.action).toBe("review_required");
    expect(usage.drift.mismatched).toContain("reservedCount");

    const detail = await getDiscountOfferDetail(PUBLIC_OFFER, ACTOR_EDITOR);
    await expect(
      setDiscountOfferPolicy(
        {
          offerId: PUBLIC_OFFER,
          requestKey: randomUUID(),
          expectedOfferVersion: detail!.version,
          expectedPolicyVersion: detail!.policyVersion,
          quotaCount: 100,
          budgetAmount: "100000",
          perClientLimit: 4,
        },
        ACTOR_EDITOR
      )
    ).rejects.toMatchObject({ code: "USAGE_DRIFT_REVIEW" });

    // The safe ops action stays available: pause only stops NEW reservations.
    const current = await getDiscountOfferDetail(PUBLIC_OFFER, ACTOR_EDITOR);
    const paused = await setDiscountOfferState(
      {
        offerId: PUBLIC_OFFER,
        requestKey: randomUUID(),
        expectedVersion: current!.version,
        state: "paused",
      },
      ACTOR_EDITOR
    );
    expect(paused.data.state).toBe("paused");
    // Held/consumed evidence is untouched by pause (no reset, no mass cancel).
    expect(paused.data.usage).toMatchObject({ reservedCount: 3, consumedCount: 0 });

    // Repair the fixture drift through SQL (not an application reset path).
    await pool!.query(
      `UPDATE discount_offer_usage SET reserved_count = reserved_count - 1 WHERE offer_id=$1`,
      [PUBLIC_OFFER]
    );
  });

  it("rejects a stale/revoked policy session and keeps usage across rename/email/code changes", async () => {
    await pool!.query(`DELETE FROM admin_role_grant WHERE role_id=$1`, [ROLE_REVOKED]);
    // Audit:view alone is not a discounts read channel and never a literal
    // bypass: the usage/history readers still deny.
    await pool!.query(
      `INSERT INTO admin_role_grant (id, role_id, module, action, scope)
       VALUES ($1,$2,'audit_log','view','all_branches')`,
      [`${ROLE_REVOKED}-audit-view`, ROLE_REVOKED]
    );
    await expect(
      readDiscountOfferUsage({ offerId: MANUAL_OFFER, actorUserId: ACTOR_REVOKED })
    ).rejects.toMatchObject({ code: "DENIED" });
    await expect(
      readDiscountOfferHistory({ offerId: MANUAL_OFFER, actorUserId: ACTOR_REVOKED })
    ).rejects.toMatchObject({ code: "DENIED" });

    const detail = await getDiscountOfferDetail(PUBLIC_OFFER, ACTOR_EDITOR);
    await expect(
      setDiscountOfferPolicy(
        {
          offerId: PUBLIC_OFFER,
          requestKey: randomUUID(),
          expectedOfferVersion: detail!.version,
          expectedPolicyVersion: detail!.policyVersion,
          quotaCount: 100,
          budgetAmount: "100000",
          perClientLimit: 4,
        },
        ACTOR_REVOKED
      )
    ).rejects.toMatchObject({ code: "DENIED" });

    const before = await readDiscountOfferUsage({
      offerId: MANUAL_OFFER,
      actorUserId: ACTOR_EDITOR,
    });
    await pool!.query(`UPDATE client SET email='renamed-ops@example.test' WHERE id=$1`, [
      CLIENT_A,
    ]);
    await pool!.query(`UPDATE discount_offer SET key=$2 WHERE id=$1`, [
      MANUAL_OFFER,
      `${MANUAL_OFFER}-renamed`,
    ]);
    const manual = await getDiscountOfferDetail(MANUAL_OFFER, ACTOR_EDITOR);
    await addDiscountCode(
      {
        offerId: MANUAL_OFFER,
        requestKey: randomUUID(),
        code: "KODEBARUOPS12",
        expectedOfferVersion: manual!.version,
      },
      ACTOR_EDITOR
    );
    const after = await readDiscountOfferUsage({
      offerId: MANUAL_OFFER,
      actorUserId: ACTOR_EDITOR,
    });
    expect(after.availability).toMatchObject({
      heldCount: before.availability.heldCount,
      consumedCount: before.availability.consumedCount,
      heldAmount: before.availability.heldAmount,
      consumedAmount: before.availability.consumedAmount,
    });
  });

  it("retention restricts hard deletes and archival never reopens a reserved literal", async () => {
    await expect(
      pool!.query(`DELETE FROM orders WHERE id=$1`, [ORDER_MAN_JKT_CONSUMED])
    ).rejects.toMatchObject({ code: "23503" });
    await expect(
      pool!.query(`DELETE FROM client WHERE id=$1`, [CLIENT_A])
    ).rejects.toMatchObject({ code: "23503" });
    await expect(
      pool!.query(`DELETE FROM discount_offer WHERE id=$1`, [MANUAL_OFFER])
    ).rejects.toMatchObject({ code: "23503" });
    await expect(
      pool!.query(`DELETE FROM discount_code WHERE id=$1`, [MANUAL_CODE])
    ).rejects.toMatchObject({ code: "23503" });
    await expect(
      pool!.query(`DELETE FROM discount_redemption WHERE id=$1`, [RED_MAN_JKT_CONSUMED])
    ).rejects.toMatchObject({ code: "23503" });
    await expect(
      pool!.query(`DELETE FROM product_variant WHERE id=$1`, [VARIANT])
    ).rejects.toMatchObject({ code: "23503" });

    // Archive is not a hard delete and does not free the canonical literal for
    // reuse by another Offer.
    const manual = await getDiscountOfferDetail(MANUAL_OFFER, ACTOR_EDITOR);
    const archived = await setDiscountOfferState(
      {
        offerId: MANUAL_OFFER,
        requestKey: randomUUID(),
        expectedVersion: manual!.version,
        state: "archived",
      },
      ACTOR_EDITOR
    );
    expect(archived.data.state).toBe("archived");
    const codes = await pool!.query(
      `SELECT canonical_code FROM discount_code WHERE offer_id=$1`,
      [MANUAL_OFFER]
    );
    expect(codes.rows.map((row) => row.canonical_code)).toContain(MANUAL_CODE_LITERAL);

    // Archival never frees the published literal for another Offer.
    await expect(
      createPublicDraftOffer(
        {
          requestKey: randomUUID(),
          activationKind: "manual_only",
          codes: [MANUAL_CODE_LITERAL],
        },
        ACTOR_EDITOR
      )
    ).rejects.toMatchObject({ code: "CODE_CONFLICT" });
  });
});

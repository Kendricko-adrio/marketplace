/**
 * SQL constraint seam — Redemption/Coupon lifecycle (ticket 07, spec §8.1–§8.2).
 *
 * Only DATABASE guarantees are asserted here (uniques, composite ownership FKs,
 * shape CHECKs, bounded counters). The reserve/consume/release write-path
 * guards are module tests at the public checkout/lifecycle interfaces.
 *
 * Real PostgreSQL, disposable DATABASE_URL. A skip is NOT a pass: the visible
 * blocker test fails when the schema is missing.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import dotenv from "dotenv";
import path from "node:path";
dotenv.config({ path: path.resolve(import.meta.dirname, "../../../.env") });

const url = process.env.DATABASE_URL;
const PREFIX = `discount-redemption-schema-${crypto.randomUUID()}`;
const clientA = `${PREFIX}-client-a`;
const clientB = `${PREFIX}-client-b`;
const branchId = `${PREFIX}-branch`;
const productId = `${PREFIX}-product`;
const variantId = `${PREFIX}-variant`;

const pool = url ? new Pool({ connectionString: url, max: 4 }) : null;

async function probeSchema(): Promise<{ ready: boolean; blocker: string }> {
  if (!url) return { ready: false, blocker: "DATABASE_URL is not configured" };
  try {
    const probe = await pool!.query(
      `select to_regclass('public.discount_redemption') is not null as redemption,
              to_regclass('public.order_discount_allocation') is not null as allocation`
    );
    if (!probe.rows[0]?.redemption || !probe.rows[0]?.allocation) {
      return {
        ready: false,
        blocker:
          "discount_redemption/order_discount_allocation tables not found — apply the new schema first",
      };
    }
    return { ready: true, blocker: "" };
  } catch (error) {
    return { ready: false, blocker: error instanceof Error ? error.message : String(error) };
  }
}

const schemaState = await probeSchema();
const schemaReady = schemaState.ready;
const schemaBlocker = schemaState.blocker;
let offerId: string;
let revisionId: string;
let benefitId: string;
let otherOfferId: string;
let otherRevisionId: string;
let otherBenefitId: string;

it.skipIf(schemaReady)(
  "environment blocker: Redemption SQL constraints NOT verified (requires PostgreSQL)",
  () => {
    throw new Error(
      `Redemption schema tests NOT run — reservation constraints remain UNVERIFIED. Exact blocker: ${schemaBlocker}`
    );
  }
);

beforeAll(async () => {
  if (!pool || !schemaReady) return;
  await pool.query(
    `insert into client (id, name, email, email_verified) values ($1,$2,$3,true), ($4,$5,$6,true)`,
    [clientA, "Redemption Fixture A", `${clientA}@example.test`, clientB, "Redemption Fixture B", `${clientB}@example.test`]
  );
  await pool.query(
    `insert into branch (id, name, code, city, address) values ($1,$2,$3,'Test','Test')`,
    [branchId, "Redemption Fixture", PREFIX]
  );
  await pool.query(
    `insert into product (id, name, slug, base_price) values ($1,$2,$3,'150000')`,
    [productId, "Redemption Fixture", PREFIX]
  );
  await pool.query(
    `insert into product_variant (id, product_id, sku, price) values ($1,$2,$3,'150000')`,
    [variantId, productId, PREFIX]
  );

  // Offer identity starts as a draft without a current revision (the composite
  // pointer FK is circular), then the published revision is linked.
  offerId = `${PREFIX}-offer`;
  revisionId = `${PREFIX}-revision`;
  benefitId = `${PREFIX}-benefit`;
  await pool.query(
    `insert into discount_offer (id, key, activation_kind, actor_identity) values ($1,$2,'public','fixture')`,
    [offerId, `${PREFIX}-offer-key`]
  );
  await pool.query(
    `insert into discount_offer_revision
       (id, offer_id, revision_no, name, currency, min_subtotal, published_at, actor_identity)
     values ($1,$2,1,'Fixture','IDR','0',now(),'fixture')`,
    [revisionId, offerId]
  );
  await pool.query(
    `insert into discount_benefit (id, revision_id, kind, scope, fixed_amount) values ($1,$2,'fixed_goods','goods','25000')`,
    [benefitId, revisionId]
  );
  await pool.query(
    `update discount_offer set state='enabled', current_revision_id=$2, quota_count=10, budget_amount='1000000' where id=$1`,
    [offerId, revisionId]
  );
  await pool.query(`insert into discount_offer_usage (offer_id) values ($1)`, [offerId]);

  // A second Offer/revision/benefit used to prove composite ownership: a
  // redemption may not borrow a benefit from another revision.
  otherOfferId = `${PREFIX}-offer-other`;
  otherRevisionId = `${PREFIX}-revision-other`;
  otherBenefitId = `${PREFIX}-benefit-other`;
  await pool.query(
    `insert into discount_offer (id, key, activation_kind, actor_identity) values ($1,$2,'public','fixture')`,
    [otherOfferId, `${PREFIX}-offer-other-key`]
  );
  await pool.query(
    `insert into discount_offer_revision
       (id, offer_id, revision_no, name, currency, min_subtotal, published_at, actor_identity)
     values ($1,$2,1,'Other','IDR','0',now(),'fixture')`,
    [otherRevisionId, otherOfferId]
  );
  await pool.query(
    `insert into discount_benefit (id, revision_id, kind, scope, fixed_amount) values ($1,$2,'fixed_goods','goods','5000')`,
    [otherBenefitId, otherRevisionId]
  );
  await pool.query(
    `update discount_offer set state='enabled', current_revision_id=$2, quota_count=10, budget_amount='1000000' where id=$1`,
    [otherOfferId, otherRevisionId]
  );
  await pool.query(`insert into discount_offer_usage (offer_id) values ($1)`, [otherOfferId]);
}, 30_000);

afterAll(async () => {
  if (!pool) return;
  try {
    await pool.query(`delete from discount_redemption_event where redemption_id in (select id from discount_redemption where order_id like $1)`, [`${PREFIX}%`]);
    await pool.query(`delete from order_discount_allocation where order_id like $1`, [`${PREFIX}%`]);
    await pool.query(`delete from discount_redemption where order_id like $1`, [`${PREFIX}%`]);
    await pool.query(`delete from discount_client_usage where offer_id like $1`, [`${PREFIX}%`]);
  } catch {
    // Best-effort cleanup of the disposable database.
  }
  await pool.query(`delete from discount_offer_usage where offer_id like $1`, [`${PREFIX}%`]).catch(() => {});
  await pool.query(`delete from discount_benefit where revision_id like $1`, [`${PREFIX}%`]).catch(() => {});
  await pool.query(`delete from discount_offer_revision where offer_id like $1`, [`${PREFIX}%`]).catch(() => {});
  await pool.query(`update discount_offer set state='draft', current_revision_id=null where id like $1`, [`${PREFIX}%`]).catch(() => {});
  await pool.query(`delete from discount_offer where id like $1`, [`${PREFIX}%`]).catch(() => {});
  await pool.query(`delete from order_item where order_id like $1`, [`${PREFIX}%`]).catch(() => {});
  await pool.query(`delete from orders where id like $1`, [`${PREFIX}%`]).catch(() => {});
  await pool.query(`delete from product_variant where id=$1`, [variantId]).catch(() => {});
  await pool.query(`delete from product where id=$1`, [productId]).catch(() => {});
  await pool.query(`delete from branch where id=$1`, [branchId]).catch(() => {});
  await pool.query(`delete from client where id in ($1,$2)`, [clientA, clientB]).catch(() => {});
  await pool.end();
});

let orderSeq = 0;
async function createOrder(clientId: string): Promise<string> {
  orderSeq += 1;
  const id = `${PREFIX}-order-${orderSeq}`;
  await pool!.query(
    `insert into orders (id, user_id, branch_id, contact_phone, contact_email, subtotal, total)
     values ($1,$2,$3,'08123456789','fixture@example.test','150000','166500')`,
    [id, clientId, branchId]
  );
  await pool!.query(
    `insert into order_item (id, order_id, variant_id, product_name, price, quantity)
     values ($1,$2,$3,'Fixture','150000',1)`,
    [`${id}-item`, id, variantId]
  );
  return id;
}

async function insertRedemption(input: {
  id: string;
  orderId: string;
  clientId?: string;
  offer?: string;
  revision?: string;
  benefit?: string;
  amount?: string;
}) {
  return pool!.query(
    `insert into discount_redemption
       (id, order_id, client_id, offer_id, revision_id, benefit_id, activation_kind,
        status, benefit_amount, deadline, policy_version, terms_snapshot, result_snapshot)
     values ($1,$2,$3,$4,$5,$6,'public','reserved',$7,now() + interval '15 minutes',1,'{}','{}')`,
    [
      input.id,
      input.orderId,
      input.clientId ?? clientA,
      input.offer ?? offerId,
      input.revision ?? revisionId,
      input.benefit ?? benefitId,
      input.amount ?? "25000",
    ]
  );
}

async function expectSqlState(query: Promise<unknown>, state: string) {
  try {
    await query;
  } catch (error) {
    expect((error as { code?: string }).code).toBe(state);
    return;
  }
  throw new Error(`expected SQLSTATE ${state}, query succeeded`);
}

describe("Redemption ownership and one-slot constraints", () => {
  it("allows one reserved Redemption per order and rejects a second one", async () => {
    const orderId = await createOrder(clientA);
    await insertRedemption({ id: `${orderId}-redemption`, orderId });
    await expectSqlState(
      insertRedemption({ id: `${orderId}-redemption-2`, orderId }),
      "23505"
    );
  });

  it("rejects a client that is not the order owner (composite FK)", async () => {
    const orderId = await createOrder(clientB);
    await expectSqlState(
      insertRedemption({ id: `${orderId}-redemption`, orderId, clientId: clientA }),
      "23503"
    );
  });

  it("rejects a benefit that belongs to a different revision (composite FK)", async () => {
    const orderId = await createOrder(clientA);
    await expectSqlState(
      insertRedemption({
        id: `${orderId}-redemption`,
        orderId,
        benefit: otherBenefitId,
        offer: otherOfferId,
      }),
      "23503"
    );
  });

  it("rejects a non-positive benefit amount or unsupported status", async () => {
    const orderId = await createOrder(clientA);
    await expectSqlState(
      insertRedemption({ id: `${orderId}-redemption`, orderId, amount: "0" }),
      "23514"
    );
    const secondOrder = await createOrder(clientA);
    await expectSqlState(
      pool!.query(
        `insert into discount_redemption
           (id, order_id, client_id, offer_id, revision_id, benefit_id, activation_kind,
            status, benefit_amount, deadline, policy_version, terms_snapshot, result_snapshot)
         values ($1,$2,$3,$4,$5,$6,'public','redeemed','25000',now(),1,'{}','{}')`,
        [
          `${secondOrder}-redemption`,
          secondOrder,
          clientA,
          offerId,
          revisionId,
          benefitId,
        ]
      ),
      "23514"
    );
  });
});

describe("Redemption event append-only shape", () => {
  it("accepts the sanctioned transitions and rejects an invalid one", async () => {
    const orderId = await createOrder(clientA);
    const redemptionId = `${orderId}-redemption`;
    await insertRedemption({ id: redemptionId, orderId });

    await pool!.query(
      `insert into discount_redemption_event
         (id, redemption_id, event_key, kind, previous_status, next_status, amount, source)
       values ($1,$2,$3,'reserved',null,'reserved','25000','checkout')`,
      [`${redemptionId}-ev-reserved`, redemptionId, `${redemptionId}:reserved`]
    );
    await pool!.query(
      `insert into discount_redemption_event
         (id, redemption_id, event_key, kind, previous_status, next_status, amount, source)
       values ($1,$2,$3,'consumed','reserved','consumed','25000','midtrans')`,
      [`${redemptionId}-ev-consumed`, redemptionId, `${redemptionId}:consumed`]
    );
    await expectSqlState(
      pool!.query(
        `insert into discount_redemption_event
           (id, redemption_id, event_key, kind, previous_status, next_status, amount, source)
         values ($1,$2,$3,'consumed','reserved','consumed','25000','midtrans')`,
        [`${redemptionId}-ev-duplicate`, redemptionId, `${redemptionId}:consumed`]
      ),
      "23505"
    );
    await expectSqlState(
      pool!.query(
        `insert into discount_redemption_event
           (id, redemption_id, event_key, kind, previous_status, next_status, amount, source)
         values ($1,$2,$3,'refund','consumed','released','25000','manual')`,
        [`${redemptionId}-ev-refund`, redemptionId, `${redemptionId}:refund`]
      ),
      "23514"
    );
    await expectSqlState(
      pool!.query(
        `insert into discount_redemption_event
           (id, redemption_id, event_key, kind, previous_status, next_status, amount, source)
         values ($1,$2,$3,'consumed','consumed','reserved','25000','midtrans')`,
        [`${redemptionId}-ev-invalid`, redemptionId, `${redemptionId}:invalid`]
      ),
      "23514"
    );
  });
});

describe("Allocation shape and ownership", () => {
  it("stores positive per-line allocations only and rejects duplicates", async () => {
    const orderId = await createOrder(clientA);
    const redemptionId = `${orderId}-redemption`;
    await insertRedemption({ id: redemptionId, orderId });
    await pool!.query(
      `insert into order_discount_allocation
         (id, order_id, order_item_id, component, redemption_id, benefit_id, amount)
       values ($1,$2,$3,'offer_goods',$4,$5,'25000')`,
      [`${orderId}-alloc-offer`, orderId, `${orderId}-item`, redemptionId, benefitId]
    );
    await expectSqlState(
      pool!.query(
        `insert into order_discount_allocation
           (id, order_id, order_item_id, component, redemption_id, benefit_id, amount)
         values ($1,$2,$3,'offer_goods',$4,$5,'1')`,
        [`${orderId}-alloc-offer-2`, orderId, `${orderId}-item`, redemptionId, benefitId]
      ),
      "23505"
    );
    await expectSqlState(
      pool!.query(
        `insert into order_discount_allocation
           (id, order_id, order_item_id, component, redemption_id, benefit_id, amount)
         values ($1,$2,$3,'offer_goods',$4,$5,'0')`,
        [`${orderId}-alloc-zero`, orderId, `${orderId}-item-2`, redemptionId, benefitId]
      ),
      "23514"
    );
  });

  it("rejects a Markdown allocation without its revision and a shipping allocation with an item", async () => {
    const orderId = await createOrder(clientA);
    const redemptionId = `${orderId}-redemption`;
    await insertRedemption({ id: redemptionId, orderId });
    await expectSqlState(
      pool!.query(
        `insert into order_discount_allocation
           (id, order_id, order_item_id, component, markdown_revision_id, amount)
         values ($1,$2,$3,'markdown',null,'1000')`,
        [`${orderId}-alloc-markdown`, orderId, `${orderId}-item`]
      ),
      "23514"
    );
    await expectSqlState(
      pool!.query(
        `insert into order_discount_allocation
           (id, order_id, order_item_id, component, redemption_id, benefit_id, amount)
         values ($1,$2,$3,'offer_shipping',$4,$5,'1000')`,
        [`${orderId}-alloc-shipping`, orderId, `${orderId}-item`, redemptionId, benefitId]
      ),
      "23514"
    );
  });

  it("rejects an allocation that references a Redemption of another order", async () => {
    const orderId = await createOrder(clientA);
    const otherOrderId = await createOrder(clientA);
    const otherRedemptionId = `${otherOrderId}-redemption`;
    await insertRedemption({ id: otherRedemptionId, orderId: otherOrderId });
    await expectSqlState(
      pool!.query(
        `insert into order_discount_allocation
           (id, order_id, order_item_id, component, redemption_id, benefit_id, amount)
         values ($1,$2,$3,'offer_goods',$4,$5,'1000')`,
        [`${orderId}-alloc-cross`, orderId, `${orderId}-item`, otherRedemptionId, benefitId]
      ),
      "23503"
    );
  });
});

describe("Client usage projection bounds", () => {
  it("rejects negative counters and duplicate (offer, client) keys", async () => {
    await pool!.query(
      `insert into discount_client_usage (offer_id, client_id) values ($1,$2)`,
      [offerId, clientA]
    );
    await expectSqlState(
      pool!.query(
        `insert into discount_client_usage (offer_id, client_id) values ($1,$2)`,
        [offerId, clientA]
      ),
      "23505"
    );
    await expectSqlState(
      pool!.query(
        `update discount_client_usage set reserved_count = -1 where offer_id=$1 and client_id=$2`,
        [offerId, clientA]
      ),
      "23514"
    );
  });
});

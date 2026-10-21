/**
 * Seam T/H — pembacaan Coupon publik (ticket 07). Real PostgreSQL + disposable
 * DB. Assertion memakai public read interface (`readAvailableOffers`), bukan
 * private query. Literal nama/reason independen dari spec §5.1.
 *
 * A skip is not a pass: a visible blocker test fails when the schema/DB is
 * missing.
 */
import dotenv from "dotenv";
import path from "node:path";
dotenv.config({ path: path.resolve(import.meta.dirname, "../../../../.env") });
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@marketplace/db/src/schema";

// Dynamic import AFTER dotenv: `@/db` reads DATABASE_URL at module load.
const { DiscountAvailabilityError, readAvailableOffers } = await import(
  "./discount-availability"
);

const url = process.env.DATABASE_URL;
const PREFIX = `discount-availability-${crypto.randomUUID()}`;
const clientVerified = `${PREFIX}-client-verified`;
const clientUnverified = `${PREFIX}-client-unverified`;
const branchId = `${PREFIX}-branch`;
const productId = `${PREFIX}-product`;
const variantA = `${PREFIX}-variant-a`;
const variantB = `${PREFIX}-variant-b`;

const pool = url ? new Pool({ connectionString: url, max: 3 }) : null;
const db = pool ? drizzle(pool, { schema }) : null;

async function probe(): Promise<{ ready: boolean; blocker: string }> {
  if (!url) return { ready: false, blocker: "DATABASE_URL is not configured" };
  try {
    const result = await pool!.query(
      `select to_regclass('public.discount_redemption') is not null as ready`
    );
    return result.rows[0]?.ready
      ? { ready: true, blocker: "" }
      : { ready: false, blocker: "discount schema missing — apply migrations 0043/0044 first" };
  } catch (error) {
    return { ready: false, blocker: error instanceof Error ? error.message : String(error) };
  }
}

const schemaState = await probe();

it.skipIf(schemaState.ready)(
  "environment blocker: public Coupon availability NOT verified (requires PostgreSQL)",
  () => {
    throw new Error(
      `Coupon availability tests NOT run — discovery/eligibility remain UNVERIFIED. Exact blocker: ${schemaState.blocker}`
    );
  }
);

interface OfferFixture {
  id: string;
  name: string;
  minSubtotal: string;
  fixedAmount: string;
  quotaCount?: number | null;
  budgetAmount?: string | null;
  perClientLimit?: number;
  state?: "draft" | "enabled" | "paused" | "archived";
  startAt?: Date | null;
  endAt?: Date | null;
  usage?: { reservedCount: number; consumedCount: number; reservedAmount?: string; consumedAmount?: string };
  clientUsage?: { clientId: string; consumedCount: number; consumedAmount?: string };
  published?: boolean;
}

const offers: OfferFixture[] = [
  {
    id: `${PREFIX}-offer-aardvark`,
    name: "Aardvark",
    minSubtotal: "0",
    fixedAmount: "25000",
  },
  {
    id: `${PREFIX}-offer-alpha`,
    name: "Alpha",
    minSubtotal: "0",
    fixedAmount: "5000",
  },
  {
    id: `${PREFIX}-offer-beta`,
    name: "Beta",
    minSubtotal: "250001",
    fixedAmount: "25000",
  },
  {
    id: `${PREFIX}-offer-eta`,
    name: "Eta",
    minSubtotal: "0",
    fixedAmount: "25000",
    quotaCount: 1,
    usage: { reservedCount: 0, consumedCount: 1 },
  },
  {
    id: `${PREFIX}-offer-gamma`,
    name: "Gamma",
    minSubtotal: "0",
    fixedAmount: "10000",
    budgetAmount: "10000",
    usage: { reservedCount: 0, consumedCount: 0, consumedAmount: "10000" },
  },
  {
    id: `${PREFIX}-offer-iota`,
    name: "Iota",
    minSubtotal: "0",
    fixedAmount: "25000",
    perClientLimit: 1,
    clientUsage: { clientId: clientVerified, consumedCount: 1, consumedAmount: "25000" },
  },
  {
    id: `${PREFIX}-offer-theta`,
    name: "Theta",
    minSubtotal: "0",
    fixedAmount: "25000",
    budgetAmount: "10000",
  },
  {
    id: `${PREFIX}-offer-delta`,
    name: "Delta",
    minSubtotal: "0",
    fixedAmount: "25000",
    state: "paused",
  },
  {
    id: `${PREFIX}-offer-epsilon`,
    name: "Epsilon",
    minSubtotal: "0",
    fixedAmount: "25000",
    endAt: new Date("2026-10-20T00:00:00.000Z"),
  },
  {
    id: `${PREFIX}-offer-zeta`,
    name: "Zeta",
    minSubtotal: "0",
    fixedAmount: "25000",
    startAt: new Date("2026-12-01T00:00:00.000Z"),
  },
];

const NOW = new Date("2026-10-21T10:00:00.000Z");
const nameByOfferId = new Map(offers.map((offer) => [offer.id, offer.name] as const));

beforeAll(async () => {
  if (!pool || !schemaState.ready) return;
  await pool.query(
    `insert into client (id, name, email, email_verified) values ($1,$2,$3,true), ($4,$5,$6,false)`,
    [clientVerified, "Availability Verified", `${clientVerified}@example.test`, clientUnverified, "Availability Unverified", `${clientUnverified}@example.test`]
  );
  await pool.query(
    `insert into branch (id, name, code, city, address) values ($1,$2,$3,'Test','Test')`,
    [branchId, "Availability Fixture", PREFIX]
  );
  await pool.query(
    `insert into product (id, name, slug, base_price) values ($1,$2,$3,'150000')`,
    [productId, "Availability Fixture", PREFIX]
  );
  await pool.query(
    `insert into product_variant (id, product_id, sku, price) values ($1,$2,$3,'150000'), ($4,$2,$5,'100000')`,
    [variantA, productId, `${PREFIX}-sku-a`, variantB, `${PREFIX}-sku-b`]
  );
  await pool.query(
    `insert into cart (id, user_id) values ($1,$2), ($3,$4)`,
    [`${PREFIX}-cart-verified`, clientVerified, `${PREFIX}-cart-unverified`, clientUnverified]
  );
  await pool.query(
    `insert into cart_item (id, cart_id, variant_id, branch_id, quantity) values
       ($1,$2,$3,$4,1), ($5,$2,$6,$4,1), ($7,$8,$3,$4,1)`,
    [
      `${PREFIX}-item-a`,
      `${PREFIX}-cart-verified`,
      variantA,
      branchId,
      `${PREFIX}-item-b`,
      variantB,
      `${PREFIX}-item-unverified`,
      `${PREFIX}-cart-unverified`,
    ]
  );

  for (const offer of offers) {
    await pool.query(
      `insert into discount_offer (id, key, activation_kind, actor_identity) values ($1,$2,'public','fixture')`,
      [offer.id, `${offer.id}-key`]
    );
    const published = offer.published !== false;
    await pool.query(
      `insert into discount_offer_revision
         (id, offer_id, revision_no, name, currency, min_subtotal, start_at, end_at, published_at, actor_identity)
       values ($1,$2,1,$3,'IDR',$4,$5,$6,$7,'fixture')`,
      [
        `${offer.id}-revision`,
        offer.id,
        offer.name,
        offer.minSubtotal,
        offer.startAt ?? null,
        offer.endAt ?? null,
        published ? new Date("2026-10-01T00:00:00.000Z") : null,
      ]
    );
    await pool.query(
      `insert into discount_benefit (id, revision_id, kind, scope, fixed_amount) values ($1,$2,'fixed_goods','goods',$3)`,
      [`${offer.id}-benefit`, `${offer.id}-revision`, offer.fixedAmount]
    );
    await pool.query(
      `update discount_offer
         set state=$2, current_revision_id=$3, quota_count=$4, budget_amount=$5, per_client_limit=$6
       where id=$1`,
      [
        offer.id,
        offer.state ?? "enabled",
        `${offer.id}-revision`,
        offer.quotaCount === undefined ? 100 : offer.quotaCount,
        offer.budgetAmount === undefined ? "1000000" : offer.budgetAmount,
        offer.perClientLimit ?? 1,
      ]
    );
    await pool.query(`insert into discount_offer_usage (offer_id) values ($1)`, [offer.id]);
    if (offer.usage) {
      await pool.query(
        `update discount_offer_usage
            set reserved_count=$2, consumed_count=$3, reserved_amount=$4, consumed_amount=$5
          where offer_id=$1`,
        [
          offer.id,
          offer.usage.reservedCount,
          offer.usage.consumedCount,
          offer.usage.reservedAmount ?? "0",
          offer.usage.consumedAmount ?? "0",
        ]
      );
    }
    if (offer.clientUsage) {
      await pool.query(
        `insert into discount_client_usage (offer_id, client_id, consumed_count, consumed_amount)
         values ($1,$2,$3,$4)`,
        [offer.id, offer.clientUsage.clientId, offer.clientUsage.consumedCount, offer.clientUsage.consumedAmount ?? "0"]
      );
    }
  }
}, 30_000);

afterAll(async () => {
  if (!pool) return;
  try {
    await pool.query(`delete from cart_item where cart_id like $1`, [`${PREFIX}%`]);
    await pool.query(`delete from cart where id like $1`, [`${PREFIX}%`]);
    await pool.query(`delete from discount_client_usage where offer_id like $1`, [`${PREFIX}%`]);
    await pool.query(`delete from discount_offer_usage where offer_id like $1`, [`${PREFIX}%`]);
    await pool.query(`delete from discount_benefit where revision_id like $1`, [`${PREFIX}%`]);
    await pool.query(
      `update discount_offer set state='draft', current_revision_id=null where id like $1`,
      [`${PREFIX}%`]
    );
    await pool.query(`delete from discount_offer_revision where offer_id like $1`, [`${PREFIX}%`]);
    await pool.query(`delete from discount_offer where id like $1`, [`${PREFIX}%`]);
    await pool.query(`delete from product_variant where id in ($1,$2)`, [variantA, variantB]);
    await pool.query(`delete from product where id=$1`, [productId]);
    await pool.query(`delete from branch where id=$1`, [branchId]);
    await pool.query(`delete from client where id in ($1,$2)`, [clientVerified, clientUnverified]);
  } finally {
    await pool.end();
  }
});

const selected = [`${PREFIX}-item-a`, `${PREFIX}-item-b`];

describe("readAvailableOffers — discovery dan reason", () => {
  it("hanya Offer publik enabled dengan waktu aktif; sisanya disabled dengan alasan aman", async () => {
    const result = await readAvailableOffers(
      { clientId: clientVerified, selectedItemIds: selected, now: NOW },
      db!
    );
    const scoped = result.items.filter((item) => item.offerId.startsWith(PREFIX));
    const names = scoped.map((item) => item.name);
    // Delta (paused), Epsilon (end lewat), Zeta (start masa depan) tidak pernah
    // didiscovery. Urutan: nama lalu Offer ID. Seed demo DB boleh punya Offer
    // lain, jadi hanya fixture milik spec ini yang diassert.
    expect(names).toEqual(["Aardvark", "Alpha", "Beta", "Eta", "Gamma", "Iota", "Theta"]);

    const byName = Object.fromEntries(scoped.map((item) => [item.name, item]));
    expect(byName.Aardvark).toMatchObject({ eligible: true, reason: null, reasonMessage: null, benefitAmount: "25000" });
    expect(byName.Alpha).toMatchObject({ eligible: true, benefitAmount: "5000" });
    expect(byName.Beta).toMatchObject({ eligible: false, reason: "MINIMUM_NOT_MET" });
    expect(byName.Eta).toMatchObject({ eligible: false, reason: "CAPACITY_UNAVAILABLE" });
    expect(byName.Gamma).toMatchObject({ eligible: false, reason: "CAPACITY_UNAVAILABLE" });
    expect(byName.Iota).toMatchObject({ eligible: false, reason: "CAPACITY_UNAVAILABLE" });
    expect(byName.Theta).toMatchObject({ eligible: false, reason: "CAPACITY_UNAVAILABLE" });
    expect(byName.Beta?.reasonMessage).toBe("Minimum belanja untuk promo ini belum terpenuhi.");
  });

  it("tanpa verified email Offer yang lolos minimum tampil disabled EMAIL_VERIFICATION_REQUIRED", async () => {
    const result = await readAvailableOffers(
      {
        clientId: clientUnverified,
        selectedItemIds: [`${PREFIX}-item-unverified`],
        now: NOW,
      },
      db!
    );
    expect(result.items.length).toBeGreaterThan(0);
    const scoped = result.items.filter((item) => item.offerId.startsWith(PREFIX));
    const byName = Object.fromEntries(scoped.map((item) => [item.name, item]));
    // Minimum diperiksa sebelum identitas (spec §5.1); Beta tetap minimum gagal.
    expect(byName.Beta).toMatchObject({ eligible: false, reason: "MINIMUM_NOT_MET" });
    for (const name of ["Aardvark", "Alpha", "Gamma"]) {
      expect(byName[name]).toMatchObject({
        eligible: false,
        reason: "EMAIL_VERIFICATION_REQUIRED",
      });
    }
  });

  it("read-only: tidak membuat redemption/hold dan tidak mengubah counter usage", async () => {
    const before = await pool!.query(
      `select offer_id, reserved_count, consumed_count, reserved_amount, consumed_amount
         from discount_offer_usage where offer_id like $1 order by offer_id`,
      [`${PREFIX}%`]
    );
    await readAvailableOffers(
      { clientId: clientVerified, selectedItemIds: selected, now: NOW },
      db!
    );
    const after = await pool!.query(
      `select offer_id, reserved_count, consumed_count, reserved_amount, consumed_amount
         from discount_offer_usage where offer_id like $1 order by offer_id`,
      [`${PREFIX}%`]
    );
    expect(after.rows).toEqual(before.rows);
    const redemptions = await pool!.query(
      `select count(*)::int as count from discount_redemption where offer_id like $1`,
      [`${PREFIX}%`]
    );
    expect(redemptions.rows[0].count).toBe(0);
  });

  it("cursor membatasi halaman tanpa duplikasi/kehilangan Offer", async () => {
    // Halaman bisa berisi Offer seed lain; yang diuji adalah mekanik cursor:
    // tidak ada duplikasi dan seluruh fixture milik spec ini tetap terbaca.
    const collected: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page = await readAvailableOffers(
        { clientId: clientVerified, selectedItemIds: selected, now: NOW, limit: 2, cursor },
        db!
      );
      expect(page.items.length).toBeLessThanOrEqual(2);
      collected.push(...page.items.map((item) => item.offerId));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor && pages < 50);
    expect(cursor).toBeNull();
    expect(new Set(collected).size).toBe(collected.length);
    const scopedNames = collected
      .filter((offerId) => offerId.startsWith(PREFIX))
      .map((offerId) => nameByOfferId.get(offerId));
    expect(scopedNames).toEqual([
      "Aardvark",
      "Alpha",
      "Beta",
      "Eta",
      "Gamma",
      "Iota",
      "Theta",
    ]);
  });

  it("barang di luar cart milik client ditolak NOT_FOUND", async () => {
    await expect(
      readAvailableOffers(
        { clientId: clientUnverified, selectedItemIds: selected, now: NOW },
        db!
      )
    ).rejects.toBeInstanceOf(DiscountAvailabilityError);
  });
});

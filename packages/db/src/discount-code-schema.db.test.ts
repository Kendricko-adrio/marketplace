/**
 * SQL constraint seam — Manual Promo Code (ticket 09, spec §7.1/§8.1).
 *
 * Hanya jaminan DATABASE yang diuji di sini: canonical CHECK, unique canonical
 * global, ownership manual-only, dan bentuk Redemption per activation kind.
 * Immutability literal/owner dan reservasi kode saat publish/add adalah
 * jaminan modul (diuji di seam administrasi/store).
 *
 * PostgreSQL nyata + DATABASE_URL disposable. Skip BUKAN pass: test blocker
 * yang terlihat akan gagal bila schema belum diterapkan.
 */
import dotenv from "dotenv";
import path from "node:path";
dotenv.config({ path: path.resolve(import.meta.dirname, "../../../.env") });
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

const url = process.env.DATABASE_URL;
const PREFIX = `discount-code-schema-${crypto.randomUUID()}`;
const pool = url ? new Pool({ connectionString: url, max: 4 }) : null;

async function probeSchema(): Promise<{ ready: boolean; blocker: string }> {
  if (!url) return { ready: false, blocker: "DATABASE_URL is not configured" };
  try {
    const probe = await pool!.query(
      `select to_regclass('public.discount_code') is not null as code,
              exists (
                select 1 from pg_constraint
                where conname = 'discount_redemption_activation_kind'
              ) as redemption_kind`
    );
    return probe.rows[0]?.code && probe.rows[0]?.redemption_kind
      ? { ready: true, blocker: "" }
      : { ready: false, blocker: "discount_code schema is not applied" };
  } catch (error) {
    return { ready: false, blocker: error instanceof Error ? error.message : String(error) };
  }
}

const schemaState = await probeSchema();
const ready = schemaState.ready;

it.skipIf(ready)(
  "environment blocker: Manual Promo Code SQL constraints NOT verified (requires PostgreSQL)",
  () => {
    throw new Error(
      `Manual code schema tests NOT run — code constraints remain UNVERIFIED. Exact blocker: ${schemaState.blocker}`
    );
  }
);

let manualOfferA: string;
let manualOfferB: string;
let publicOffer: string;
let orderId: string;

async function createOffer(input: {
  id: string;
  activationKind: "public" | "manual_only";
}): Promise<void> {
  const revisionId = `${input.id}-revision`;
  const benefitId = `${input.id}-benefit`;
  await pool!.query(
    `insert into discount_offer (id, key, activation_kind, actor_identity) values ($1,$2,$3,'fixture')`,
    [input.id, `${input.id}-key`, input.activationKind]
  );
  await pool!.query(
    `insert into discount_offer_revision
       (id, offer_id, revision_no, name, currency, min_subtotal, published_at, actor_identity)
     values ($1,$2,1,'Fixture','IDR','0',now(),'fixture')`,
    [revisionId, input.id]
  );
  await pool!.query(
    `insert into discount_benefit (id, revision_id, kind, scope, fixed_amount)
     values ($1,$2,'fixed_goods','goods','25000')`,
    [benefitId, revisionId]
  );
  await pool!.query(
    `update discount_offer set state='enabled', current_revision_id=$2, quota_count=10 where id=$1`,
    [input.id, revisionId]
  );
  await pool!.query(`insert into discount_offer_usage (offer_id) values ($1)`, [input.id]);
}

async function insertCode(input: {
  id: string;
  offerId: string;
  code: string;
  activationKind?: "public" | "manual_only";
  state?: string;
}) {
  return pool!.query(
    `insert into discount_code (id, offer_id, activation_kind, canonical_code, state, actor_identity)
     values ($1,$2,$3,$4,$5,'fixture')`,
    [
      input.id,
      input.offerId,
      input.activationKind ?? "manual_only",
      input.code,
      input.state ?? "active",
    ]
  );
}

beforeAll(async () => {
  if (!pool || !ready) return;
  const clientId = `${PREFIX}-client`;
  const branchId = `${PREFIX}-branch`;
  const productId = `${PREFIX}-product`;
  const variantId = `${PREFIX}-variant`;
  await pool.query(
    `insert into client (id, name, email, email_verified) values ($1,'Code Fixture',$2,true)`,
    [clientId, `${clientId}@example.test`]
  );
  await pool.query(
    `insert into branch (id, name, code, city, address) values ($1,'Code Fixture',$2,'Test','Test')`,
    [branchId, PREFIX]
  );
  await pool.query(
    `insert into product (id, name, slug, base_price) values ($1,'Code Fixture',$2,'150000')`,
    [productId, PREFIX]
  );
  await pool.query(
    `insert into product_variant (id, product_id, sku, price) values ($1,$2,$3,'150000')`,
    [variantId, productId, PREFIX]
  );

  manualOfferA = `${PREFIX}-offer-a`;
  manualOfferB = `${PREFIX}-offer-b`;
  publicOffer = `${PREFIX}-offer-public`;
  await createOffer({ id: manualOfferA, activationKind: "manual_only" });
  await createOffer({ id: manualOfferB, activationKind: "manual_only" });
  await createOffer({ id: publicOffer, activationKind: "public" });

  orderId = `${PREFIX}-order`;
  await pool.query(
    `insert into orders (id, user_id, branch_id, contact_phone, contact_email, subtotal, total)
     values ($1,$2,$3,'08123456789','fixture@example.test','150000','166500')`,
    [orderId, clientId, branchId]
  );
  await pool.query(
    `insert into order_item (id, order_id, variant_id, product_name, price, quantity)
     values ($1,$2,$3,'Fixture','150000',1)`,
    [`${orderId}-item`, orderId, variantId]
  );
}, 30_000);

afterAll(async () => {
  if (!pool) return;
  const q = async (sqlText: string, values: unknown[] = []) => {
    try { await pool.query(sqlText, values); } catch { /* best effort */ }
  };
  await q(`delete from discount_redemption_event where redemption_id like $1`, [`${PREFIX}%`]);
  await q(`delete from discount_redemption where order_id like $1`, [`${PREFIX}%`]);
  await q(`delete from discount_client_usage where offer_id like $1`, [`${PREFIX}%`]);
  await q(`delete from discount_code where offer_id like $1`, [`${PREFIX}%`]);
  await q(`delete from discount_offer_usage where offer_id like $1`, [`${PREFIX}%`]);
  await q(`delete from discount_benefit where revision_id like $1`, [`${PREFIX}%`]);
  // Pointer harus dilepas SEBELUM revision dihapus: FK pointer bersifat RESTRICT.
  await q(`update discount_offer set state='draft', current_revision_id=null where id like $1`, [`${PREFIX}%`]);
  await q(`delete from discount_offer_revision where offer_id like $1`, [`${PREFIX}%`]);
  await q(`delete from discount_offer where id like $1`, [`${PREFIX}%`]);
  await q(`delete from order_item where order_id like $1`, [`${PREFIX}%`]);
  await q(`delete from orders where id like $1`, [`${PREFIX}%`]);
  await q(`delete from product_variant where sku=$1`, [PREFIX]);
  await q(`delete from product where slug=$1`, [PREFIX]);
  await q(`delete from branch where code=$1`, [PREFIX]);
  await q(`delete from client where id like $1`, [`${PREFIX}%`]);
  await pool.end();
});

function codeOf(error: unknown): string | undefined {
  return (error as { code?: string } | null)?.code;
}

describe("discount_code canonical and ownership constraints", () => {
  it("menyimpan canonical valid untuk Offer manual_only", async () => {
    await expect(
      insertCode({ id: `${PREFIX}-code-a`, offerId: manualOfferA, code: "ZZCODESCHEMAA" })
    ).resolves.toBeTruthy();
  });

  it("menolak literal non-canonical: lowercase, spasi internal, terlalu pendek", async () => {
    for (const [index, code] of ["zzcodeschemaa", "ZZCODESCHEMA B", "AB", "_HEMAT"].entries()) {
      await expect(
        insertCode({
          id: `${PREFIX}-code-bad-${index}`,
          offerId: manualOfferA,
          code,
        })
      ).rejects.toSatisfy((error) => codeOf(error) === "23514");
    }
  });

  it("canonical unique GLOBAL: Offer lain tidak boleh mereservasi literal yang sama", async () => {
    await expect(
      insertCode({ id: `${PREFIX}-code-b`, offerId: manualOfferB, code: "ZZCODESCHEMAA" })
    ).rejects.toSatisfy((error) => codeOf(error) === "23505");
  });

  it("menolak kode pada Offer publik (composite activation ownership)", async () => {
    await expect(
      insertCode({ id: `${PREFIX}-code-public`, offerId: publicOffer, code: "ZZPUBLICCODE1" })
    ).rejects.toSatisfy((error) => codeOf(error) === "23503");
    await expect(
      insertCode({
        id: `${PREFIX}-code-pubkind`,
        offerId: manualOfferA,
        code: "ZZPUBKIND99",
        activationKind: "public",
      })
    ).rejects.toSatisfy((error) => codeOf(error) === "23514");
  });

  it("state code hanya active/inactive/archived", async () => {
    await expect(
      insertCode({
        id: `${PREFIX}-code-state`,
        offerId: manualOfferB,
        code: "ZZSTATETEST1",
        state: "deleted",
      })
    ).rejects.toSatisfy((error) => codeOf(error) === "23514");
  });
});

describe("discount_redemption activation shape", () => {
  async function insertRedemption(input: {
    id: string;
    activationKind: "public" | "manual_only";
    codeId: string | null;
    offerId: string;
  }) {
    const revisionId = `${input.offerId}-revision`;
    const benefitId = `${input.offerId}-benefit`;
    return pool!.query(
      `insert into discount_redemption
         (id, order_id, client_id, offer_id, revision_id, benefit_id, activation_kind, code_id,
          status, benefit_amount, deadline, policy_version, terms_snapshot, result_snapshot)
       values ($1,$2,$3,$4,$5,$6,$7,$8,'reserved','25000',now() + interval '15 minutes',1,'{}','{}')`,
      [
        input.id,
        orderId,
        `${PREFIX}-client`,
        input.offerId,
        revisionId,
        benefitId,
        input.activationKind,
        input.codeId,
      ]
    );
  }

  it("manual_only wajib membawa code_id milik Offer yang sama", async () => {
    await expect(
      insertRedemption({
        id: `${PREFIX}-red-no-code`,
        activationKind: "manual_only",
        codeId: null,
        offerId: manualOfferA,
      })
    ).rejects.toSatisfy((error) => codeOf(error) === "23514");
    // Kode milik Offer B tidak boleh dipakai Redemption Offer A.
    await insertCode({
      id: `${PREFIX}-code-owner`,
      offerId: manualOfferB,
      code: "ZZOWNERCODE1",
    });
    await expect(
      insertRedemption({
        id: `${PREFIX}-red-wrong-code`,
        activationKind: "manual_only",
        codeId: `${PREFIX}-code-owner`,
        offerId: manualOfferA,
      })
    ).rejects.toSatisfy((error) => codeOf(error) === "23503");
  });

  it("public tidak boleh membawa code_id", async () => {
    await expect(
      insertRedemption({
        id: `${PREFIX}-red-public-with-code`,
        activationKind: "public",
        codeId: `${PREFIX}-code-a`,
        offerId: manualOfferA,
      })
    ).rejects.toSatisfy(
      (error) => codeOf(error) === "23514" || codeOf(error) === "23503"
    );
  });

  it("satu Redemption manual dengan kode milik Offer yang benar diterima", async () => {
    await expect(
      insertRedemption({
        id: `${PREFIX}-red-ok`,
        activationKind: "manual_only",
        codeId: `${PREFIX}-code-a`,
        offerId: manualOfferA,
      })
    ).resolves.toBeTruthy();
  });
});

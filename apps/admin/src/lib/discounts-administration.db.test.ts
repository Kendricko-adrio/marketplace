import dotenv from "dotenv";
import path from "node:path";
dotenv.config({ path: path.resolve(import.meta.dirname, "../../../.env"), quiet: true });

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";

import {
  addDiscountCode,
  createPublicDraftOffer,
  DiscountAdministrationError,
  getDiscountOfferDetail,
  listDiscountOffers,
  publishDiscountOffer,
  reviewDiscountOffer,
  saveDiscountOfferDraft,
  setDiscountCodeState,
  setDiscountOfferPolicy,
  setDiscountOfferState,
  simulateDiscountOffer,
} from "./discounts-administration";

// =========================================================
// Seam T — public Offer administration lifecycle on real PostgreSQL
// =========================================================
// Every assertion here goes through the DOMAIN interface (not SQL) except where
// a fixture must simulate a commitment the redemption slice does not create yet.
// Expected values are literals from the approved spec: 150000 - 17000 = 133000,
// 11% PPN = 14630, pickup total 147630; quota 10 with 8 reserved + 1 consumed
// cannot be reduced to 5.
//
// Fixture safety: constant actor/role ids, offers cleaned by exact actor ids,
// and DATABASE_URL must name a disposable `marketplace_discounts_test_*`
// database. Never run this against staging/production.

const url = process.env.DATABASE_URL;
const TEST_DATABASE_PREFIX = "marketplace_discounts_test_";

function databaseNameOf(connectionString: string): string | null {
  try {
    const parsed = new URL(connectionString);
    const name = decodeURIComponent(parsed.pathname).replace(/^\/+/, "").split("/")[0];
    return name ? name : null;
  } catch {
    return null;
  }
}

if (url) {
  const name = databaseNameOf(url);
  if (!name || !name.startsWith(TEST_DATABASE_PREFIX)) {
    throw new Error(
      `[discounts-admin-db] Refusing to mutate database "${name ?? "<unknown>"}": ` +
        `DATABASE_URL must point at a "${TEST_DATABASE_PREFIX}*" database.`
    );
  }
}

const ROLE = "zz-fx-disc-admin-role";
const ACTOR = "zz-fx-disc-admin-user";
const NO_CAP_ROLE = "zz-fx-disc-nocap-role";
const NO_CAP_ACTOR = "zz-fx-disc-nocap-user";
const VIEW_ROLE = "zz-fx-disc-view-role";
const VIEW_ACTOR = "zz-fx-disc-view-user";
const ACTORS = [ACTOR, NO_CAP_ACTOR, VIEW_ACTOR];

const pool = url ? new Pool({ connectionString: url, max: 4 }) : null;

async function ready(): Promise<boolean> {
  if (!pool) return false;
  const result = await pool.query(
    `select to_regclass('public.discount_offer') is not null
        and to_regclass('public.discount_benefit') is not null
        and to_regclass('public.discount_admin_request') is not null as ok`
  );
  return result.rows[0]?.ok === true;
}

const dbReady = await ready();

async function cleanupOwnedRows(): Promise<void> {
  if (!pool) return;
  await pool.query(
    `DELETE FROM discount_admin_request WHERE actor_identity = ANY($1::text[])`,
    [ACTORS]
  );
  await pool.query(
    `DELETE FROM audit_log
      WHERE entity_id IN (SELECT id FROM discount_offer WHERE actor_id = ANY($1::text[]))`,
    [ACTORS]
  );
  await pool.query(
    `UPDATE discount_offer SET state = 'draft', current_revision_id = NULL
      WHERE actor_id = ANY($1::text[])`,
    [ACTORS]
  );
  await pool.query(
    `DELETE FROM discount_code
      WHERE offer_id IN (SELECT id FROM discount_offer WHERE actor_id = ANY($1::text[]))`,
    [ACTORS]
  );
  await pool.query(
    `DELETE FROM discount_offer_usage
      WHERE offer_id IN (SELECT id FROM discount_offer WHERE actor_id = ANY($1::text[]))`,
    [ACTORS]
  );
  await pool.query(
    `DELETE FROM discount_benefit
      WHERE revision_id IN (
        SELECT id FROM discount_offer_revision
         WHERE offer_id IN (SELECT id FROM discount_offer WHERE actor_id = ANY($1::text[]))
      )`,
    [ACTORS]
  );
  await pool.query(
    `DELETE FROM discount_offer_revision
      WHERE offer_id IN (SELECT id FROM discount_offer WHERE actor_id = ANY($1::text[]))`,
    [ACTORS]
  );
  await pool.query(`DELETE FROM discount_offer WHERE actor_id = ANY($1::text[])`, [
    ACTORS,
  ]);
}

async function insertActor(input: {
  roleId: string;
  userId: string;
  roleName: string;
  email: string;
  withCapacity: boolean;
  withEdit?: boolean;
}): Promise<void> {
  await pool!.query(
    `INSERT INTO admin_role (id, key, name, description, is_system, version)
     VALUES ($1, NULL, $2, 'discount admin fixture', false, 1)
     ON CONFLICT (id) DO NOTHING`,
    [input.roleId, input.roleName]
  );
  await pool!.query(
    `INSERT INTO "user" (id, name, email, role_id, is_active, email_verified)
     VALUES ($1, $2, $3, $4, true, true)
     ON CONFLICT (id) DO UPDATE SET role_id = EXCLUDED.role_id, is_active = true`,
    [input.userId, input.roleName, input.email, input.roleId]
  );
  const grants = [
    ["discounts", "view"],
    ...(input.withEdit === false ? [] : [["discounts", "edit"] as const]),
    ...(input.withCapacity
      ? [
          ["discount_capacity", "view"],
          ["discount_capacity", "edit"],
        ]
      : []),
  ] as const;
  for (const [module, action] of grants) {
    await pool!.query(
      `INSERT INTO admin_role_grant (id, role_id, module, action, scope)
       VALUES ($1, $2, $3, $4, 'global')
       ON CONFLICT (role_id, module, action) DO UPDATE SET scope = 'global'`,
      [`${input.roleId}-${module}-${action}`, input.roleId, module, action]
    );
  }
}

async function setGate(value: "0" | "1"): Promise<void> {
  await pool!.query(
    `INSERT INTO system_config (key, value, type, description)
     VALUES ('discounts.contractVersion', $1, 'number', 'test gate')
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [value]
  );
}

function uuid(): string {
  return randomUUID();
}

const DRAFT_TERMS = {
  name: "Diskon Rp17.000 Sepatu Pilihan",
  currency: "IDR",
  minSubtotal: "100000",
  startAt: null,
  endAt: null,
  benefit: {
    kind: "fixed_goods",
    paramsVersion: 1,
    fixedAmount: "17000",
  },
} as const;

async function createDraft(actor = ACTOR) {
  return createPublicDraftOffer(
    { requestKey: uuid(), activationKind: "public" },
    actor
  );
}

async function createSavedDraft(actor = ACTOR) {
  const created = await createDraft(actor);
  const saved = await saveDiscountOfferDraft(
    {
      offerId: created.data.id,
      expectedOfferVersion: created.data.version,
      expectedDraftVersion: created.data.draftVersion,
      terms: { ...DRAFT_TERMS, benefit: { ...DRAFT_TERMS.benefit } },
    },
    actor
  );
  return saved;
}

async function createPoliciedDraft(actor = ACTOR) {
  const saved = await createSavedDraft(actor);
  const result = await setDiscountOfferPolicy(
    {
      offerId: saved.id,
      requestKey: uuid(),
      expectedOfferVersion: saved.version,
      expectedPolicyVersion: saved.policyVersion,
      quotaCount: 10,
      budgetAmount: null,
      perClientLimit: 1,
    },
    actor
  );
  return result.data;
}

async function reviewAndPublish(actor = ACTOR) {
  const policied = await createPoliciedDraft(actor);
  const review = await reviewDiscountOffer(
    {
      offerId: policied.id,
      expectedOfferVersion: policied.version,
      expectedDraftVersion: policied.draftVersion,
    },
    actor
  );
  const requestKey = uuid();
  const published = await publishDiscountOffer(
    {
      offerId: policied.id,
      requestKey,
      expectedOfferVersion: review.offerVersion,
      expectedDraftVersion: review.draftVersion,
      expectedPolicyVersion: review.policyVersion,
      reviewFingerprint: review.fingerprint,
    },
    actor
  );
  return { policied, review, published, requestKey };
}

describe.skipIf(!dbReady)(
  "discount administration lifecycle (disposable DB)",
  () => {
    beforeAll(async () => {
      if (!pool) return;
      await cleanupOwnedRows();
      await insertActor({
        roleId: ROLE,
        userId: ACTOR,
        roleName: "ZZ Discount Admin",
        email: "zz-discount-admin@example.test",
        withCapacity: true,
      });
      await insertActor({
        roleId: NO_CAP_ROLE,
        userId: NO_CAP_ACTOR,
        roleName: "ZZ Discount Promo Only",
        email: "zz-discount-promo@example.test",
        withCapacity: false,
      });
      await insertActor({
        roleId: VIEW_ROLE,
        userId: VIEW_ACTOR,
        roleName: "ZZ Discount Viewer",
        email: "zz-discount-viewer@example.test",
        withCapacity: false,
        withEdit: false,
      });
      await setGate("1");
    });

    // =========================================================
// Seam T — Manual Promo Code administration (ticket 09)
// =========================================================
// Semua assertion lewat interface domain (bukan SQL) kecuali query bukti audit
// dan hitungan baris. Expected literal kode independen dari implementasi:
// trim+uppercase, ASCII, unik global, reserved saat add/publish berhasil.
describe("manual promo code administration (disposable DB)", () => {
  let manualOfferId: string;

  async function createManualDraft(codes?: string[], actor = ACTOR) {
    return createPublicDraftOffer(
      {
        requestKey: uuid(),
        activationKind: "manual_only",
        ...(codes ? { codes } : {}),
      },
      actor
    );
  }

  function inputInvalid(error: unknown): boolean {
    return (
      error instanceof DiscountAdministrationError &&
      error.code === "INPUT_INVALID"
    );
  }

  it("membuat draft manual dengan kode yang langsung direservasi, label masked di audit", async () => {
    const created = await createManualDraft([" zzfixmanual17 ", "zzfixpromo2026"]);
    manualOfferId = created.data.id;
    expect(created.status).toBe(201);
    expect(created.data.activationKind).toBe("manual_only");
    expect(created.data.codeLiteralVisible).toBe(true);
    expect(created.data.codes.map((code) => code.code)).toEqual([
      "ZZFIXMANUAL17",
      "ZZFIXPROMO2026",
    ]);
    // Viewer channel (list) hanya menerima label masked.
    const list = await listDiscountOffers({ limit: 50 }, VIEW_ACTOR);
    const listed = list.data.find((row) => row.id === manualOfferId);
    expect(listed?.codeCount).toBe(2);
    expect(listed?.codes.map((code) => code.maskedCode)).not.toContain(
      "ZZFIXMANUAL17"
    );
    expect(listed?.codes[0]?.maskedCode).toContain("•");

    // Audit tidak membuka literal; hanya ID + label masked.
    const audit = await pool!.query(
      `select changes::text as changes from audit_log
        where entity_type = 'discount_offer' and entity_id = $1
          and action = 'DISCOUNT_OFFER_DRAFT_CREATED'`,
      [manualOfferId]
    );
    const changes = audit.rows.map((row) => row.changes).join(" ");
    expect(changes).not.toContain("ZZFIXMANUAL17");
    expect(changes).toContain("ZZFIXMANUAL17".slice(0, 2));
  });

  it("menolak kode publik, alias/duplikat canonical dan literal salah bentuk", async () => {
    await expect(
      createPublicDraftOffer(
        { requestKey: uuid(), activationKind: "public", codes: ["HEMAT17"] },
        ACTOR
      )
    ).rejects.toMatchObject({ code: "CODE_NOT_SUPPORTED" });
    await expect(
      createManualDraft(["HEMAT17", "hemat17"])
    ).rejects.toSatisfy(inputInvalid);
    await expect(createManualDraft(["HEMAT 17"])).rejects.toSatisfy(inputInvalid);
    await expect(createManualDraft(["hémät17"])).rejects.toSatisfy(inputInvalid);
    await expect(createManualDraft(["AB"])).rejects.toSatisfy(inputInvalid);
    await expect(createManualDraft(["_HEMAT"])).rejects.toSatisfy(inputInvalid);
  });

  it("add-code replay tidak menggandakan code/audit/version dan tidak mereset usage", async () => {
    const before = await getDiscountOfferDetail(manualOfferId, ACTOR);
    const command = {
      offerId: manualOfferId,
      requestKey: uuid(),
      code: " zzfixmanual17 ", // canonical sama dengan kode pertama → konflik
      expectedOfferVersion: before!.version,
    };
    await expect(addDiscountCode(command, ACTOR)).rejects.toMatchObject({
      code: "CODE_CONFLICT",
    });

    const add = {
      offerId: manualOfferId,
      requestKey: uuid(),
      code: "zzfixnew2026",
      expectedOfferVersion: before!.version,
    };
    const first = await addDiscountCode(add, ACTOR);
    expect(first.status).toBe(201);
    expect(first.replayed).toBe(false);
    expect(first.data.codes.map((code) => code.code)).toContain("ZZFIXNEW2026");
    expect(first.data.version).toBe(before!.version + 1);
    expect(first.data.usage).toEqual(before!.usage);

    const replay = await addDiscountCode(add, ACTOR);
    expect(replay.status).toBe(200);
    expect(replay.replayed).toBe(true);
    expect(replay.data.version).toBe(first.data.version);
    expect(replay.data.codes).toHaveLength(first.data.codes.length);

    await expect(
      addDiscountCode({ ...add, code: "zzfixother2026" }, ACTOR)
    ).rejects.toMatchObject({ code: "REQUEST_KEY_CONFLICT" });

    const audit = await pool!.query(
      `select count(*)::int as count from audit_log
        where entity_type = 'discount_offer' and entity_id = $1
          and action = 'DISCOUNT_CODE_ADDED'`,
      [manualOfferId]
    );
    expect(audit.rows[0].count).toBe(1);
  });

  it("canonical uniqueness global dan channel mutlak pada add-code", async () => {
    const other = await createManualDraft(["ZZFIXOTHEROFFER1"]);
    const current = await getDiscountOfferDetail(manualOfferId, ACTOR);
    await expect(
      addDiscountCode(
        {
          offerId: other.data.id,
          requestKey: uuid(),
          code: "zzfixnew2026",
          expectedOfferVersion: other.data.version,
        },
        ACTOR
      )
    ).rejects.toMatchObject({ code: "CODE_CONFLICT" });

    const publicDraft = await createDraft();
    await expect(
      addDiscountCode(
        {
          offerId: publicDraft.data.id,
          requestKey: uuid(),
          code: "ZZFIXPUBLICADD1",
          expectedOfferVersion: publicDraft.data.version,
        },
        ACTOR
      )
    ).rejects.toMatchObject({ code: "CODE_NOT_SUPPORTED" });

    // Version guard stale juga berlaku untuk code mutation.
    await expect(
      addDiscountCode(
        {
          offerId: manualOfferId,
          requestKey: uuid(),
          code: "ZZFIXSTALEGUARD1",
          expectedOfferVersion: current!.version - 1,
        },
        ACTOR
      )
    ).rejects.toMatchObject({ code: "STALE_REVISION" });
  });

  it("state kode: inactive lalu arsip terminal, version guard, dan owner tetap", async () => {
    const detail = await getDiscountOfferDetail(manualOfferId, ACTOR);
    const target = detail!.codes.find((code) => code.code === "ZZFIXNEW2026")!;
    const inactive = await setDiscountCodeState(
      {
        offerId: manualOfferId,
        codeId: target.id,
        expectedOfferVersion: detail!.version,
        expectedCodeVersion: target.version,
        state: "inactive",
      },
      ACTOR
    );
    expect(inactive.data.codes.find((code) => code.id === target.id)?.state).toBe(
      "inactive"
    );
    await expect(
      setDiscountCodeState(
        {
          offerId: manualOfferId,
          codeId: target.id,
          expectedOfferVersion: inactive.data.version,
          expectedCodeVersion: target.version,
          state: "active",
        },
        ACTOR
      )
    ).rejects.toMatchObject({ code: "STALE_REVISION" });

    const inactiveCode = inactive.data.codes.find((code) => code.id === target.id)!;
    const archived = await setDiscountCodeState(
      {
        offerId: manualOfferId,
        codeId: target.id,
        expectedOfferVersion: inactive.data.version,
        expectedCodeVersion: inactiveCode.version,
        state: "archived",
      },
      ACTOR
    );
    expect(archived.data.codes.find((code) => code.id === target.id)?.state).toBe(
      "archived"
    );
    await expect(
      setDiscountCodeState(
        {
          offerId: manualOfferId,
          codeId: target.id,
          expectedOfferVersion: archived.data.version,
          expectedCodeVersion:
            archived.data.codes.find((code) => code.id === target.id)!.version,
          state: "active",
        },
        ACTOR
      )
    ).rejects.toMatchObject({ code: "CODE_ARCHIVED" });

    // Perintah state tidak menerima literal/owner baru: baris tetap milik Offer
    // yang sama dan canonical tidak berubah.
    const after = await getDiscountOfferDetail(manualOfferId, ACTOR);
    expect(after!.codes.find((code) => code.id === target.id)?.code).toBe(
      "ZZFIXNEW2026"
    );
  
  });

  it("viewer hanya menerima label masked pada detail dan tidak bisa mengubah state", async () => {
    const detail = await getDiscountOfferDetail(manualOfferId, VIEW_ACTOR);
    expect(detail!.codeLiteralVisible).toBe(false);
    for (const code of detail!.codes) {
      expect(code.code).toBeUndefined();
      expect(code.maskedCode).not.toContain("ZZFIXMANUAL17");
      expect(code.maskedCode).toContain("•");
    }
    const target = detail!.codes[0]!;
    await expect(
      setDiscountCodeState(
        {
          offerId: manualOfferId,
          codeId: target.id,
          expectedOfferVersion: detail!.version,
          expectedCodeVersion: target.version,
          state: "inactive",
        },
        VIEW_ACTOR
      )
    ).rejects.toMatchObject({ code: "DENIED" });
  });

  it("publish mereservasi usulan kode yang direview dan menolak usulan yang berubah", async () => {
    const saved = await createSavedDraft();
    const policied = await setDiscountOfferPolicy(
      {
        offerId: saved.id,
        requestKey: uuid(),
        expectedOfferVersion: saved.version,
        expectedPolicyVersion: saved.policyVersion,
        quotaCount: 10,
        budgetAmount: null,
        perClientLimit: 1,
      },
      ACTOR
    );
    // Offer publik tidak bisa membawa usulan kode.
    await expect(
      reviewDiscountOffer(
        {
          offerId: policied.data.id,
          expectedOfferVersion: policied.data.version,
          expectedDraftVersion: policied.data.draftVersion,
          proposedCodes: ["ZZFIXPUBLISH1"],
        },
        ACTOR
      )
    ).rejects.toMatchObject({ code: "CODE_NOT_SUPPORTED" });

    // Offer manual: review dengan usulan -> publish mereservasi tepat kode itu.
    const manual = await createManualDraft();
    const savedManual = await saveDiscountOfferDraft(
      {
        offerId: manual.data.id,
        expectedOfferVersion: manual.data.version,
        expectedDraftVersion: manual.data.draftVersion,
        terms: { ...DRAFT_TERMS, benefit: { ...DRAFT_TERMS.benefit } },
      },
      ACTOR
    );
    const manualPolicied = await setDiscountOfferPolicy(
      {
        offerId: savedManual.id,
        requestKey: uuid(),
        expectedOfferVersion: savedManual.version,
        expectedPolicyVersion: savedManual.policyVersion,
        quotaCount: 5,
        budgetAmount: null,
        perClientLimit: 1,
      },
      ACTOR
    );
    const review = await reviewDiscountOffer(
      {
        offerId: manualPolicied.data.id,
        expectedOfferVersion: manualPolicied.data.version,
        expectedDraftVersion: manualPolicied.data.draftVersion,
        proposedCodes: ["zzfixpublish2026", "ZZFIXLAIN2026"],
      },
      ACTOR
    );
    expect(review.proposedCodes).toEqual(["ZZFIXPUBLISH2026", "ZZFIXLAIN2026"]);

    await expect(
      publishDiscountOffer(
        {
          offerId: manualPolicied.data.id,
          requestKey: uuid(),
          expectedOfferVersion: review.offerVersion,
          expectedDraftVersion: review.draftVersion,
          expectedPolicyVersion: review.policyVersion,
          reviewFingerprint: review.fingerprint,
          proposedCodes: ["ZZFIXPUBLISH2026"],
        },
        ACTOR
      )
    ).rejects.toMatchObject({ code: "STALE_REVISION" });

    const published = await publishDiscountOffer(
      {
        offerId: manualPolicied.data.id,
        requestKey: uuid(),
        expectedOfferVersion: review.offerVersion,
        expectedDraftVersion: review.draftVersion,
        expectedPolicyVersion: review.policyVersion,
        reviewFingerprint: review.fingerprint,
        proposedCodes: ["zzfixpublish2026", "ZZFIXLAIN2026"],
      },
      ACTOR
    );
    expect(published.data.state).toBe("enabled");
    // Urutan DTO deterministik (createdAt, canonical): bukan urutan pengetikan.
    expect(published.data.codes.map((code) => code.code)).toEqual([
      "ZZFIXLAIN2026",
      "ZZFIXPUBLISH2026",
    ]);
    expect(published.data.usage).toMatchObject({ reservedCount: 0, consumedCount: 0 });
  });
});

    afterAll(async () => {
      if (!pool) return;
      await cleanupOwnedRows();
      await setGate("0");
      await pool.query(`DELETE FROM admin_role_grant WHERE role_id = ANY($1::text[])`, [
        [ROLE, NO_CAP_ROLE, VIEW_ROLE],
      ]);
      await pool.query(`DELETE FROM "user" WHERE id = ANY($1::text[])`, [ACTORS]);
      await pool.query(`DELETE FROM admin_role WHERE id = ANY($1::text[])`, [
        [ROLE, NO_CAP_ROLE, VIEW_ROLE],
      ]);
      await pool.end();
    });

    it("creates a draft, refuses to publish it without capacity, and reports the missing bound", async () => {
      const saved = await createSavedDraft();
      expect(saved.state).toBe("draft");
      expect(saved.currentRevisionId).toBeNull();
      expect(saved.draftRevision?.benefit?.fixedAmount).toBe("17000");
      expect(saved.quotaCount).toBeNull();
      expect(saved.budgetAmount).toBeNull();
      expect(saved.usage).toMatchObject({
        reservedCount: 0,
        consumedCount: 0,
        reservedAmount: "0",
        consumedAmount: "0",
      });

      const review = await reviewDiscountOffer(
        {
          offerId: saved.id,
          expectedOfferVersion: saved.version,
          expectedDraftVersion: saved.draftVersion,
        },
        ACTOR
      );
      expect(review.canPublish).toBe(false);
      expect(
        review.validations.filter((row) => !row.ok).map((row) => row.code)
      ).toContain("CAPACITY_BOUND");
      expect(review.fingerprint).toBe("");

      await expect(
        publishDiscountOffer(
          {
            offerId: saved.id,
            requestKey: uuid(),
            expectedOfferVersion: review.offerVersion,
            expectedDraftVersion: review.draftVersion,
            expectedPolicyVersion: review.policyVersion,
            reviewFingerprint: "0".repeat(64),
          },
          ACTOR
        )
      ).rejects.toMatchObject({ code: "OFFER_NOT_PUBLISHABLE" });

      const detail = await getDiscountOfferDetail(saved.id, ACTOR);
      expect(detail?.currentRevisionId).toBeNull();
      expect(detail?.state).toBe("draft");
    });

    it("reviews, simulates and publishes atomically", async () => {
      const { policied, review, published } = await reviewAndPublish();

      expect(review.canPublish).toBe(true);
      expect(review.fingerprint).toMatch(/^[0-9a-f]{64}$/);
      expect(review.diff.terms.find((row) => row.field === "name")?.live).toBeNull();

      // Spec literal: subtotal150000, fixed17000, PPN11% -> 133000 / 14630 /
      // 147630 on pickup (no shipping).
      const simulation = await simulateDiscountOffer(
        {
          offerId: policied.id,
          expectedDraftVersion: policied.draftVersion,
          fulfillmentMethod: "pickup",
          lines: [{ variantId: "variant-150k", unitPrice: "150000", quantity: 1 }],
        },
        ACTOR
      );
      expect(simulation.simulation).toBe(true);
      expect(simulation.applied).toBe(true);
      expect(simulation.breakdown.subtotal).toBe("150000");
      expect(simulation.breakdown.netGoods).toBe("133000");
      expect(simulation.breakdown.ppnAmount).toBe("14630");
      expect(simulation.breakdown.total).toBe("147630");
      expect(simulation.notice).toMatch(/bukan quote/);

      expect(published.data.state).toBe("enabled");
      expect(published.data.currentRevisionId).toBe(review.draftRevisionId);
      expect(published.data.liveRevision?.benefit?.fixedAmount).toBe("17000");
      expect(published.data.draftRevision).toBeNull();
      expect(published.data.usage?.consumedCount).toBe(0);
      expect(published.replayed).toBe(false);
    });

    it("replays the exact publish receipt and refuses a changed command on the same key", async () => {
      const policied = await createPoliciedDraft();
      const review = await reviewDiscountOffer(
        {
          offerId: policied.id,
          expectedOfferVersion: policied.version,
          expectedDraftVersion: policied.draftVersion,
        },
        ACTOR
      );
      const requestKey = uuid();
      const command = {
        offerId: policied.id,
        requestKey,
        expectedOfferVersion: review.offerVersion,
        expectedDraftVersion: review.draftVersion,
        expectedPolicyVersion: review.policyVersion,
        reviewFingerprint: review.fingerprint,
      };
      const first = await publishDiscountOffer(command, ACTOR);
      const replay = await publishDiscountOffer(command, ACTOR);
      expect(replay.replayed).toBe(true);
      expect(replay.data.currentRevisionId).toBe(first.data.currentRevisionId);

      // Same key, different review fingerprint -> conflict, never a second
      // publish. The receipt is checked before any draft/version validation.
      await expect(
        publishDiscountOffer(
          { ...command, reviewFingerprint: "1".repeat(64) },
          ACTOR
        )
      ).rejects.toMatchObject({ code: "REQUEST_KEY_CONFLICT" });
    });

    it("refuses a second editor's stale draft save and a stale publish", async () => {
      // Capture the versions BEFORE the first save: the returned DTO already
      // carries the post-save versions, so a stale editor is one holding the
      // previously loaded pair.
      const created = await createDraft();
      const loaded = {
        offerVersion: created.data.version,
        draftVersion: created.data.draftVersion,
      };
      const saved = await saveDiscountOfferDraft(
        {
          offerId: created.data.id,
          expectedOfferVersion: loaded.offerVersion,
          expectedDraftVersion: loaded.draftVersion,
          terms: { ...DRAFT_TERMS, benefit: { ...DRAFT_TERMS.benefit } },
        },
        ACTOR
      );
      await expect(
        saveDiscountOfferDraft(
          {
            offerId: created.data.id,
            expectedOfferVersion: loaded.offerVersion,
            expectedDraftVersion: loaded.draftVersion,
            terms: { ...DRAFT_TERMS, name: "Editor kedua", benefit: { ...DRAFT_TERMS.benefit } },
          },
          ACTOR
        )
      ).rejects.toMatchObject({ code: "STALE_REVISION" });

      const policied = (
        await setDiscountOfferPolicy(
          {
            offerId: saved.id,
            requestKey: uuid(),
            expectedOfferVersion: saved.version,
            expectedPolicyVersion: saved.policyVersion,
            quotaCount: 10,
            budgetAmount: null,
            perClientLimit: 1,
          },
          ACTOR
        )
      ).data;
      const review = await reviewDiscountOffer(
        {
          offerId: policied.id,
          expectedOfferVersion: policied.version,
          expectedDraftVersion: policied.draftVersion,
        },
        ACTOR
      );
      // A newer draft save invalidates the review context.
      await saveDiscountOfferDraft(
        {
          offerId: policied.id,
          expectedOfferVersion: policied.version,
          expectedDraftVersion: policied.draftVersion,
          terms: { ...DRAFT_TERMS, name: "Revisi setelah review", benefit: { ...DRAFT_TERMS.benefit } },
        },
        ACTOR
      );
      await expect(
        publishDiscountOffer(
          {
            offerId: policied.id,
            requestKey: uuid(),
            expectedOfferVersion: review.offerVersion,
            expectedDraftVersion: review.draftVersion,
            expectedPolicyVersion: review.policyVersion,
            reviewFingerprint: review.fingerprint,
          },
          ACTOR
        )
      ).rejects.toMatchObject({ code: "STALE_REVISION" });
    });

    it("requires the capacity grant for initial capacity, but allows a draft without it", async () => {
      const saved = await createSavedDraft(NO_CAP_ACTOR);
      expect(saved.draftRevision?.benefit?.fixedAmount).toBe("17000");

      await expect(
        setDiscountOfferPolicy(
          {
            offerId: saved.id,
            requestKey: uuid(),
            expectedOfferVersion: saved.version,
            expectedPolicyVersion: saved.policyVersion,
            quotaCount: 10,
            budgetAmount: null,
            perClientLimit: 1,
          },
          NO_CAP_ACTOR
        )
      ).rejects.toMatchObject({ code: "DENIED" });

      // The Offer is still an unlaunchable draft with no capacity: a promo
      // editor cannot publish capacity through a publish bypass.
      const detail = await getDiscountOfferDetail(saved.id, NO_CAP_ACTOR);
      expect(detail?.state).toBe("draft");
      expect(detail?.quotaCount).toBeNull();
      expect(detail?.budgetAmount).toBeNull();
    });

    it("fails closed on projection counters that have no Redemption ledger evidence", async () => {
      // Ticket 12 makes the append-only Redemption ledger the reconciliation
      // source. Fixture counters alone are no longer treated as a commitment;
      // a drifted projection is held for review instead of being used to
      // accept/reject arithmetic. Real-ledger quota reductions are covered by
      // discount-operations-read.db.test.ts.
      const { policied, published } = await reviewAndPublish();
      await pool!.query(
        `UPDATE discount_offer_usage
            SET reserved_count = 8, consumed_count = 1,
                reserved_amount = '80000', consumed_amount = '17000', version = version + 1
          WHERE offer_id = $1`,
        [policied.id]
      );

      await expect(
        setDiscountOfferPolicy(
          {
            offerId: policied.id,
            requestKey: uuid(),
            expectedOfferVersion: published.data.version,
            expectedPolicyVersion: published.data.policyVersion,
            quotaCount: 5,
            budgetAmount: null,
            perClientLimit: 1,
          },
          ACTOR
        )
      ).rejects.toMatchObject({ code: "USAGE_DRIFT_REVIEW" });

      const detail = await getDiscountOfferDetail(policied.id, ACTOR);
      expect(detail?.quotaCount).toBe(10);
      expect(detail?.usage?.reservedCount).toBe(8);
    });

    it("pauses without resetting usage or identity and keeps the published revision", async () => {
      const { policied, published } = await reviewAndPublish();
      const paused = (
        await setDiscountOfferState(
          {
            offerId: policied.id,
            requestKey: uuid(),
            expectedVersion: published.data.version,
            state: "paused",
          },
          ACTOR
        )
      ).data;
      expect(paused.state).toBe("paused");
      expect(paused.currentRevisionId).toBe(published.data.currentRevisionId);
      expect(paused.liveRevision?.benefit?.fixedAmount).toBe("17000");
      expect(paused.usage).toEqual(published.data.usage);

      // A draft Offer cannot be toggled live: publication is the only path.
      const draft = await createSavedDraft();
      await expect(
        setDiscountOfferState(
          {
            offerId: draft.id,
            requestKey: uuid(),
            expectedVersion: draft.version,
            state: "enabled",
          },
          ACTOR
        )
      ).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
    });

    it("keeps the old published revision and its benefit when a new revision is published", async () => {
      const { policied, published } = await reviewAndPublish();
      const withNewDraft = await saveDiscountOfferDraft(
        {
          offerId: policied.id,
          expectedOfferVersion: published.data.version,
          expectedDraftVersion: published.data.draftVersion,
          terms: {
            ...DRAFT_TERMS,
            name: "Revisi kedua",
            benefit: { ...DRAFT_TERMS.benefit, fixedAmount: "25000" },
          },
        },
        ACTOR
      );
      const review = await reviewDiscountOffer(
        {
          offerId: policied.id,
          expectedOfferVersion: withNewDraft.version,
          expectedDraftVersion: withNewDraft.draftVersion,
        },
        ACTOR
      );
      const second = await publishDiscountOffer(
        {
          offerId: policied.id,
          requestKey: uuid(),
          expectedOfferVersion: review.offerVersion,
          expectedDraftVersion: review.draftVersion,
          expectedPolicyVersion: review.policyVersion,
          reviewFingerprint: review.fingerprint,
        },
        ACTOR
      );

      expect(second.data.currentRevisionId).not.toBe(published.data.currentRevisionId);
      expect(second.data.liveRevision?.name).toBe("Revisi kedua");
      // A new revision/rename never resets or reinterprets usage.
      expect(second.data.usage).toEqual(published.data.usage);
      expect(second.data.liveRevision?.benefit?.fixedAmount).toBe("25000");

      const revisions = await pool!.query<{
        revision_no: number;
        published_at: Date | null;
        fixed_amount: string | null;
      }>(
        `SELECT r.revision_no, r.published_at, b.fixed_amount
           FROM discount_offer_revision r
           LEFT JOIN discount_benefit b ON b.revision_id = r.id
          WHERE r.offer_id = $1
          ORDER BY r.revision_no`,
        [policied.id]
      );
      // Exactly two published revisions, one benefit each, no unpublished draft
      // left behind after publish.
      expect(revisions.rows).toHaveLength(2);
      expect(revisions.rows.map((row) => row.fixed_amount)).toEqual([
        "17000.00",
        "25000.00",
      ]);
      expect(revisions.rows.every((row) => row.published_at !== null)).toBe(true);
    });

    it("replays state and policy receipts and refuses a changed command on the same key", async () => {
      // Policy: a lost response must replay the committed capacity, not apply a
      // second change or reinterpret the same key.
      const saved = await createSavedDraft();
      const policyCommand = {
        offerId: saved.id,
        requestKey: uuid(),
        expectedOfferVersion: saved.version,
        expectedPolicyVersion: saved.policyVersion,
        quotaCount: 10,
        budgetAmount: null,
        perClientLimit: 1,
      };
      const firstPolicy = await setDiscountOfferPolicy(policyCommand, ACTOR);
      expect(firstPolicy.replayed).toBe(false);
      const replayPolicy = await setDiscountOfferPolicy(policyCommand, ACTOR);
      expect(replayPolicy.replayed).toBe(true);
      expect(replayPolicy.data.quotaCount).toBe(10);
      await expect(
        setDiscountOfferPolicy({ ...policyCommand, quotaCount: 11 }, ACTOR)
      ).rejects.toMatchObject({ code: "REQUEST_KEY_CONFLICT" });

      // State: publish first, then replay a pause command.
      const review = await reviewDiscountOffer(
        {
          offerId: replayPolicy.data.id,
          expectedOfferVersion: replayPolicy.data.version,
          expectedDraftVersion: replayPolicy.data.draftVersion,
        },
        ACTOR
      );
      const published = await publishDiscountOffer(
        {
          offerId: replayPolicy.data.id,
          requestKey: uuid(),
          expectedOfferVersion: review.offerVersion,
          expectedDraftVersion: review.draftVersion,
          expectedPolicyVersion: review.policyVersion,
          reviewFingerprint: review.fingerprint,
        },
        ACTOR
      );
      const stateCommand = {
        offerId: saved.id,
        requestKey: uuid(),
        expectedVersion: published.data.version,
        state: "paused" as const,
      };
      const firstState = await setDiscountOfferState(stateCommand, ACTOR);
      expect(firstState.replayed).toBe(false);
      const replayState = await setDiscountOfferState(stateCommand, ACTOR);
      expect(replayState.replayed).toBe(true);
      expect(replayState.data.state).toBe("paused");
      await expect(
        setDiscountOfferState({ ...stateCommand, state: "archived" }, ACTOR)
      ).rejects.toMatchObject({ code: "REQUEST_KEY_CONFLICT" });
    });
  // =========================================================
  // Seam T — percentage goods administration (ticket 10)
  // =========================================================
  // Literal expected dari spec §4.2/§4.4. Draft/review/publish/simulasi wajib
  // memakai bentuk benefit yang sama dengan evaluator customer.
  describe("percentage goods administration", () => {
    const PERCENT_TERMS = {
      name: "Diskon 10% maksimal Rp20.000",
      currency: "IDR",
      minSubtotal: "100000",
      startAt: null,
      endAt: null,
      benefit: {
        kind: "percentage_goods",
        paramsVersion: 1,
        rate: "10.000000",
        capAmount: "20000",
      },
    } as const;

    async function createPercentageDraft() {
      const created = await createDraft();
      const saved = await saveDiscountOfferDraft(
        {
          offerId: created.data.id,
          expectedOfferVersion: created.data.version,
          expectedDraftVersion: created.data.draftVersion,
          terms: {
            ...PERCENT_TERMS,
            benefit: { ...PERCENT_TERMS.benefit },
          },
        },
        ACTOR
      );
      const policied = await setDiscountOfferPolicy(
        {
          offerId: saved.id,
          requestKey: uuid(),
          expectedOfferVersion: saved.version,
          expectedPolicyVersion: saved.policyVersion,
          quotaCount: 10,
          budgetAmount: null,
          perClientLimit: 1,
        },
        ACTOR
      );
      return policied.data;
    }

    it("menyimpan rate/cap percentage dan menolak precision berlebih tanpa mengubah draft", async () => {
      const created = await createDraft();
      await expect(
        saveDiscountOfferDraft(
          {
            offerId: created.data.id,
            expectedOfferVersion: created.data.version,
            expectedDraftVersion: created.data.draftVersion,
            terms: {
              ...PERCENT_TERMS,
              benefit: { ...PERCENT_TERMS.benefit, rate: "10.1234567" },
            },
          },
          ACTOR
        )
      ).rejects.toMatchObject({ code: "INPUT_INVALID" });

      const saved = await saveDiscountOfferDraft(
        {
          offerId: created.data.id,
          expectedOfferVersion: created.data.version,
          expectedDraftVersion: created.data.draftVersion,
          terms: {
            ...PERCENT_TERMS,
            benefit: { ...PERCENT_TERMS.benefit },
          },
        },
        ACTOR
      );
      expect(saved.draftRevision?.benefit).toMatchObject({
        kind: "percentage_goods",
        rate: "10",
        capAmount: "20000",
        fixedAmount: null,
      });

      const detail = await getDiscountOfferDetail(created.data.id, ACTOR);
      expect(detail?.draftRevision?.benefit?.rate).toBe("10");
    });

    it("review, simulasi cap dan uncapped memakai nominal exact, lalu publish", async () => {
      const draft = await createPercentageDraft();
      const review = await reviewDiscountOffer(
        {
          offerId: draft.id,
          expectedOfferVersion: draft.version,
          expectedDraftVersion: draft.draftVersion,
        },
        ACTOR
      );
      expect(review.canPublish).toBe(true);
      expect(review.diff.benefit.draft).toMatchObject({
        kind: "percentage_goods",
        rate: "10",
        capAmount: "20000",
      });

      const capped = await simulateDiscountOffer(
        {
          offerId: draft.id,
          expectedDraftVersion: draft.draftVersion,
          fulfillmentMethod: "pickup",
          lines: [{ variantId: "variant-450k", unitPrice: "450000", quantity: 1 }],
        },
        ACTOR
      );
      expect(capped.applied).toBe(true);
      expect(capped.benefit).toEqual({
        kind: "percentage_goods",
        paramsVersion: 1,
        rate: "10",
        capAmount: "20000",
      });
      expect(capped.breakdown).toMatchObject({
        subtotal: "450000",
        goodsDiscount: "20000",
        netGoods: "430000",
        ppnAmount: "47300",
        total: "477300",
        expectedProviderPayable: "430000",
      });

      const published = await publishDiscountOffer(
        {
          offerId: draft.id,
          requestKey: uuid(),
          expectedOfferVersion: review.offerVersion,
          expectedDraftVersion: review.draftVersion,
          expectedPolicyVersion: review.policyVersion,
          reviewFingerprint: review.fingerprint,
        },
        ACTOR
      );
      expect(published.data.liveRevision?.benefit).toMatchObject({
        kind: "percentage_goods",
        rate: "10",
        capAmount: "20000",
        fixedAmount: null,
      });

      // Simulasi ulang memakai revision live; uncapped dihitung dari rate.
      const uncapped = await simulateDiscountOffer(
        {
          offerId: draft.id,
          expectedDraftVersion: published.data.draftVersion,
          fulfillmentMethod: "pickup",
          lines: [{ variantId: "variant-450k", unitPrice: "450000", quantity: 1 }],
        },
        ACTOR
      );
      expect(uncapped.applied).toBe(true);
      expect(uncapped.breakdown.goodsDiscount).toBe("20000");

      // Simulasi subtotal di bawah minimum tidak menerapkan benefit.
      const belowMinimum = await simulateDiscountOffer(
        {
          offerId: draft.id,
          expectedDraftVersion: published.data.draftVersion,
          fulfillmentMethod: "pickup",
          lines: [{ variantId: "variant-50", unitPrice: "50", quantity: 1 }],
        },
        ACTOR
      );
      expect(belowMinimum.applied).toBe(false);
      expect(belowMinimum.breakdown.goodsDiscount).toBe("0");
    });
  });

  }
);

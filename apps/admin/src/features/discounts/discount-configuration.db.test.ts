import dotenv from "dotenv";
import path from "node:path";
dotenv.config({ path: path.resolve(import.meta.dirname, "../../../../../.env"), quiet: true });
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createPublicDraftOffer, saveDiscountOfferDraft, setDiscountOfferPolicy,
  reviewDiscountOffer, publishDiscountOffer, getDiscountOfferDetail,
} from "@/lib/discounts-administration";
import { saveDiscountConfiguration } from "./save-discount-configuration-service";
import { reviewDiscountConfiguration } from "./review-discount-configuration-service";
import { publishDiscountConfiguration } from "./publish-discount-configuration-service";
import { getDiscountEditorDetail } from "./discount-configuration-repository";
import type { DiscountDraftConfiguration } from "@marketplace/db/src/discount-draft";

const url = process.env.DATABASE_URL;
if (url && !decodeURIComponent(new URL(url).pathname).slice(1).startsWith("marketplace_discounts_test_")) {
  throw new Error("discount-configuration: DATABASE_URL harus menunjuk DB disposable marketplace_discounts_test_*");
}
const pool = url ? new Pool({ connectionString: url, max: 3 }) : null;
const actor = "zz-unified-editor-actor";
const role = "zz-unified-editor-role";
const offers: string[] = [];
let previousGate: { value: string; type: string; description: string | null } | undefined;

async function cleanupOwned(ids: string[]) {
  await pool!.query("DELETE FROM discount_admin_request WHERE actor_identity = $1", [actor]);
  await pool!.query("DELETE FROM audit_log WHERE user_id = $1", [actor]);
  await pool!.query("UPDATE discount_offer SET state = 'draft', current_revision_id = NULL WHERE id = ANY($1::text[]) AND actor_identity = $2", [ids, actor]);
  await pool!.query("DELETE FROM discount_code WHERE offer_id = ANY($1::text[])", [ids]);
  await pool!.query("DELETE FROM discount_offer_usage WHERE offer_id = ANY($1::text[])", [ids]);
  await pool!.query("DELETE FROM discount_benefit WHERE revision_id IN (SELECT id FROM discount_offer_revision WHERE offer_id = ANY($1::text[]))", [ids]);
  await pool!.query("DELETE FROM discount_offer_revision WHERE offer_id = ANY($1::text[])", [ids]);
  await pool!.query("DELETE FROM discount_offer WHERE id = ANY($1::text[]) AND actor_identity = $2", [ids, actor]);
  await pool!.query('DELETE FROM "user" WHERE id = $1', [actor]);
  await pool!.query("DELETE FROM admin_role_grant WHERE role_id = $1", [role]);
  await pool!.query("DELETE FROM admin_role WHERE id = $1", [role]);
}

async function create(activationKind: "public" | "manual_only" = "public") {
  const result = await createPublicDraftOffer({ requestKey: randomUUID(), activationKind }, actor);
  offers.push(result.data.id);
  return result.data;
}

function configuration(): DiscountDraftConfiguration {
  return {
    draftSchemaVersion: 1, name: "Promo 15%", currency: "IDR", minSubtotal: "0", startAt: null, endAt: null,
    benefit: { kind: "percentage_goods", paramsVersion: 1, rate: "15", capAmount: null },
    capacity: { quotaCount: 200, budgetAmount: null, perClientLimit: 2 },
    codeChanges: { proposedCodes: [], states: [] },
  };
}

describe.skipIf(!pool)("draft konfigurasi menyeluruh (PostgreSQL disposable)", () => {
  beforeAll(async () => {
    // Pulihkan fixture milik seam ini jika run sebelumnya terputus.
    const stale = await pool!.query("SELECT id FROM discount_offer WHERE actor_identity = $1", [actor]);
    const ids = stale.rows.map((row: { id: string }) => row.id);
    await cleanupOwned(ids);
    previousGate = (await pool!.query("SELECT value, type, description FROM system_config WHERE key = 'discounts.contractVersion'")).rows[0];
    await pool!.query(`INSERT INTO system_config (key, value, type) VALUES ('discounts.contractVersion', '1', 'number')
      ON CONFLICT (key) DO UPDATE SET value = '1'`);
    await pool!.query(`INSERT INTO admin_role (id, key, name, is_system, version) VALUES ($1, NULL, 'ZZ Unified Editor', false, 1)`, [role]);
    await pool!.query(`INSERT INTO "user" (id, name, email, role_id, is_active, email_verified)
      VALUES ($1, 'Unified Editor', 'zz-unified-editor@example.test', $2, true, true)`, [actor, role]);
    for (const moduleKey of ["discounts", "discount_capacity"]) {
      for (const action of ["view", "edit"]) {
        await pool!.query(`INSERT INTO admin_role_grant (id, role_id, module, action, scope) VALUES ($1, $2, $3, $4, 'global')`, [`${role}-${moduleKey}-${action}`, role, moduleKey, action]);
      }
    }
  });

  afterAll(async () => {
    if (!pool) return;
    try {
      await cleanupOwned(offers);
      if (previousGate) await pool.query("UPDATE system_config SET value = $1, type = $2, description = $3 WHERE key = 'discounts.contractVersion'", [previousGate.value, previousGate.type, previousGate.description]);
      else await pool.query("DELETE FROM system_config WHERE key = 'discounts.contractVersion'");
    } finally { await pool.end(); }
  });

  it("review dan publish menerapkan terms, kapasitas, dan kode dalam satu commit", async () => {
    const created = await create("manual_only");
    const config = { ...configuration(), codeChanges: { proposedCodes: ["PUBLISH-TOGETHER"], states: [] } };
    const saved = await saveDiscountConfiguration({ offerId: created.id, requestKey: randomUUID(), expectedOfferVersion: created.version,
      expectedDraftVersion: created.draftVersion, configuration: config }, actor);
    const review = await reviewDiscountConfiguration({ offerId: created.id, expectedOfferVersion: saved.version, expectedDraftVersion: saved.draftVersion }, actor);
    expect(review.issues).toEqual([]);
    expect(review.stateAfter).toBe("enabled");
    expect(review.configuration).toEqual(config);
    const command = { offerId: created.id, requestKey: randomUUID(), expectedOfferVersion: review.offerVersion,
      expectedDraftVersion: review.draftVersion, expectedPolicyVersion: review.policyVersion, reviewFingerprint: review.fingerprint };
    const result = await publishDiscountConfiguration(command, actor);
    expect(result.replayed).toBe(false);
    expect(result.data.liveRevision?.benefit?.rate).toBe("15");
    expect(result.data.quotaCount).toBe(200);
    expect(result.data.perClientLimit).toBe(2);
    expect(result.data.policyVersion).toBe(saved.policyVersion + 1);
    expect(result.data.codes).toEqual([expect.objectContaining({ code: "PUBLISH-TOGETHER", state: "active" })]);
    expect((await publishDiscountConfiguration(command, actor)).replayed).toBe(true);
  });

  it("izin kapasitas yang dicabut setelah review menolak seluruh publish", async () => {
    const created = await create();
    const saved = await saveDiscountConfiguration({ offerId: created.id, requestKey: randomUUID(), expectedOfferVersion: created.version,
      expectedDraftVersion: created.draftVersion, configuration: configuration() }, actor);
    const review = await reviewDiscountConfiguration({ offerId: created.id, expectedOfferVersion: saved.version, expectedDraftVersion: saved.draftVersion }, actor);
    await pool!.query("DELETE FROM admin_role_grant WHERE role_id = $1 AND module = 'discount_capacity'", [role]);
    try {
      await expect(publishDiscountConfiguration({ offerId: created.id, requestKey: randomUUID(), expectedOfferVersion: review.offerVersion,
        expectedDraftVersion: review.draftVersion, expectedPolicyVersion: review.policyVersion, reviewFingerprint: review.fingerprint }, actor))
        .rejects.toMatchObject({ code: "OFFER_NOT_PUBLISHABLE", fieldErrors: expect.arrayContaining([expect.objectContaining({ path: "capacity" })]) });
      const current = await getDiscountEditorDetail(created.id, actor);
      expect(current.currentRevisionId).toBeNull();
      expect(current.quotaCount).toBeNull();
      expect(current.draftConfiguration).toEqual(configuration());
    } finally {
      for (const action of ["view", "edit"]) await pool!.query("INSERT INTO admin_role_grant (id, role_id, module, action, scope) VALUES ($1, $2, 'discount_capacity', $3, 'global')", [`${role}-discount_capacity-${action}`, role, action]);
    }
  });

  it("kode direbut setelah review tidak menerapkan kapasitas atau pointer secara parsial", async () => {
    const left = await create("manual_only"), right = await create("manual_only");
    const config = { ...configuration(), codeChanges: { proposedCodes: ["RACE-CANONICAL"], states: [] } };
    const reviews = [];
    for (const created of [left, right]) {
      const saved = await saveDiscountConfiguration({ offerId: created.id, requestKey: randomUUID(), expectedOfferVersion: created.version,
        expectedDraftVersion: created.draftVersion, configuration: config }, actor);
      reviews.push(await reviewDiscountConfiguration({ offerId: created.id, expectedOfferVersion: saved.version, expectedDraftVersion: saved.draftVersion }, actor));
    }
    const commands = reviews.map((review) => ({ offerId: review.offerId, requestKey: randomUUID(), expectedOfferVersion: review.offerVersion,
      expectedDraftVersion: review.draftVersion, expectedPolicyVersion: review.policyVersion, reviewFingerprint: review.fingerprint }));
    const results = await Promise.allSettled(commands.map((command) => publishDiscountConfiguration(command, actor)));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const loser = results.findIndex((result) => result.status === "rejected");
    const unchanged = await getDiscountEditorDetail(commands[loser].offerId, actor);
    expect(unchanged.currentRevisionId).toBeNull();
    expect(unchanged.quotaCount).toBeNull();
    expect(unchanged.codes).toEqual([]);
    expect(unchanged.draftConfiguration).toEqual(config);
    const winner = results.findIndex((result) => result.status === "fulfilled");
    const published = await getDiscountEditorDetail(commands[winner].offerId, actor);
    expect(published.codes).toHaveLength(1);
  });

  it("perubahan status kode ikut draft; publish ulang tidak menaikkan policyVersion tanpa delta kapasitas", async () => {
    const created = await create("manual_only");
    const firstConfig = { ...configuration(), codeChanges: { proposedCodes: ["STATUS-STAGED"], states: [] } };
    const saved = await saveDiscountConfiguration({ offerId: created.id, requestKey: randomUUID(), expectedOfferVersion: created.version,
      expectedDraftVersion: created.draftVersion, configuration: firstConfig }, actor);
    const firstReview = await reviewDiscountConfiguration({ offerId: created.id, expectedOfferVersion: saved.version, expectedDraftVersion: saved.draftVersion }, actor);
    const live = (await publishDiscountConfiguration({ offerId: created.id, requestKey: randomUUID(), expectedOfferVersion: firstReview.offerVersion,
      expectedDraftVersion: firstReview.draftVersion, expectedPolicyVersion: firstReview.policyVersion, reviewFingerprint: firstReview.fingerprint }, actor)).data;
    const code = live.codes[0];
    const secondConfig = { ...live.draftConfiguration, name: "Nama berikutnya", codeChanges: { proposedCodes: [], states: [
      { codeId: code.id, expectedCodeVersion: code.version, state: "inactive" as const },
    ] } };
    const second = await saveDiscountConfiguration({ offerId: live.id, requestKey: randomUUID(), expectedOfferVersion: live.version,
      expectedDraftVersion: live.draftVersion, configuration: secondConfig }, actor);
    expect(second.codes[0].state).toBe("active");
    const review = await reviewDiscountConfiguration({ offerId: live.id, expectedOfferVersion: second.version, expectedDraftVersion: second.draftVersion }, actor);
    const result = (await publishDiscountConfiguration({ offerId: live.id, requestKey: randomUUID(), expectedOfferVersion: review.offerVersion,
      expectedDraftVersion: review.draftVersion, expectedPolicyVersion: review.policyVersion, reviewFingerprint: review.fingerprint }, actor)).data;
    expect(result.codes[0]).toMatchObject({ state: "inactive", version: code.version + 1 });
    expect(result.policyVersion).toBe(live.policyVersion);
    expect(result.liveRevision?.name).toBe("Nama berikutnya");
  });

  it("constraint snapshot menolak versi asing, missing discriminator, array, dan JSON oversized", async () => {
    const created = await create();
    for (const invalid of [{}, { draftSchemaVersion: 2 }, [], { draftSchemaVersion: 1, name: "x".repeat(262144) }]) {
      await expect(pool!.query("UPDATE discount_offer_revision SET draft_configuration = $1::jsonb WHERE offer_id = $2 AND published_at IS NULL", [JSON.stringify(invalid), created.id]))
        .rejects.toMatchObject({ code: "23514", constraint: "discount_offer_revision_draft_configuration_shape" });
    }
    expect((await getDiscountEditorDetail(created.id, actor)).draftConfiguration.name).toBeNull();
  });

  it("draft parsial memberi issue field dan tidak dapat dipublish", async () => {
    const created = await create();
    const saved = await saveDiscountConfiguration({ offerId: created.id, requestKey: randomUUID(), expectedOfferVersion: created.version,
      expectedDraftVersion: created.draftVersion, configuration: { ...configuration(), benefit: { kind: "shipping", paramsVersion: 1, capAmount: null } } }, actor);
    const review = await reviewDiscountConfiguration({ offerId: created.id, expectedOfferVersion: saved.version, expectedDraftVersion: saved.draftVersion }, actor);
    expect(review.issues).toEqual(expect.arrayContaining([expect.objectContaining({ path: "benefit.capAmount" })]));
    await expect(publishDiscountConfiguration({ offerId: created.id, requestKey: randomUUID(), expectedOfferVersion: review.offerVersion,
      expectedDraftVersion: review.draftVersion, expectedPolicyVersion: review.policyVersion, reviewFingerprint: review.fingerprint }, actor)).rejects.toMatchObject({ code: "OFFER_NOT_PUBLISHABLE" });
  });

  it("draft parsial manual tersimpan tanpa reservasi atau aktivasi kode", async () => {
    const created = await create("manual_only");
    const partial = { ...configuration(), name: null, benefit: null, minSubtotal: null,
      capacity: { quotaCount: null, budgetAmount: null, perClientLimit: null },
      codeChanges: { proposedCodes: ["DRAFT-ONLY-2026"], states: [] } };
    const saved = await saveDiscountConfiguration({ offerId: created.id, requestKey: randomUUID(),
      expectedOfferVersion: created.version, expectedDraftVersion: created.draftVersion, configuration: partial }, actor);
    expect(saved.draftConfiguration).toEqual(partial);
    expect(saved.codes).toEqual([]);
    expect(saved.currentRevisionId).toBeNull();
    const other = await create("manual_only");
    expect((await saveDiscountConfiguration({ offerId: other.id, requestKey: randomUUID(), expectedOfferVersion: other.version,
      expectedDraftVersion: other.draftVersion, configuration: partial }, actor)).draftConfiguration.codeChanges.proposedCodes).toEqual(["DRAFT-ONLY-2026"]);
  });

  it("retry dan dua submit bersamaan hanya menaikkan versi serta audit sekali", async () => {
    const created = await create();
    const command = { offerId: created.id, requestKey: randomUUID(), expectedOfferVersion: created.version,
      expectedDraftVersion: created.draftVersion, configuration: configuration() };
    const [first, second] = await Promise.all([saveDiscountConfiguration(command, actor), saveDiscountConfiguration(command, actor)]);
    expect(first.draftVersion).toBe(created.draftVersion + 1);
    expect(second.draftVersion).toBe(first.draftVersion);
    const result = await pool!.query("SELECT count(*)::int AS count FROM audit_log WHERE entity_id = $1 AND action = 'DISCOUNT_OFFER_DRAFT_SAVED'", [created.id]);
    expect(result.rows[0].count).toBe(1);
    await expect(saveDiscountConfiguration({ ...command, configuration: { ...configuration(), name: "Perubahan lain" } }, actor))
      .rejects.toMatchObject({ code: "REQUEST_KEY_CONFLICT" });
  });

  it("proposal kapasitas boleh disimpan tanpa grant discount_capacity", async () => {
    const created = await create();
    await pool!.query("DELETE FROM admin_role_grant WHERE role_id = $1 AND module = 'discount_capacity'", [role]);
    try {
      const saved = await saveDiscountConfiguration({ offerId: created.id, requestKey: randomUUID(), expectedOfferVersion: created.version,
        expectedDraftVersion: created.draftVersion, configuration: configuration() }, actor);
      expect(saved.draftConfiguration.capacity.quotaCount).toBe(200);
      expect(saved.quotaCount).toBeNull();
    } finally {
      for (const action of ["view", "edit"]) await pool!.query("INSERT INTO admin_role_grant (id, role_id, module, action, scope) VALUES ($1, $2, 'discount_capacity', $3, 'global')", [`${role}-discount_capacity-${action}`, role, action]);
    }
  });

  it("menolak stale version dan input invalid tanpa menimpa draft", async () => {
    const created = await create();
    const command = { offerId: created.id, requestKey: randomUUID(), expectedOfferVersion: created.version,
      expectedDraftVersion: created.draftVersion, configuration: configuration() };
    await saveDiscountConfiguration(command, actor);
    await expect(saveDiscountConfiguration({ ...command, requestKey: randomUUID() }, actor)).rejects.toMatchObject({ code: "STALE_REVISION" });
    await expect(saveDiscountConfiguration({ ...command, requestKey: randomUUID(), configuration: { ...configuration(), minSubtotal: "-1" } }, actor))
      .rejects.toMatchObject({ code: "INPUT_INVALID", fieldErrors: expect.arrayContaining([expect.objectContaining({ path: "minSubtotal" })]) });
    expect((await getDiscountEditorDetail(created.id, actor)).draftConfiguration).toEqual(configuration());
  });

  it("viewer tidak menerima proposal literal dan pencabutan edit menolak save", async () => {
    const created = await create("manual_only");
    const command = { offerId: created.id, requestKey: randomUUID(), expectedOfferVersion: created.version,
      expectedDraftVersion: created.draftVersion, configuration: { ...configuration(), codeChanges: { proposedCodes: ["PRIVATE-DRAFT"], states: [] } } };
    const saved = await saveDiscountConfiguration(command, actor);
    await pool!.query("DELETE FROM admin_role_grant WHERE role_id = $1 AND module = 'discounts' AND action = 'edit'", [role]);
    try {
      const viewer = await getDiscountEditorDetail(created.id, actor);
      expect(viewer.draftConfiguration.codeChanges).toEqual({ proposedCodes: [], states: [] });
      await expect(saveDiscountConfiguration({ ...command, requestKey: randomUUID(), expectedDraftVersion: saved.draftVersion }, actor)).rejects.toMatchObject({ code: "DENIED" });
      const receipts = await pool!.query("SELECT result_json FROM discount_admin_request WHERE actor_identity = $1 AND request_key = $2", [actor, command.requestKey]);
      expect(JSON.stringify(receipts.rows)).not.toContain("PRIVATE-DRAFT");
      const audit = await pool!.query("SELECT changes FROM audit_log WHERE entity_id = $1", [created.id]);
      expect(JSON.stringify(audit.rows)).not.toContain("PRIVATE-DRAFT");
    } finally {
      await pool!.query("INSERT INTO admin_role_grant (id, role_id, module, action, scope) VALUES ($1, $2, 'discounts', 'edit', 'global')", [`${role}-discounts-edit`, role]);
    }
  });

  it("kegagalan audit membatalkan snapshot, versi, dan receipt dalam transaksi yang sama", async () => {
    const created = await create();
    const before = await getDiscountEditorDetail(created.id, actor);
    await pool!.query(`CREATE FUNCTION zz_unified_editor_reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.user_id = 'zz-unified-editor-actor' AND NEW.action = 'DISCOUNT_OFFER_DRAFT_SAVED' THEN
      RAISE EXCEPTION 'fixture audit failure'; END IF; RETURN NEW; END $$`);
    await pool!.query("CREATE TRIGGER zz_unified_editor_reject_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION zz_unified_editor_reject_audit()");
    const requestKey = randomUUID();
    try {
      await expect(saveDiscountConfiguration({ offerId: created.id, requestKey, expectedOfferVersion: created.version,
        expectedDraftVersion: created.draftVersion, configuration: configuration() }, actor)).rejects.toThrow();
      const after = await getDiscountEditorDetail(created.id, actor);
      expect(after.draftVersion).toBe(before.draftVersion);
      expect(after.draftConfiguration).toEqual(before.draftConfiguration);
      expect((await pool!.query("SELECT count(*)::int AS count FROM discount_admin_request WHERE actor_identity = $1 AND request_key = $2", [actor, requestKey])).rows[0].count).toBe(0);
    } finally {
      await pool!.query("DROP TRIGGER zz_unified_editor_reject_audit ON audit_log");
      await pool!.query("DROP FUNCTION zz_unified_editor_reject_audit()");
    }
  });

  it("menyimpan potongan 15% dan kuota 200 bersama tanpa mengubah live 10%/100", async () => {
    const created = await create();
    const saved = await saveDiscountOfferDraft({
      offerId: created.id, expectedOfferVersion: created.version, expectedDraftVersion: created.draftVersion,
      terms: { name: "Promo 10%", currency: "IDR", minSubtotal: "0", benefit: { kind: "percentage_goods", paramsVersion: 1, rate: "10", capAmount: null } },
    }, actor);
    const policy = (await setDiscountOfferPolicy({ offerId: created.id, requestKey: randomUUID(), expectedOfferVersion: saved.version,
      expectedPolicyVersion: saved.policyVersion, quotaCount: 100, budgetAmount: null, perClientLimit: 1 }, actor)).data;
    const review = await reviewDiscountOffer({ offerId: created.id, expectedOfferVersion: policy.version, expectedDraftVersion: policy.draftVersion }, actor);
    const live = (await publishDiscountOffer({ offerId: created.id, requestKey: randomUUID(), expectedOfferVersion: review.offerVersion,
      expectedDraftVersion: review.draftVersion, expectedPolicyVersion: review.policyVersion, reviewFingerprint: review.fingerprint }, actor)).data;
    const result = await saveDiscountConfiguration({ offerId: created.id, requestKey: randomUUID(), expectedOfferVersion: live.version,
      expectedDraftVersion: live.draftVersion, configuration: configuration() }, actor);
    expect(result.draftConfiguration).toEqual(configuration());
    expect(result.draftVersion).toBe(live.draftVersion + 1);
    expect(result.policyVersion).toBe(live.policyVersion);
    const reloaded = await getDiscountEditorDetail(created.id, actor);
    expect(reloaded.draftConfiguration).toEqual(configuration());
    const current = await getDiscountOfferDetail(created.id, actor);
    if (!current) throw new Error("Diskon published harus tetap tersedia");
    expect(current.liveRevision?.benefit?.rate).toBe("10");
    expect(current.quotaCount).toBe(100);
    expect(current.perClientLimit).toBe(1);
  });
});

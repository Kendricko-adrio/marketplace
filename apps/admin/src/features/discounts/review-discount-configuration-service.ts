import { createHash } from "node:crypto";
import { validateDiscountDraftForPublish, type DiscountDraftIssue } from "@marketplace/db/src/discount-draft";
import { DiscountAdministrationError, classifyCapacityChange, requireActiveContract } from "@/lib/discounts-administration";
import { hasGlobalGrant } from "@/lib/admin-command";
import { createModuleLogger } from "@/lib/logger";
import { assertDiscountConfigurationAccess } from "./discount-configuration-policy";
import { withLockedDiscountConfiguration, type DiscountConfigurationSession } from "./discount-configuration-repository";
import type { DiscountReview, DiscountConfigurationChangeSet } from "./discount-editor-contracts";

const log = createModuleLogger("discount-configuration-review");

/** Dibaca ulang di bawah Offer lock saat review dan publish; usage tidak dipercaya dari review lama. */
export async function buildDiscountConfigurationReview(session: DiscountConfigurationSession): Promise<DiscountReview> {
  const detail = session.detail;
  const configuration = detail.draftConfiguration;
  const issues: DiscountDraftIssue[] = validateDiscountDraftForPublish(configuration);
  if (!detail.draftRevision) issues.push({ path: "", message: "Tidak ada draft untuk dipublish" });
  const before = session.liveConfiguration;
  const capacity = configuration.capacity;
  if (capacity.perClientLimit !== null) {
    const change = classifyCapacityChange({ quotaCount: detail.quotaCount, budgetAmount: detail.budgetAmount, perClientLimit: detail.perClientLimit }, {
      ...capacity, perClientLimit: capacity.perClientLimit,
    });
    if (change.direction === "enlarge" && (!hasGlobalGrant(session.actor, "discount_capacity", "view") || !hasGlobalGrant(session.actor, "discount_capacity", "edit"))) {
      issues.push({ path: "capacity", message: "Anda tidak memiliki izin untuk menambah batas penggunaan. Hubungi admin yang berwenang." });
    }
  }
  const commitment = await session.inspectCommitments();
  if (commitment.drift) issues.push({ path: "capacity", message: "Pemakaian tidak sesuai ledger. Hubungi admin untuk pemeriksaan." });
  const usedCount = (detail.usage?.reservedCount ?? 0) + (detail.usage?.consumedCount ?? 0);
  const usedAmount = BigInt(detail.usage?.reservedAmount ?? "0") + BigInt(detail.usage?.consumedAmount ?? "0");
  if (capacity.quotaCount !== null && capacity.quotaCount < usedCount) {
    issues.push({ path: "capacity.quotaCount", message: "Kuota tidak boleh kurang dari pemakaian dan reservasi saat ini" });
  }
  if (capacity.budgetAmount !== null && BigInt(capacity.budgetAmount) < usedAmount) {
    issues.push({ path: "capacity.budgetAmount", message: "Budget tidak boleh kurang dari pemakaian dan reservasi saat ini" });
  }
  if (capacity.perClientLimit !== null && capacity.perClientLimit < commitment.maxClientCommitment) {
    issues.push({ path: "capacity.perClientLimit", message: "Batas per customer tidak boleh kurang dari komitmen akun saat ini" });
  }
  if (detail.activationKind !== "manual_only" && (configuration.codeChanges.proposedCodes.length || configuration.codeChanges.states.length)) {
    issues.push({ path: "codeChanges", message: "Kupon publik tidak mempunyai kode promo" });
  }
  for (const index of commitment.conflictingProposalIndexes) {
    issues.push({ path: `codeChanges.proposedCodes.${index}`, message: "Kode sudah digunakan. Pilih kode lain." });
  }
  for (const [index, change] of configuration.codeChanges.states.entries()) {
    const code = detail.codes.find((row) => row.id === change.codeId);
    if (!code || code.version !== change.expectedCodeVersion || (code.state === "archived" && change.state !== "archived")) {
      issues.push({ path: `codeChanges.states.${index}`, message: "Status kode berubah atau kode sudah diarsipkan. Muat versi terbaru." });
    }
  }
  const stateAfter = detail.state === "draft" ? "enabled" : detail.state;
  const fingerprint = createHash("sha256").update(JSON.stringify({
    offerId: detail.id, offerVersion: detail.version, draftVersion: detail.draftVersion, policyVersion: detail.policyVersion,
    liveRevisionId: detail.currentRevisionId, draftRevisionId: detail.draftRevision?.id ?? null, stateAfter, configuration,
  })).digest("hex");
  const changes: DiscountConfigurationChangeSet[] = [];
  for (const path of ["name", "minSubtotal", "startAt", "endAt", "benefit", "capacity", "codeChanges"] as const) {
    if (!detail.liveRevision || JSON.stringify(before[path]) !== JSON.stringify(configuration[path])) changes.push({ path, before: detail.liveRevision ? before[path] : null, after: configuration[path] });
  }
  const warnings: string[] = [];
  if (stateAfter === "paused") warnings.push("Diskon tetap dijeda setelah publish");
  if (configuration.endAt && Date.parse(configuration.endAt) <= Date.now()) warnings.push("Jadwal diskon sudah berakhir");
  const targetedStates = new Map(configuration.codeChanges.states.map((change) => [change.codeId, change.state]));
  if (detail.activationKind === "manual_only" && !configuration.codeChanges.proposedCodes.length && !detail.codes.some((code) => (targetedStates.get(code.id) ?? code.state) === "active")) {
    warnings.push("Belum ada kode aktif; customer belum dapat memakai promo ini");
  }
  return { offerId: detail.id, offerVersion: detail.version, draftVersion: detail.draftVersion, policyVersion: detail.policyVersion,
    fingerprint, stateAfter, configuration, changes, issues, warnings };
}

export async function reviewDiscountConfiguration(
  input: { offerId: string; expectedOfferVersion: number; expectedDraftVersion: number },
  actorUserId: string,
): Promise<DiscountReview> {
  try {
    await requireActiveContract();
    const review = await withLockedDiscountConfiguration({ offerId: input.offerId, actorUserId }, async (session) => {
      await assertDiscountConfigurationAccess(session, "review");
      if (session.detail.version !== input.expectedOfferVersion || session.detail.draftVersion !== input.expectedDraftVersion) {
        throw new DiscountAdministrationError(409, "STALE_REVISION", "Diskon telah diubah pengguna lain. Muat versi terbaru sebelum melanjutkan.");
      }
      return buildDiscountConfigurationReview(session);
    });
    log.info(`Review konfigurasi diskon ${review.offerId} selesai (${review.issues.length} masalah)`);
    return review;
  } catch (error) {
    log.error("Review konfigurasi diskon gagal");
    throw error;
  }
}

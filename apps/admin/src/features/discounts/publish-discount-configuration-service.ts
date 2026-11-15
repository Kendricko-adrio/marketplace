import { createHash } from "node:crypto";
import { DiscountAdministrationError, classifyCapacityChange, requireActiveContract, requireDiscountEditor } from "@/lib/discounts-administration";
import { createModuleLogger } from "@/lib/logger";
import { assertDiscountConfigurationAccess } from "./discount-configuration-policy";
import { withLockedDiscountConfiguration } from "./discount-configuration-repository";
import { buildDiscountConfigurationReview } from "./review-discount-configuration-service";
import type { PublishDiscountConfigurationInput, PublishDiscountConfigurationResult } from "./discount-editor-contracts";

const log = createModuleLogger("discount-configuration-publish");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function publishDiscountConfiguration(
  input: PublishDiscountConfigurationInput,
  actorUserId: string,
): Promise<PublishDiscountConfigurationResult> {
  try {
    if (!UUID.test(input.requestKey) || !UUID.test(input.offerId) || !/^[a-f0-9]{64}$/.test(input.reviewFingerprint) ||
      [input.expectedOfferVersion, input.expectedDraftVersion, input.expectedPolicyVersion].some((version) => !Number.isInteger(version) || version < 1)) {
      throw new DiscountAdministrationError(400, "INPUT_INVALID", "Request key atau versi review tidak valid");
    }
    const fingerprint = createHash("sha256").update(JSON.stringify({
      action: "publish_configuration", offerId: input.offerId, expectedOfferVersion: input.expectedOfferVersion,
      expectedDraftVersion: input.expectedDraftVersion, expectedPolicyVersion: input.expectedPolicyVersion, reviewFingerprint: input.reviewFingerprint,
    })).digest("hex");
    await requireActiveContract();
    const result = await withLockedDiscountConfiguration({ offerId: input.offerId, actorUserId, requestKey: input.requestKey }, async (session) => {
      requireDiscountEditor(session.actor);
      if (session.receipt) {
        if (session.receipt.action !== "publish_configuration" || session.receipt.targetId !== input.offerId || session.receipt.fingerprint !== fingerprint) {
          throw new DiscountAdministrationError(409, "REQUEST_KEY_CONFLICT", "Request key sudah digunakan untuk perubahan lain");
        }
        return { data: session.detail, replayed: true };
      }
      await assertDiscountConfigurationAccess(session, "publish");
      const detail = session.detail;
      if (detail.version !== input.expectedOfferVersion || detail.draftVersion !== input.expectedDraftVersion || detail.policyVersion !== input.expectedPolicyVersion) {
        throw new DiscountAdministrationError(409, "STALE_REVISION", "Diskon telah diubah pengguna lain. Muat versi terbaru sebelum melanjutkan.");
      }
      const review = await buildDiscountConfigurationReview(session);
      if (review.fingerprint !== input.reviewFingerprint) {
        throw new DiscountAdministrationError(409, "STALE_REVISION", "Draft berubah setelah review. Periksa ulang sebelum publish.");
      }
      if (review.issues.length) {
        throw new DiscountAdministrationError(409, "OFFER_NOT_PUBLISHABLE", "Diskon belum dipublish. Periksa bagian yang ditandai.", review.issues);
      }
      const capacity = review.configuration.capacity;
      if (capacity.perClientLimit === null) throw new DiscountAdministrationError(409, "OFFER_NOT_PUBLISHABLE", "Isi batas pemakaian per customer");
      const change = classifyCapacityChange({ quotaCount: detail.quotaCount, budgetAmount: detail.budgetAmount, perClientLimit: detail.perClientLimit }, {
        ...capacity, perClientLimit: capacity.perClientLimit,
      });
      const data = await session.publish(review.configuration, review.stateAfter, change.direction !== "same");
      await session.recordReceipt(input.requestKey, fingerprint, data, "publish_configuration");
      return { data, replayed: false };
    });
    log.info(`Konfigurasi diskon ${result.data.id} dipublish (replay ${result.replayed})`);
    return result;
  } catch (error) {
    log.error("Publish konfigurasi diskon gagal");
    throw error;
  }
}

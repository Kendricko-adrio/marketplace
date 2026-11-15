import { createHash } from "node:crypto";
import { parseDiscountDraftConfiguration } from "@marketplace/db/src/discount-draft";
import { DiscountAdministrationError, requireActiveContract } from "@/lib/discounts-administration";
import { createModuleLogger } from "@/lib/logger";
import { assertDiscountConfigurationAccess } from "./discount-configuration-policy";
import { withLockedDiscountConfiguration } from "./discount-configuration-repository";
import type { SaveDiscountConfigurationInput, DiscountEditorDetail } from "./discount-editor-contracts";

const log = createModuleLogger("discount-configuration-save");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Satu snapshot, satu transaksi; tidak ada perubahan projection live/kode/usage. */
export async function saveDiscountConfiguration(
  input: SaveDiscountConfigurationInput,
  actorUserId: string,
): Promise<DiscountEditorDetail> {
  try {
    if (!UUID.test(input.requestKey) || typeof input.offerId !== "string" || !UUID.test(input.offerId) ||
      !Number.isInteger(input.expectedOfferVersion) || input.expectedOfferVersion < 1 ||
      !Number.isInteger(input.expectedDraftVersion) || input.expectedDraftVersion < 1) {
      throw new DiscountAdministrationError(400, "INPUT_INVALID", "Request key dan versi diskon tidak valid");
    }
    const parsed = parseDiscountDraftConfiguration(input.configuration);
    if (!parsed.success) {
      throw new DiscountAdministrationError(400, "INPUT_INVALID", "Periksa bagian yang ditandai", parsed.issues);
    }
    const configuration = parsed.configuration;
    const fingerprint = createHash("sha256").update(JSON.stringify({
      action: "save_configuration", offerId: input.offerId,
      expectedOfferVersion: input.expectedOfferVersion, expectedDraftVersion: input.expectedDraftVersion,
      configuration,
    })).digest("hex");
    await requireActiveContract();
    const result = await withLockedDiscountConfiguration({
      offerId: input.offerId, actorUserId, requestKey: input.requestKey,
    }, async (session) => {
      await assertDiscountConfigurationAccess(session, "save");
      if (session.receipt) {
        if (session.receipt.action !== "save_configuration" || session.receipt.targetId !== input.offerId || session.receipt.fingerprint !== fingerprint) {
          throw new DiscountAdministrationError(409, "REQUEST_KEY_CONFLICT", "Request key sudah digunakan untuk perubahan lain");
        }
        return session.detail;
      }
      if (session.detail.version !== input.expectedOfferVersion || session.detail.draftVersion !== input.expectedDraftVersion) {
        throw new DiscountAdministrationError(409, "STALE_REVISION", "Diskon telah diubah pengguna lain. Muat versi terbaru sebelum melanjutkan.");
      }
      if (session.detail.activationKind !== "manual_only" && (configuration.codeChanges.proposedCodes.length || configuration.codeChanges.states.length)) {
        throw new DiscountAdministrationError(400, "CODE_NOT_SUPPORTED", "Kupon publik tidak mempunyai kode promo");
      }
      for (const change of configuration.codeChanges.states) {
        const code = session.detail.codes.find((row) => row.id === change.codeId);
        if (!code) throw new DiscountAdministrationError(400, "INPUT_INVALID", "Kode tidak dimiliki diskon ini");
        if (code.version !== change.expectedCodeVersion) throw new DiscountAdministrationError(409, "STALE_REVISION", "Status kode telah berubah. Muat versi terbaru.");
        if (code.state === "archived" && change.state !== "archived") {
          throw new DiscountAdministrationError(409, "CODE_ARCHIVED", "Kode yang diarsipkan tidak dapat diaktifkan kembali");
        }
      }
      const saved = await session.save(configuration);
      await session.recordReceipt(input.requestKey, fingerprint, saved);
      return saved;
    });
    log.info(`Draft konfigurasi diskon ${result.id} tersimpan pada versi ${result.draftVersion}`);
    return result;
  } catch (error) {
    // Jangan log thrown body, konfigurasi, fingerprint, atau literal kode.
    const code = error instanceof DiscountAdministrationError ? error.code : "UNEXPECTED";
    log.error(`Simpan draft konfigurasi diskon gagal (${code})`);
    throw error;
  }
}

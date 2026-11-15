import { DiscountAdministrationError, requireDiscountEditor } from "@/lib/discounts-administration";
import { hasGlobalGrant } from "@/lib/admin-command";
import type { DiscountConfigurationSession } from "./discount-configuration-repository";

/** Policy sudah dibaca ulang di transaksi dengan SHARE lock actor lalu role. */
export async function assertDiscountConfigurationAccess(
  session: DiscountConfigurationSession,
  operation: "save" | "review" | "publish",
): Promise<void> {
  requireDiscountEditor(session.actor);
  if (!["save", "review", "publish"].includes(operation)) {
    throw new DiscountAdministrationError(400, "INPUT_INVALID", "Operasi konfigurasi tidak didukung");
  }
  if (session.detail.state === "archived") {
    throw new DiscountAdministrationError(409, "OFFER_ARCHIVED", "Diskon diarsipkan dan tidak dapat diubah");
  }
  // Save hanya menyimpan proposal. Delta izin kapasitas dan komitmen dievaluasi
  // ulang pada review serta publish di dalam session transaksi yang sama.
}

export function canViewDiscountConfigurationLiterals(session: Pick<DiscountConfigurationSession, "actor">): boolean {
  return hasGlobalGrant(session.actor, "discounts", "view") && hasGlobalGrant(session.actor, "discounts", "edit");
}

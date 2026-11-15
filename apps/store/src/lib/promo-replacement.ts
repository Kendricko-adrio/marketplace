/**
 * Store seam — penggantian promo dan persetujuan terikat kandidat (ticket 08).
 *
 * Modul ini PURE: tidak membaca DB, tidak memanggil provider, dan tidak pernah
 * menjadi otoritas harga. Ia hanya membandingkan dua breakdown yang SUDAH
 * dihitung server (total final termasuk PPN/ongkir, bukan nominal benefit) dan
 * memeriksa apakah acknowledgement customer mengikat candidate fingerprint
 * yang benar. Dengan begitu:
 *
 * - dialog kenaikan hanya muncul saat total final benar-benar naik;
 * - total sama/turun langsung diganti tanpa dialog;
 * - `confirmed: true` bebas atau token milik kandidat/akun lain tidak pernah
 *   cukup untuk melewati persetujuan kenaikan atau `continue_without_promo`.
 */
import { parseMoney } from "@marketplace/db/src/discount-eligibility";
import type { CheckoutReviewPromo } from "./checkout-review";

/** Breakdown yang ditampilkan untuk satu pilihan promo. */
export interface PromoPricingView {
  promo: CheckoutReviewPromo;
  /** Total final yang ditampilkan (termasuk PPN dan ongkir). */
  total: string;
  /** Nominal diskon promo pada breakdown (bukan nominal benefit mentah). */
  discount: string;
}

export type PromoReplacementDirection = "increase" | "same" | "decrease";

export interface PromoReplacementComparison {
  direction: PromoReplacementDirection;
  previousTotal: string;
  candidateTotal: string;
  /** candidate − previous; `-` saat turun, `0` saat sama. */
  deltaTotal: string;
  previousDiscount: string;
  candidateDiscount: string;
  /** candidate − previous; negatif berarti diskon mengecil. */
  deltaDiscount: string;
}

export class PromoReplacementDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PromoReplacementDataError";
  }
}

function money(value: string, field: "total" | "diskon"): bigint {
  const parsed = parseMoney(value);
  if (parsed === null) {
    throw new PromoReplacementDataError(
      `Nilai ${field} pada breakdown promo tidak valid.`
    );
  }
  return parsed;
}

/** Format bigint signed sebagai decimal string tanpa leading zero. */
function signed(value: bigint): string {
  return value.toString();
}

/**
 * Membandingkan dua breakdown server untuk pilihan promo berbeda. Basis
 * perbandingan adalah TOTAL FINAL yang ditampilkan, sehingga Coupon yang lebih
 * kecil nominalnya tetapi mengubah PPN/ongkir tetap terdeteksi sebagai
 * kenaikan.
 */
export function comparePromoReplacement(
  previous: PromoPricingView,
  candidate: PromoPricingView
): PromoReplacementComparison {
  const previousTotal = money(previous.total, "total");
  const candidateTotal = money(candidate.total, "total");
  const previousDiscount = money(previous.discount, "diskon");
  const candidateDiscount = money(candidate.discount, "diskon");
  const deltaTotal = candidateTotal - previousTotal;
  return {
    direction:
      deltaTotal > BigInt(0)
        ? "increase"
        : deltaTotal < BigInt(0)
          ? "decrease"
          : "same",
    previousTotal: signed(previousTotal),
    candidateTotal: signed(candidateTotal),
    deltaTotal: signed(deltaTotal),
    previousDiscount: signed(previousDiscount),
    candidateDiscount: signed(candidateDiscount),
    deltaDiscount: signed(candidateDiscount - previousDiscount),
  };
}

/** Pilihan promo pada level request (identitas yang dikirim browser). */
export type PromoSelection =
  | { kind: "none" }
  | { kind: "public"; offerId: string }
  | { kind: "manual"; offerId: string; codeId: string };

/**
 * Proyeksi pilihan dari promo yang sudah dievaluasi. Channel manual membawa
 * codeId (bukan literal), sehingga nilai ini aman dikirim balik sebagai
 * "previous selection" dan diikat token.
 */
export function promoSelectionOf(promo: CheckoutReviewPromo): PromoSelection {
  if (promo.kind === "none") return { kind: "none" };
  if (promo.kind === "manual") {
    return { kind: "manual", offerId: promo.offerId, codeId: promo.codeId };
  }
  return { kind: "public", offerId: promo.offerId };
}

/** Status pilihan lama yang dikirim balik ke UI pada preview penggantian. */
export interface PromoReplacementPreviousView {
  status: "valid" | "invalid";
  promo: PromoSelection;
  /** Total final yang ditampilkan sebelumnya; null bila pilihan lama gugur. */
  total: string | null;
  reason?: string;
  message?: string;
}

export interface PromoReplacementState {
  previous: PromoReplacementPreviousView;
  candidate: { promo: PromoSelection; total: string };
  /** null bila pilihan lama sudah gugur (tidak ada total lama yang sah). */
  direction: PromoReplacementDirection | null;
  deltaTotal: string | null;
  requiresIncreaseConfirmation: boolean;
}

/** Acknowledgement yang boleh dikirim browser pada place-order. */
export interface PromoAcknowledgements {
  promoIncrease?: { candidateFingerprint: string };
  continueWithoutPromo?: { candidateFingerprint: string };
}

export type PromoAcknowledgementRequirement =
  | "none"
  | "promo_increase"
  | "continue_without_promo";

export type PromoAcknowledgementMissing = Exclude<
  PromoAcknowledgementRequirement,
  "none"
>;

export type PromoAcknowledgementDecision =
  | { ok: true }
  | { ok: false; missing: PromoAcknowledgementMissing };

/**
 * Persetujuan hanya sah bila (a) review token memang menandai persyaratan itu,
 * dan (b) acknowledgement menunjuk candidate fingerprint yang persis sama
 * dengan token. Fingerprint mengikat client + konteks + pilihan + total, jadi
 * token/acknowledgement akun atau kandidat lain selalu ditolak.
 */
export function evaluatePromoAcknowledgements(input: {
  candidateFingerprint: string;
  requirement: PromoAcknowledgementRequirement;
  acknowledgements?: PromoAcknowledgements;
}): PromoAcknowledgementDecision {
  if (input.requirement === "none") return { ok: true };
  if (!/^[a-f0-9]{64}$/.test(input.candidateFingerprint)) {
    return { ok: false, missing: input.requirement };
  }
  const binding =
    input.requirement === "promo_increase"
      ? input.acknowledgements?.promoIncrease
      : input.acknowledgements?.continueWithoutPromo;
  if (!binding) return { ok: false, missing: input.requirement };
  if (
    typeof binding.candidateFingerprint !== "string" ||
    !/^[a-f0-9]{64}$/.test(binding.candidateFingerprint) ||
    binding.candidateFingerprint !== input.candidateFingerprint
  ) {
    return { ok: false, missing: input.requirement };
  }
  return { ok: true };
}

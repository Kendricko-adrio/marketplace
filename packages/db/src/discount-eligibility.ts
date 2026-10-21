/**
 * Seam L — eligibility Offer publik fixed-goods (ticket 07, spec §5.1).
 *
 * Pure: tanpa DB/HTTP/config, tanpa mutasi usage. Fungsi ini menjawab "boleh
 * dipakai sekarang?" beserta reason aman dan nominal benefit yang AKAN
 * direservasi (sudah di-clip ke subtotal setelah Markdown). Keputusan kapasitas
 * final tetap diulang di transaksi place-order di bawah lock Offer; hasil di
 * sini hanya untuk picker/preview dan tidak pernah menjadi reservation.
 *
 * Urutan pemeriksaan mengikuti spec §5.1: state/activation, versi/kelengkapan
 * revision, waktu (start inklusif, end eksklusif), minimum belanja, verified
 * email, benefit positif, lalu kapasitas global/per-akun. Reason tidak
 * membocorkan kode/Offer lain.
 */

export const OFFER_ELIGIBILITY_REASONS = [
  "INPUT_INVALID",
  "OFFER_UNAVAILABLE",
  "WINDOW_CLOSED",
  "MINIMUM_NOT_MET",
  "EMAIL_VERIFICATION_REQUIRED",
  "BENEFIT_UNAVAILABLE",
  "CAPACITY_UNAVAILABLE",
] as const;

export type OfferEligibilityReason = (typeof OFFER_ELIGIBILITY_REASONS)[number];

export interface OfferEligibilityUsage {
  reservedCount: number;
  consumedCount: number;
  reservedAmount: string | number;
  consumedAmount: string | number;
}

export interface OfferEligibilityInput {
  /** Server clock; never from the browser payload. */
  now: Date;
  verifiedEmail: boolean;
  /** Subtotal setelah Markdown (sebelum kupon), decimal string/number exact. */
  subtotalAfterMarkdown: string | number;
  offer: {
    activationKind: string;
    state: string;
    /** Revision pointer ada dan sudah published (bukan draft). */
    revisionPublished: boolean;
    startAt: Date | null;
    endAt: Date | null;
    minSubtotal: string | number;
    quotaCount: number | null;
    budgetAmount: string | number | null;
    perClientLimit: number;
    benefit: {
      kind: string;
      paramsVersion: number;
      fixedAmount: string | number;
    } | null;
    usage: OfferEligibilityUsage;
    /** Null = belum pernah memakai Offer ini (nol). */
    clientUsage: OfferEligibilityUsage | null;
  };
}

export interface OfferEligibilityResult {
  eligible: boolean;
  reason: OfferEligibilityReason | null;
  /**
   * Nominal benefit aktual yang akan direservasi (min(fixed, subtotal)),
   * decimal string Rupiah utuh; null ketika tidak eligible.
   */
  benefitAmount: string | null;
}

const ZERO = BigInt(0);
const MAX_COUNT = 2147483647;
const MAX_MONEY = BigInt("9999999999999");

/** Pesan aman untuk customer; tidak mendiscovery kode/Offer lain. */
export function describeOfferEligibilityReason(
  reason: OfferEligibilityReason | null
): string {
  switch (reason) {
    case "OFFER_UNAVAILABLE":
      return "Promo ini sedang tidak tersedia.";
    case "WINDOW_CLOSED":
      return "Promo ini di luar periode berlaku.";
    case "MINIMUM_NOT_MET":
      return "Minimum belanja untuk promo ini belum terpenuhi.";
    case "EMAIL_VERIFICATION_REQUIRED":
      return "Verifikasi email akun Anda untuk memakai promo ini.";
    case "BENEFIT_UNAVAILABLE":
      return "Promo ini tidak dapat dipakai saat ini.";
    case "CAPACITY_UNAVAILABLE":
      return "Kuota promo ini sudah habis.";
    case "INPUT_INVALID":
    default:
      return "Promo ini tidak dapat diverifikasi.";
  }
}

export function evaluateOfferEligibility(
  input: OfferEligibilityInput
): OfferEligibilityResult {
  const ineligible = (reason: OfferEligibilityReason): OfferEligibilityResult => ({
    eligible: false,
    reason,
    benefitAmount: null,
  });

  if (!input || typeof input !== "object" || !(input.now instanceof Date) ||
      !Number.isFinite(input.now.getTime())) {
    return ineligible("INPUT_INVALID");
  }
  const subtotal = parseMoney(input.subtotalAfterMarkdown);
  const minSubtotal = parseMoney(input.offer?.minSubtotal);
  if (subtotal === null || minSubtotal === null) return ineligible("INPUT_INVALID");

  // 1. Discovery: publik, enabled, revision published. Draft/paused/archived
  // dan manual-only tidak pernah bisa dipakai lewat jalur publik.
  if (input.offer.activationKind !== "public" || input.offer.state !== "enabled" ||
      input.offer.revisionPublished !== true) {
    return ineligible("OFFER_UNAVAILABLE");
  }

  // 2. Waktu server: start inklusif, end eksklusif. Batas null = tanpa batas.
  if (input.offer.startAt != null && input.now.getTime() < input.offer.startAt.getTime()) {
    return ineligible("WINDOW_CLOSED");
  }
  if (input.offer.endAt != null && input.now.getTime() >= input.offer.endAt.getTime()) {
    return ineligible("WINDOW_CLOSED");
  }

  // 3. Minimum belanja memakai subtotal SETELAH Markdown, sebelum kupon/pajak.
  if (subtotal < minSubtotal) return ineligible("MINIMUM_NOT_MET");

  // 4. Verified email akun wajib untuk Offer; contactEmail order bukan pengganti.
  if (input.verifiedEmail !== true) return ineligible("EMAIL_VERIFICATION_REQUIRED");

  // 5. Benefit harus fixed_goods paramsVersion1 dengan nominal positif valid.
  const benefit = input.offer.benefit;
  if (!benefit || benefit.kind !== "fixed_goods" || benefit.paramsVersion !== 1) {
    return ineligible("BENEFIT_UNAVAILABLE");
  }
  const fixedAmount = parseMoney(benefit.fixedAmount);
  if (fixedAmount === null || fixedAmount <= ZERO) return ineligible("BENEFIT_UNAVAILABLE");

  // 6. Nominal aktual = min(fixed, subtotal). Clip yang membuatnya 0 (subtotal0)
  // tidak pernah menjadi reservation/usage.
  const benefitAmount = fixedAmount < subtotal ? fixedAmount : subtotal;
  if (benefitAmount <= ZERO) return ineligible("BENEFIT_UNAVAILABLE");

  // 7. Jatah akun: reserved + consumed + 1 tidak boleh melebihi limit.
  // Released TIDAK dihitung (kapasitasnya sudah dikembalikan), tetapi baris
  // redemption-nya tetap retained sebagai histori.
  const perClientLimit = input.offer.perClientLimit;
  if (!Number.isSafeInteger(perClientLimit) || perClientLimit < 1 ||
      perClientLimit > MAX_COUNT) {
    return ineligible("INPUT_INVALID");
  }
  const clientCount = countOf(input.offer.clientUsage);
  if (clientCount === null) return ineligible("INPUT_INVALID");
  if (clientCount + 1 > perClientLimit) return ineligible("CAPACITY_UNAVAILABLE");

  // 8. Kuota global dan budget (pakai nominal aktual, bukan nominal mentah):
  // sisa budget yang lebih kecil dari benefit aktual menolak seluruh pemakaian,
  // bukan memperkecil diskon diam-diam.
  const usage = usageOf(input.offer.usage);
  if (usage === null) return ineligible("INPUT_INVALID");
  if (input.offer.quotaCount != null) {
    if (!Number.isSafeInteger(input.offer.quotaCount) || input.offer.quotaCount < 1 ||
        input.offer.quotaCount > MAX_COUNT) {
      return ineligible("INPUT_INVALID");
    }
    if (usage.count + 1 > input.offer.quotaCount) return ineligible("CAPACITY_UNAVAILABLE");
  }
  if (input.offer.budgetAmount != null) {
    const budget = parseMoney(input.offer.budgetAmount);
    if (budget === null || budget < ZERO) return ineligible("INPUT_INVALID");
    if (usage.amount + benefitAmount > budget) return ineligible("CAPACITY_UNAVAILABLE");
  }

  return { eligible: true, reason: null, benefitAmount: benefitAmount.toString() };
}

interface UsageTotals {
  count: number;
  amount: bigint;
}

/** Counts reserved+consumed; null when a counter is not a valid bounds value. */
function countOf(usage: OfferEligibilityUsage | null): number | null {
  if (usage == null) return 0;
  const reserved = usage.reservedCount;
  const consumed = usage.consumedCount;
  if (!Number.isSafeInteger(reserved) || !Number.isSafeInteger(consumed) ||
      reserved < 0 || consumed < 0 || reserved > MAX_COUNT || consumed > MAX_COUNT ||
      reserved + consumed > MAX_COUNT) {
    return null;
  }
  return reserved + consumed;
}

function usageOf(usage: OfferEligibilityUsage): UsageTotals | null {
  const count = countOf(usage);
  if (count === null) return null;
  const reserved = parseMoney(usage.reservedAmount);
  const consumed = parseMoney(usage.consumedAmount);
  if (reserved === null || consumed === null) return null;
  const amount = reserved + consumed;
  if (amount > MAX_MONEY) return null;
  return { count, amount };
}

/**
 * Exact non-negative whole-Rupiah. Accepts the DB scale2 form ("25000.00") and
 * plain integers; a non-zero fraction, sign, exponent or separator is invalid.
 */
export function parseMoney(value: unknown): bigint | null {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) return null;
    const amount = BigInt(value);
    return amount <= MAX_MONEY ? amount : null;
  }
  if (typeof value !== "string") return null;
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) return null;
  if (match[2] !== undefined && !/^0+$/.test(match[2])) return null;
  const amount = BigInt(match[1]);
  return amount <= MAX_MONEY ? amount : null;
}

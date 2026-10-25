/**
 * Store seam — evaluasi satu Offer publik terpilih (ticket 07).
 *
 * READ ONLY. Dipakai preview untuk menampilkan breakdown dan place-order untuk
 * memvalidasi ulang kandidat. Di place-order, pemanggilan yang mengikat
 * keputusan adalah yang dijalankan DI DALAM transaksi di bawah lock Offer
 * (`SELECT ... FOR UPDATE`), sehingga hasil preview tidak pernah menjadi izin
 * reservasi. Reason aman tidak mendiscovery Offer lain.
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  discountBenefits,
  discountClientUsage,
  discountCodes,
  discountOfferRevisions,
  discountOffers,
  discountOfferUsage,
} from "@/db";
import { canonicalizePromoCode } from "@marketplace/db/src/discount-code";
import {
  describeOfferEligibilityReason,
  evaluateOfferEligibility,
  parseMoney,
  type OfferEligibilityReason,
} from "@marketplace/db/src/discount-eligibility";
import type { OfferBenefitInput } from "@marketplace/db/src/discount-pricing";

type Database = typeof db;

export interface PublicOfferCandidate {
  offerId: string;
  offerName: string;
  /** Jalur aktivasi yang dipakai (identitas tetap per Offer). */
  activationKind: "public" | "manual_only";
  /** NULL untuk Coupon publik; code_id untuk Manual Promo Code. */
  codeId: string | null;
  revisionId: string;
  benefitId: string;
  policyVersion: number;
  /**
   * Bentuk benefit yang dievaluasi (fixed nominal, percentage rate+cap, atau
   * cap subsidi ongkir). Snapshot pricing dihitung dari bentuk ini, bukan dari
   * nominal yang sudah dibulatkan, sehingga rate/cap tidak hilang di
   * order/intent.
   */
  benefit: OfferBenefitInput;
  /** Nominal aktual sekali per order (floor/clip/cap); yang direservasi. */
  benefitAmount: string;
  minSubtotal: string;
  startAt: Date | null;
  endAt: Date | null;
}

export type SelectedOfferEvaluation =
  | { ok: true; candidate: PublicOfferCandidate }
  | { ok: false; reason: OfferEligibilityReason; message: string };

export interface SelectedOfferInput {
  offerId: string;
  clientId: string;
  verifiedEmail: boolean;
  subtotalAfterMarkdown: string;
  /** Konteks fulfillment; shipping hanya eligible untuk delivery berongkir. */
  fulfillmentMethod?: "pickup" | "delivery";
  shippingBeforeSubsidy?: string;
  now?: Date;
  /** Default `public`; `manual` hanya untuk kode yang sudah resolve. */
  channel?: "public" | "manual";
  /** Baris kode canonical yang diklaim customer (wajib untuk channel manual). */
  codeId?: string | null;
}

/**
 * Loads the current published revision/benefit/usage of one Offer and evaluates
 * eligibility. An unknown/inactive Offer returns the SAME safe reason as a
 * paused one (no existence leak). Never writes.
 *
 * Channel manual memakai engine/kapasitas yang SAMA: satu-satunya tambahan
 * adalah bukti bahwa baris kode canonical itu milik Offer ini dan masih aktif.
 * Kode unknown/nonaktif/arsip/milik Offer lain selalu jatuh ke reason aman
 * `OFFER_UNAVAILABLE` — tidak ada code discovery dari perbedaan pesan.
 */
export async function evaluateSelectedOffer(
  input: SelectedOfferInput,
  database: Database = db
): Promise<SelectedOfferEvaluation> {
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) {
    return ineligible("INPUT_INVALID");
  }
  const channel = input.channel ?? "public";
  if (channel === "manual") {
    if (typeof input.codeId !== "string" || input.codeId.length === 0) {
      return ineligible("OFFER_UNAVAILABLE");
    }
    const [codeRow] = await database
      .select({
        id: discountCodes.id,
        offerId: discountCodes.offerId,
        state: discountCodes.state,
      })
      .from(discountCodes)
      .where(eq(discountCodes.id, input.codeId))
      .limit(1);
    if (!codeRow || codeRow.state !== "active" || codeRow.offerId !== input.offerId) {
      return ineligible("OFFER_UNAVAILABLE");
    }
  }

  const [row] = await database
    .select({
      offerId: discountOffers.id,
      state: discountOffers.state,
      activationKind: discountOffers.activationKind,
      quotaCount: discountOffers.quotaCount,
      budgetAmount: discountOffers.budgetAmount,
      perClientLimit: discountOffers.perClientLimit,
      policyVersion: discountOffers.policyVersion,
      revisionId: discountOfferRevisions.id,
      name: discountOfferRevisions.name,
      minSubtotal: discountOfferRevisions.minSubtotal,
      startAt: discountOfferRevisions.startAt,
      endAt: discountOfferRevisions.endAt,
      publishedAt: discountOfferRevisions.publishedAt,
      benefitId: discountBenefits.id,
      benefitKind: discountBenefits.kind,
      paramsVersion: discountBenefits.paramsVersion,
      fixedAmount: discountBenefits.fixedAmount,
      rate: discountBenefits.rate,
      capAmount: discountBenefits.capAmount,
      reservedCount: discountOfferUsage.reservedCount,
      consumedCount: discountOfferUsage.consumedCount,
      reservedAmount: discountOfferUsage.reservedAmount,
      consumedAmount: discountOfferUsage.consumedAmount,
    })
    .from(discountOffers)
    .innerJoin(
      discountOfferRevisions,
      and(
        eq(discountOfferRevisions.id, discountOffers.currentRevisionId),
        eq(discountOfferRevisions.offerId, discountOffers.id)
      )
    )
    .innerJoin(
      discountBenefits,
      eq(discountBenefits.revisionId, discountOfferRevisions.id)
    )
    .innerJoin(discountOfferUsage, eq(discountOfferUsage.offerId, discountOffers.id))
    .where(eq(discountOffers.id, input.offerId))
    .limit(1);

  if (!row) return ineligible("OFFER_UNAVAILABLE");

  const [clientUsage] = await database
    .select({
      reservedCount: discountClientUsage.reservedCount,
      consumedCount: discountClientUsage.consumedCount,
      reservedAmount: discountClientUsage.reservedAmount,
      consumedAmount: discountClientUsage.consumedAmount,
    })
    .from(discountClientUsage)
    .where(
      and(
        eq(discountClientUsage.offerId, input.offerId),
        eq(discountClientUsage.clientId, input.clientId)
      )
    )
    .limit(1);

  const minSubtotal = moneyOrZero(row.minSubtotal);
  // Payload mentah ke evaluator: kind/versi/precision tak didukung gagal di sana.
  const benefitPayload = benefitPayloadOf(row);
  const eligibility = evaluateOfferEligibility({
    now,
    verifiedEmail: input.verifiedEmail,
    channel,
    manualCodeAccepted: channel === "manual",
    subtotalAfterMarkdown: input.subtotalAfterMarkdown,
    fulfillmentMethod: input.fulfillmentMethod ?? "pickup",
    shippingBeforeSubsidy: input.shippingBeforeSubsidy ?? "0",
    offer: {
      activationKind: row.activationKind,
      state: row.state,
      revisionPublished: row.publishedAt != null,
      startAt: row.startAt,
      endAt: row.endAt,
      minSubtotal,
      quotaCount: row.quotaCount,
      budgetAmount: moneyOrZero(row.budgetAmount),
      perClientLimit: row.perClientLimit,
      benefit: benefitPayload,
      usage: {
        reservedCount: row.reservedCount,
        consumedCount: row.consumedCount,
        reservedAmount: row.reservedAmount,
        consumedAmount: row.consumedAmount,
      },
      clientUsage: clientUsage ?? null,
    },
  });

  if (!eligibility.eligible || !eligibility.benefitAmount) {
    return ineligible(eligibility.reason ?? "BENEFIT_UNAVAILABLE");
  }
  // Bentuk tervalidasi; sampai di sini eligibility sudah membuktikan payload sah.
  const benefit = benefitTermsOf(row);

  return {
    ok: true,
    candidate: {
      offerId: row.offerId,
      offerName: row.name ?? "",
      activationKind: row.activationKind === "manual_only" ? "manual_only" : "public",
      codeId: channel === "manual" ? (input.codeId as string) : null,
      revisionId: row.revisionId,
      benefitId: row.benefitId,
      policyVersion: row.policyVersion,
      benefit,
      benefitAmount: eligibility.benefitAmount,
      minSubtotal,
      startAt: row.startAt,
      endAt: row.endAt,
    },
  };
}

/** Wrapper kompatibilitas: Coupon publik tidak pernah membawa kode. */
export async function evaluateSelectedPublicOffer(
  input: SelectedOfferInput,
  database: Database = db
): Promise<SelectedOfferEvaluation> {
  return evaluateSelectedOffer({ ...input, channel: "public", codeId: null }, database);
}

export interface ResolveManualCodeInput {
  /** Literal yang diketik customer; dinormalisasi di sini. */
  code: unknown;
  clientId: string;
  verifiedEmail: boolean;
  subtotalAfterMarkdown: string;
  fulfillmentMethod?: "pickup" | "delivery";
  shippingBeforeSubsidy?: string;
  now?: Date;
}

/**
 * Resolve satu Manual Promo Code canonical menjadi evaluasi Offer. Unknown,
 * nonaktif, arsip, dan literal tidak sah semuanya reason aman yang sama.
 * READ ONLY — tidak pernah membuat reservation/usage.
 */
export async function evaluateSelectedManualCode(
  input: ResolveManualCodeInput,
  database: Database = db
): Promise<SelectedOfferEvaluation> {
  const canonical = canonicalizePromoCode(input.code);
  if (canonical === null) return ineligible("OFFER_UNAVAILABLE");
  const [row] = await database
    .select({
      id: discountCodes.id,
      offerId: discountCodes.offerId,
      state: discountCodes.state,
    })
    .from(discountCodes)
    .where(eq(discountCodes.canonicalCode, canonical))
    .limit(1);
  if (!row || row.state !== "active") return ineligible("OFFER_UNAVAILABLE");
  return evaluateSelectedOffer(
    {
      offerId: row.offerId,
      clientId: input.clientId,
      verifiedEmail: input.verifiedEmail,
      subtotalAfterMarkdown: input.subtotalAfterMarkdown,
      fulfillmentMethod: input.fulfillmentMethod,
      shippingBeforeSubsidy: input.shippingBeforeSubsidy,
      now: input.now,
      channel: "manual",
      codeId: row.id,
    },
    database
  );
}

/** HTTP mapping from spec §5.4; safe message is the eligibility message. */
export function mapOfferReasonToHttp(reason: OfferEligibilityReason): {
  status: 403 | 409;
  code:
    | "PROMO_UNAVAILABLE"
    | "PROMO_INELIGIBLE"
    | "PROMO_CAPACITY_UNAVAILABLE"
    | "EMAIL_VERIFICATION_REQUIRED";
} {
  switch (reason) {
    case "EMAIL_VERIFICATION_REQUIRED":
      return { status: 403, code: "EMAIL_VERIFICATION_REQUIRED" };
    case "MINIMUM_NOT_MET":
    case "FULFILLMENT_NOT_ELIGIBLE":
      return { status: 409, code: "PROMO_INELIGIBLE" };
    case "CAPACITY_UNAVAILABLE":
      return { status: 409, code: "PROMO_CAPACITY_UNAVAILABLE" };
    default:
      return { status: 409, code: "PROMO_UNAVAILABLE" };
  }
}

export function offerReasonMessage(reason: OfferEligibilityReason): string {
  return describeOfferEligibilityReason(reason);
}

function ineligible(reason: OfferEligibilityReason): SelectedOfferEvaluation {
  return { ok: false, reason, message: describeOfferEligibilityReason(reason) };
}

function moneyOrZero(value: string | number | null | undefined): string {
  if (value == null) return "0";
  const parsed = parseMoney(value);
  return parsed === null ? "0" : parsed.toString();
}

/** `numeric(9,6)` → teks rate kanonik tanpa nol ekor. */
function normalizeRateText(value: string): string {
  const trimmed = value.trim();
  const dot = trimmed.indexOf(".");
  if (dot <= 0) return trimmed;
  const whole = trimmed.slice(0, dot);
  const fraction = trimmed.slice(dot + 1);
  if (!/^[0-9]+$/.test(whole) || !/^[0-9]+$/.test(fraction)) return trimmed;
  const normalizedFraction = fraction.replace(/0+$/, "");
  return normalizedFraction ? whole + "." + normalizedFraction : whole;
}

/**
 * Bentuk benefit tersimpan → payload evaluator bersama. Percentage yang tidak
 * membawa rate (data rusak) tetap dikirim null supaya evaluator menolak, bukan
 * di-default ke fixed.
 */
function benefitPayloadOf(row: {
  benefitKind: string;
  paramsVersion: number;
  fixedAmount: string | null;
  rate: string | null;
  capAmount: string | null;
}): {
  kind: string;
  paramsVersion: number;
  fixedAmount?: string | null;
  rate?: string | null;
  capAmount?: string | null;
} {
  if (row.benefitKind === "fixed_goods") {
    return {
      kind: row.benefitKind,
      paramsVersion: row.paramsVersion,
      fixedAmount: row.fixedAmount === null ? null : moneyOrZero(row.fixedAmount),
    };
  }
  if (row.benefitKind === "shipping") {
    return {
      kind: row.benefitKind,
      paramsVersion: row.paramsVersion,
      capAmount: row.capAmount === null ? null : moneyOrZero(row.capAmount),
    };
  }
  return {
    kind: row.benefitKind,
    paramsVersion: row.paramsVersion,
    rate: row.rate === null ? null : normalizeRateText(row.rate),
    capAmount: row.capAmount === null ? null : moneyOrZero(row.capAmount),
  };
}

/**
 * Bentuk benefit tervalidasi untuk pricing. Pemanggil hanya sampai sini setelah
 * eligibility sukses, jadi parsing ulang tidak pernah menjadi jalur default.
 */
function benefitTermsOf(row: {
  benefitKind: string;
  paramsVersion: number;
  fixedAmount: string | null;
  rate: string | null;
  capAmount: string | null;
}): OfferBenefitInput {
  if (row.benefitKind === "fixed_goods") {
    return {
      kind: "fixed_goods",
      paramsVersion: 1,
      fixedAmount: moneyOrZero(row.fixedAmount),
    };
  }
  if (row.benefitKind === "shipping") {
    return {
      kind: "shipping",
      paramsVersion: 1,
      capAmount: moneyOrZero(row.capAmount),
    };
  }
  return {
    kind: "percentage_goods",
    paramsVersion: 1,
    rate: normalizeRateText(row.rate ?? ""),
    capAmount: row.capAmount === null ? null : moneyOrZero(row.capAmount),
  };
}

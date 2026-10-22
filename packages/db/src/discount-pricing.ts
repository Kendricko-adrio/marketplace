/** Seam L — evaluasi pricing diskon goods sekali per order (`fixed_goods` atau
 * `percentage_goods`, ticket 06/10).
 *
 * Pure: tanpa DB/HTTP/config, tanpa mutasi usage, tanpa efek samping. Baseline
 * (source/effective/quantity/PPN rate/ongkir) tetap divalidasi oleh builder
 * `buildPricingSnapshot` existing, lalu benefit goods dihitung dari subtotal
 * SETELAH Markdown dan dialokasikan proporsional per whole line. Result akhir wajib
 * lolos `decodePricingSnapshot` sebelum dikembalikan, sehingga snapshot yang keluar
 * selalu bertipe+bounded dan konsisten secara internal.
 *
 * Dua bentuk benefit version1 yang didukung:
 *   - `fixed_goods`: nominal positif Rupiah utuh, `D = min(nominal, subtotal)`.
 *   - `percentage_goods`: rate `>0..100` sampai6 digit pecahan, cap opsional positif,
 *     `D = min(floor(subtotal × rate / 100), subtotal, cap)`.
 * Kind/versi/field/precision lain ditolak — tidak ada default ke fixed atau
 * pembulatan rate diam-diam. Shipping subsidy (ticket 11), kondisi, dan usage
 * bukan bagian kontrak versi ini.
 */
import {
  buildPricingSnapshot,
  decodePricingSnapshot,
  MAX_MONEY_RUPIAH,
  PricingContractError,
  type BuildPricingSnapshotInput,
  type PricingSnapshot,
  type PricingSnapshotLine,
} from "./versioned-pricing";

const RATE_SCALE_DIGITS = 6;
const RATE_SCALE = BigInt(10) ** BigInt(RATE_SCALE_DIGITS);
const HUNDRED = BigInt(100);
const ZERO = BigInt(0);
const ONE = BigInt(1);

const FIXED_AMOUNT_FIELDS = new Set<string>(["kind", "paramsVersion", "fixedAmount"]);
const PERCENTAGE_FIELDS = new Set<string>([
  "kind",
  "paramsVersion",
  "rate",
  "capAmount",
]);
const SHIPPING_FIELDS = new Set<string>(["kind", "paramsVersion", "capAmount"]);

export interface FixedGoodsBenefitInput {
  kind: "fixed_goods";
  paramsVersion: 1;
  /** Nominal positif tepat (whole Rupiah), sekali per order, di-clip ke subtotal. */
  fixedAmount: string | number;
}

export interface PercentageGoodsBenefitInput {
  kind: "percentage_goods";
  paramsVersion: 1;
  /** Rate >0..100, maksimal6 digit pecahan, tanpa separator/exponent. */
  rate: string | number;
  /** Cap Rupiah utuh positif opsional; NULL berarti tanpa cap. */
  capAmount: string | number | null;
}

export type GoodsBenefitInput = FixedGoodsBenefitInput | PercentageGoodsBenefitInput;

/**
 * Subsidi ongkir (ticket 11): cap Rupiah utuh positif, tanpa rate/nominal goods.
 * `S = min(shippingBeforeSubsidy, cap)`; hanya delivery dengan ongkir valid
 * positif, sisa hangus, dan tidak ada targeting kurir.
 */
export interface ShippingSubsidyBenefitInput {
  kind: "shipping";
  paramsVersion: 1;
  capAmount: string | number;
}

/** Satu benefit slot: goods atau shipping, tidak pernah keduanya. */
export type OfferBenefitInput = GoodsBenefitInput | ShippingSubsidyBenefitInput;

/** Benefit tervalidasi dalam bentuk exact (rate sudah di-scale 10^6). */
export type ParsedGoodsBenefit =
  | { kind: "fixed_goods"; fixedAmount: bigint }
  | {
      kind: "percentage_goods";
      ratePercent: string;
      rateScaled: bigint;
      capAmount: bigint | null;
    };

export type ParsedOfferBenefit =
  | ParsedGoodsBenefit
  | { kind: "shipping"; capAmount: bigint };

/** Input sama dengan baseline pricing, ditambah satu benefit yang sedang dievaluasi. */
export interface EvaluatePricingInput extends BuildPricingSnapshotInput {
  benefit: OfferBenefitInput;
}

/** Nilai uang keluar dari evaluator selalu whole Rupiah exact (decimal string). */
export function evaluatePricing(input: EvaluatePricingInput): PricingSnapshot {
  const benefit = parseOfferBenefit(input.benefit);
  const baseline = buildPricingSnapshot({
    fulfillmentMethod: input.fulfillmentMethod,
    ppnRatePercent: input.ppnRatePercent,
    lines: input.lines,
    shippingBeforeSubsidy: input.shippingBeforeSubsidy,
    providerQuotedShippingCost: input.providerQuotedShippingCost,
  });

  const subtotal = BigInt(baseline.subtotal);
  // Satu slot: kind shipping TIDAK memotong barang sama sekali. Nilai aktualnya
  // dihitung dari ongkir SEBELUM subsidi, bukan dari subtotal.
  const goodsDiscount = benefit.kind === "shipping"
    ? ZERO
    : goodsBenefitAmount(benefit, subtotal);
  const allocations = allocateGoodsDiscount(goodsDiscount, baseline.lines);
  const lines = baseline.lines.map((line, index) => {
    const effectiveLineAmount = BigInt(line.netLineAmount);
    const goodsDiscountAmount = allocations[index];
    return {
      ...line,
      goodsDiscountAmount: goodsDiscountAmount.toString(),
      netLineAmount: boundMoney(effectiveLineAmount - goodsDiscountAmount, `lines[${index}].netLineAmount`).toString(),
    };
  });

  const netGoods = boundMoney(subtotal - goodsDiscount, "netGoods");
  const rateScaled = parseCanonicalRateScaled(baseline.ppnRatePercent, "ppnRatePercent");
  const taxableBase = netGoods;
  const ppnAmount = boundMoney(ceilDiv(taxableBase * rateScaled, HUNDRED * RATE_SCALE), "ppnAmount");
  const shippingSubsidy = benefit.kind === "shipping"
    ? shippingSubsidyAmount(benefit, baseline)
    : ZERO;
  if (shippingSubsidy > ZERO && baseline.shippingSubsidy !== "0") {
    throw inputInvalid("shipping subsidy cannot be applied twice to the same quote");
  }
  const shippingCost = boundMoney(BigInt(baseline.shippingCost) - shippingSubsidy, "shippingCost");
  const merchantFunding = shippingSubsidy;
  const serviceFee = ZERO;
  const total = boundMoney(netGoods + ppnAmount + shippingCost + serviceFee, "total");
  const expectedProviderPayable = boundMoney(netGoods + shippingCost, "expectedProviderPayable");

  return decodePricingSnapshot({
    pricingContractVersion: baseline.pricingContractVersion,
    pricingEngineVersion: baseline.pricingEngineVersion,
    providerContractVersion: baseline.providerContractVersion,
    currency: baseline.currency,
    fulfillmentMethod: baseline.fulfillmentMethod,
    sourceGoodsSubtotal: baseline.sourceGoodsSubtotal,
    markdownTotal: baseline.markdownTotal,
    subtotal: baseline.subtotal,
    goodsDiscount: goodsDiscount.toString(),
    netGoods: netGoods.toString(),
    shippingBeforeSubsidy: baseline.shippingBeforeSubsidy,
    shippingSubsidy: shippingSubsidy.toString(),
    shippingCost: shippingCost.toString(),
    merchantFunding: merchantFunding.toString(),
    serviceFee: serviceFee.toString(),
    taxableBase: taxableBase.toString(),
    ppnRatePercent: baseline.ppnRatePercent,
    ppnAmount: ppnAmount.toString(),
    total: total.toString(),
    expectedProviderPayable: expectedProviderPayable.toString(),
    providerQuotedShippingCost: baseline.providerQuotedShippingCost,
    providerBilledShippingCost: baseline.providerBilledShippingCost,
    lines,
  } satisfies PricingSnapshot);
}

/** Alokasi goods diskon proporsional effective whole-line, floor + sisa largest remainder. */
function allocateGoodsDiscount(goodsDiscount: bigint, lines: readonly PricingSnapshotLine[]): bigint[] {
  const bases = lines.map((line) => BigInt(line.netLineAmount));
  const basisTotal = bases.reduce((sum, basis) => sum + basis, ZERO);
  const allocations = bases.map(() => ZERO);
  // Basis 0 (misal subtotal Rp0) tidak pernah menerima porsi; clip ke subtotal membuat
  // goodsDiscount 0 di kasus itu, jadi tidak ada pembagian dengan nol di bawah.
  if (goodsDiscount === ZERO || basisTotal === ZERO) return allocations;
  const remainders: { index: number; remainder: bigint; variantId: string }[] = [];
  let assigned = ZERO;
  bases.forEach((basis, index) => {
    if (basis === ZERO) return;
    const weighted = goodsDiscount * basis;
    const share = weighted / basisTotal;
    allocations[index] = share;
    assigned += share;
    remainders.push({ index, remainder: weighted % basisTotal, variantId: lines[index].variantId });
  });
  remainders.sort((left, right) => {
    if (left.remainder !== right.remainder) return left.remainder > right.remainder ? -1 : 1;
    if (left.variantId === right.variantId) return 0;
    return left.variantId < right.variantId ? -1 : 1;
  });
  let residual = goodsDiscount - assigned;
  for (let cursor = 0; residual > ZERO; cursor += 1) {
    allocations[remainders[cursor % remainders.length].index] += ONE;
    residual -= ONE;
  }
  return allocations;
}

/**
 * Runtime guard: hanya benefit goods version1 yang dikenal (`fixed_goods`,
 * `percentage_goods`). Setiap field/kind/versi/precision yang tidak sesuai
 * ditolak, bukan di-default ke fixed goods atau dibulatkan.
 */
export function parseGoodsBenefit(benefit: unknown): ParsedGoodsBenefit {
  const result = readGoodsBenefit(benefit);
  if (!result.ok) throw inputInvalid(result.message);
  return result.benefit;
}

/** Non-throwing variant untuk eligibility, yang memetakan bentuk tak didukung
 * menjadi reason aman alih-alih exception. */
export function tryParseGoodsBenefit(benefit: unknown): ParsedGoodsBenefit | null {
  const result = readGoodsBenefit(benefit);
  return result.ok ? result.benefit : null;
}

/**
 * Nominal benefit aktual untuk SATU slot apa pun. Goods memakai subtotal setelah
 * Markdown; shipping memakai ongkir sebelum subsidi dan hanya untuk delivery.
 * Ini satu-satunya rumus yang dipakai eligibility, simulasi admin, preview dan
 * place-order, sehingga nominal yang direservasi tidak pernah berbeda dari
 * snapshot pricing.
 */
export function offerBenefitAmount(
  benefit: ParsedOfferBenefit,
  input: {
    subtotal: bigint;
    fulfillmentMethod: "pickup" | "delivery";
    shippingBeforeSubsidy: string | number;
  }
): bigint {
  if (benefit.kind !== "shipping") {
    return goodsBenefitAmount(benefit, input.subtotal);
  }
  return shippingSubsidyAmount(benefit, {
    fulfillmentMethod: input.fulfillmentMethod,
    shippingBeforeSubsidy: String(input.shippingBeforeSubsidy),
  });
}

/** Nominal benefit exact sekali per order; `subtotal` sudah integer Rupiah. */
export function goodsBenefitAmount(
  benefit: ParsedGoodsBenefit,
  subtotal: bigint
): bigint {
  if (benefit.kind === "fixed_goods") {
    return benefit.fixedAmount < subtotal ? benefit.fixedAmount : subtotal;
  }
  // floor(subtotal × rate / 100) dengan rate exact 10^6 — tanpa binary float.
  const raw = (subtotal * benefit.rateScaled) / (HUNDRED * RATE_SCALE);
  let amount = raw < subtotal ? raw : subtotal;
  if (benefit.capAmount !== null && benefit.capAmount < amount) {
    amount = benefit.capAmount;
  }
  return amount;
}

/**
 * Runtime guard untuk SATU slot benefit: goods version1 atau subsidi ongkir
 * version1. Bentuk lain (kind/versi/field campuran) fail closed.
 */
export function parseOfferBenefit(benefit: unknown): ParsedOfferBenefit {
  const result = readOfferBenefit(benefit);
  if (!result.ok) throw inputInvalid(result.message);
  return result.benefit;
}

export function tryParseOfferBenefit(benefit: unknown): ParsedOfferBenefit | null {
  const result = readOfferBenefit(benefit);
  return result.ok ? result.benefit : null;
}

/**
 * Subsidi ongkir exact: hanya delivery dengan ongkir valid positif.
 * `S = min(shippingBeforeSubsidy, cap)`; pickup/ongkir0 tidak eligible dan sisa
 * ongkir yang melebihi cap hangus (tidak menjadi pembayaran/provider Rp0).
 */
export function shippingSubsidyAmount(
  benefit: Extract<ParsedOfferBenefit, { kind: "shipping" }>,
  baseline: Pick<PricingSnapshot, "fulfillmentMethod" | "shippingBeforeSubsidy">
): bigint {
  if (baseline.fulfillmentMethod !== "delivery") {
    throw inputInvalid("shipping subsidy is only available for delivery");
  }
  const shipping = BigInt(baseline.shippingBeforeSubsidy);
  if (shipping <= ZERO) {
    throw inputInvalid("shipping subsidy requires a positive shipping amount");
  }
  return benefit.capAmount < shipping ? benefit.capAmount : shipping;
}

type BenefitRead =
  | { ok: true; benefit: ParsedGoodsBenefit }
  | { ok: false; message: string };

type OfferBenefitRead =
  | { ok: true; benefit: ParsedOfferBenefit }
  | { ok: false; message: string };

function readOfferBenefit(benefit: unknown): OfferBenefitRead {
  if (isPlainObject(benefit) && benefit.kind === "shipping") {
    for (const key of Object.keys(benefit)) {
      if (!SHIPPING_FIELDS.has(key)) {
        return {
          ok: false,
          message: `benefit carries an unknown shipping field: ${key}`,
        };
      }
    }
    if (benefit.paramsVersion !== 1) {
      return {
        ok: false,
        message: "benefit.paramsVersion is unknown or unsupported",
      };
    }
    try {
      return {
        ok: true,
        benefit: {
          kind: "shipping",
          capAmount: parsePositiveFixedAmount(benefit.capAmount, "benefit.capAmount"),
        },
      };
    } catch (error) {
      return {
        ok: false,
        message:
          error instanceof Error ? error.message : "benefit.capAmount is invalid",
      };
    }
  }
  const goods = readGoodsBenefit(benefit);
  return goods.ok ? goods : goods;
}

function readGoodsBenefit(benefit: unknown): BenefitRead {
  if (!isPlainObject(benefit)) {
    return { ok: false, message: "benefit must be a goods benefit object" };
  }
  if (benefit.kind === "fixed_goods") {
    for (const key of Object.keys(benefit)) {
      if (!FIXED_AMOUNT_FIELDS.has(key)) {
        return {
          ok: false,
          message: `benefit carries an unknown fixed_goods field: ${key}`,
        };
      }
    }
    if (benefit.paramsVersion !== 1) {
      return {
        ok: false,
        message: "benefit.paramsVersion is unknown or unsupported",
      };
    }
    try {
      return {
        ok: true,
        benefit: {
          kind: "fixed_goods",
          fixedAmount: parsePositiveFixedAmount(
            benefit.fixedAmount,
            "benefit.fixedAmount"
          ),
        },
      };
    } catch (error) {
      return {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "benefit.fixedAmount is invalid",
      };
    }
  }
  if (benefit.kind === "percentage_goods") {
    for (const key of Object.keys(benefit)) {
      if (!PERCENTAGE_FIELDS.has(key)) {
        return {
          ok: false,
          message: `benefit carries an unknown percentage_goods field: ${key}`,
        };
      }
    }
    if (benefit.paramsVersion !== 1) {
      return {
        ok: false,
        message: "benefit.paramsVersion is unknown or unsupported",
      };
    }
    // `capAmount` wajib hadir (boleh NULL): field yang hilang bukan "tanpa cap"
    // implisit, supaya typo tidak diam-diam menjadi uncapped.
    if (!Object.prototype.hasOwnProperty.call(benefit, "capAmount")) {
      return {
        ok: false,
        message: "benefit.capAmount must be present (null when uncapped)",
      };
    }
    try {
      const { ratePercent, rateScaled } = parsePositivePercentageRate(
        benefit.rate,
        "benefit.rate"
      );
      const capAmount = parseOptionalPositiveCap(
        benefit.capAmount,
        "benefit.capAmount"
      );
      return {
        ok: true,
        benefit: { kind: "percentage_goods", ratePercent, rateScaled, capAmount },
      };
    } catch (error) {
      return {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "benefit percentage parameters are invalid",
      };
    }
  }
  return {
    ok: false,
    message:
      "benefit.kind must be fixed_goods or percentage_goods; other benefit kinds are not part of this pricing contract version",
  };
}

/** Rate persentase `>0..100`, maksimal6 digit pecahan, exact (bukan float). */
function parsePositivePercentageRate(
  value: unknown,
  field: string
): { ratePercent: string; rateScaled: bigint } {
  const text = typeof value === "number" ? String(value) : value;
  if (typeof text !== "string") throw inputInvalid(`${field} must be a decimal percentage`);
  const match = /^(\d+)(?:\.(\d{1,6}))?$/.exec(text.trim());
  if (!match) {
    throw inputInvalid(
      `${field} must be a decimal percentage with at most 6 fractional digits`
    );
  }
  const whole = BigInt(match[1]);
  const fraction = (match[2] ?? "").padEnd(RATE_SCALE_DIGITS, "0");
  const scaled = whole * RATE_SCALE + BigInt(fraction);
  if (scaled <= ZERO) throw inputInvalid(`${field} must be greater than 0`);
  if (scaled > HUNDRED * RATE_SCALE) throw inputInvalid(`${field} must not exceed 100`);
  const normalizedFraction = fraction.replace(/0+$/, "");
  const ratePercent = normalizedFraction
    ? `${whole.toString()}.${normalizedFraction}`
    : whole.toString();
  return { ratePercent, rateScaled: scaled };
}

function parseOptionalPositiveCap(value: unknown, field: string): bigint | null {
  if (value === null) return null;
  return parsePositiveFixedAmount(value, field);
}

function parsePositiveFixedAmount(value: unknown, field: string): bigint {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value <= 0) throw inputInvalid(`${field} must be an exact positive whole Rupiah amount`);
    return assertMoneyBound(BigInt(value), field);
  }
  if (typeof value !== "string") throw inputInvalid(`${field} must be an exact positive whole Rupiah decimal string`);
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) throw inputInvalid(`${field} must be an unsigned decimal Rupiah amount`);
  const fraction = match[2] ?? "";
  if (!/^0*$/.test(fraction)) throw inputInvalid(`${field} must not carry a Rupiah fraction`);
  const amount = BigInt(match[1]);
  if (amount <= ZERO) throw inputInvalid(`${field} must be a positive Rupiah amount`);
  return assertMoneyBound(amount, field);
}

/** Rate snapshot sudah kanonik (maks6 digit pecahan); dibaca ulang exact, bukan binary float. */
function parseCanonicalRateScaled(value: string, field: string): bigint {
  const match = /^(\d+)(?:\.(\d{1,6}))?$/.exec(value);
  if (!match) throw inputInvalid(`${field} must be a canonical decimal rate`);
  const fraction = (match[2] ?? "").padEnd(RATE_SCALE_DIGITS, "0");
  const scaled = BigInt(match[1]) * RATE_SCALE + BigInt(fraction);
  if (scaled > HUNDRED * RATE_SCALE) throw inputInvalid(`${field} must be between 0 and 100`);
  return scaled;
}

function assertMoneyBound(amount: bigint, field: string): bigint {
  if (amount <= ZERO || amount > MAX_MONEY_RUPIAH) throw inputInvalid(`${field} is outside the supported positive Rupiah range`);
  return amount;
}

function boundMoney(amount: bigint, field: string): bigint {
  if (amount < ZERO || amount > MAX_MONEY_RUPIAH) throw inputInvalid(`${field} is outside the supported Rupiah range`);
  return amount;
}

function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  if (numerator === ZERO) return ZERO;
  return (numerator + denominator - ONE) / denominator;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function inputInvalid(message: string): PricingContractError {
  return new PricingContractError("PRICING_INPUT_INVALID", message);
}

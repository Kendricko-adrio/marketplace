/** Seam L — evaluasi pricing diskon goods `fixed_goods` sekali per order.
 *
 * Pure: tanpa DB/HTTP/config, tanpa mutasi usage, tanpa efek samping. Baseline
 * (source/effective/quantity/PPN rate/ongkir) tetap divalidasi oleh builder
 * `buildPricingSnapshot` existing, lalu benefit fixed di-clip ke subtotal setelah
 * Markdown dan dialokasikan proporsional per whole line. Result akhir wajib lolos
 * `decodePricingSnapshot` sebelum dikembalikan, sehingga snapshot yang keluar
 * selalu bertipe+bounded dan konsisten secara internal.
 *
 * Fase tracer ini hanya mengenal satu bentuk benefit (fixed goods, params version1).
 * Percentage, shipping subsidy, kondisi, dan usage bukan bagian kontrak versi ini.
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

export interface FixedGoodsBenefitInput {
  kind: "fixed_goods";
  paramsVersion: 1;
  /** Nominal positif tepat (whole Rupiah), sekali per order, di-clip ke subtotal. */
  fixedAmount: string | number;
}

/** Input sama dengan baseline pricing, ditambah satu benefit yang sedang dievaluasi. */
export interface EvaluatePricingInput extends BuildPricingSnapshotInput {
  benefit: FixedGoodsBenefitInput;
}

/** Nilai uang keluar dari evaluator selalu whole Rupiah exact (decimal string). */
export function evaluatePricing(input: EvaluatePricingInput): PricingSnapshot {
  const fixedAmount = parseFixedGoodsBenefit(input.benefit);
  const baseline = buildPricingSnapshot({
    fulfillmentMethod: input.fulfillmentMethod,
    ppnRatePercent: input.ppnRatePercent,
    lines: input.lines,
    shippingBeforeSubsidy: input.shippingBeforeSubsidy,
    providerQuotedShippingCost: input.providerQuotedShippingCost,
  });

  const subtotal = BigInt(baseline.subtotal);
  const goodsDiscount = fixedAmount < subtotal ? fixedAmount : subtotal;
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
  const shippingCost = BigInt(baseline.shippingCost);
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
    shippingSubsidy: baseline.shippingSubsidy,
    shippingCost: baseline.shippingCost,
    merchantFunding: baseline.merchantFunding,
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

/** Runtime guard: hanya fixed_goods paramsVersion1, nominal positif tepat dan bounded. */
function parseFixedGoodsBenefit(benefit: unknown): bigint {
  if (!isPlainObject(benefit)) throw inputInvalid("benefit must be a fixed_goods benefit object");
  for (const key of Object.keys(benefit)) {
    if (!FIXED_AMOUNT_FIELDS.has(key)) throw inputInvalid(`benefit carries an unknown field: ${key}`);
  }
  if (benefit.kind !== "fixed_goods") {
    throw inputInvalid("benefit.kind must be fixed_goods; other benefit kinds are not part of this pricing contract version");
  }
  if (benefit.paramsVersion !== 1) throw inputInvalid("benefit.paramsVersion is unknown or unsupported");
  return parsePositiveFixedAmount(benefit.fixedAmount, "benefit.fixedAmount");
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

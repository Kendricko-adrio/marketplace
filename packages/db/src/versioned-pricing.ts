/** Kontrak uang checkout berversi; pure, tanpa runtime DB/HTTP/config.
 * Dipindahkan dari store agar paired reader admin memakai kontrak yang sama.
 */
import type { PricingSnapshotLinePayload, PricingSnapshotPayloadV1 } from "./schema/orders";

export const PRICING_CONTRACT_VERSION = 1;
export const PRICING_ENGINE_VERSION = 1;
export const PROVIDER_CONTRACT_VERSION = 2;
export const MAX_MONEY_RUPIAH = BigInt("9999999999999");
const RATE_SCALE_DIGITS = 6;
const RATE_SCALE = BigInt(10) ** BigInt(RATE_SCALE_DIGITS);
const HUNDRED = BigInt(100);
export const MAX_CART_LINES = 50;
export const MAX_LINE_QUANTITY = 99;
export const MAX_ID_LENGTH = 128;
export type FulfillmentMethod = "pickup" | "delivery";
export type PricingErrorCode = "PRICING_INPUT_INVALID" | "PRICING_UNSUPPORTED_VERSION" | "PRICING_SNAPSHOT_CORRUPT" | "PRICING_SNAPSHOT_TOO_LARGE";
export class PricingContractError extends Error {
  readonly code: PricingErrorCode;
  constructor(code: PricingErrorCode, message: string) {
    super(message);
    this.name = "PricingContractError";
    this.code = code;
  }
}
function inputInvalid(message: string): PricingContractError {
  return new PricingContractError("PRICING_INPUT_INVALID", message);
}
function moneyText(value: string | number, field: string): string {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw inputInvalid(`${field} must be an exact non-negative whole Rupiah amount`);
    }
    return String(value);
  }
  if (typeof value !== "string") throw inputInvalid(`${field} must be a decimal string`);
  return value;
}
function parseMoney(value: string | number, field: string): bigint {
  const text = moneyText(value, field).trim();
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) throw inputInvalid(`${field} must be an unsigned decimal Rupiah amount`);
  const fraction = match[2] ?? "";
  if (!/^0*$/.test(fraction)) throw inputInvalid(`${field} must not carry a Rupiah fraction`);
  const amount = BigInt(match[1]);
  assertMoneyBound(amount, field);
  return amount;
}
function assertMoneyBound(amount: bigint, field: string): bigint {
  if (amount < BigInt(0) || amount > MAX_MONEY_RUPIAH) throw inputInvalid(`${field} is outside the supported Rupiah range`);
  return amount;
}
function parseRateScaled(value: string | number, field: string): bigint {
  const text = typeof value === "number" ? String(value) : value;
  if (typeof text !== "string") throw inputInvalid(`${field} must be a decimal string`);
  const match = /^(\d+)(?:\.(\d{1,6}))?$/.exec(text.trim());
  if (!match) throw inputInvalid(`${field} must be a decimal rate with at most 6 fractional digits`);
  const fraction = (match[2] ?? "").padEnd(RATE_SCALE_DIGITS, "0");
  const scaled = BigInt(match[1]) * RATE_SCALE + BigInt(fraction);
  if (scaled > HUNDRED * RATE_SCALE) throw inputInvalid(`${field} must be between 0 and 100`);
  return scaled;
}
function formatMoney(amount: bigint): string { return amount.toString(); }
function formatRate(scaled: bigint): string {
  const whole = scaled / RATE_SCALE;
  const fraction = (scaled % RATE_SCALE).toString().padStart(RATE_SCALE_DIGITS, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}
function parseQuantity(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_LINE_QUANTITY) {
    throw inputInvalid(`${field} must be a whole quantity between 1 and ${MAX_LINE_QUANTITY}`);
  }
  return value;
}
function parseDomainId(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_ID_LENGTH) {
    throw inputInvalid(`${field} must be a non-empty string of at most ${MAX_ID_LENGTH} characters`);
  }
  return value;
}
export interface PricingLineInput {
  variantId: string;
  quantity: number;
  sourceUnitPrice: string | number;
  effectiveUnitPrice: string | number;
  markdownRevisionId?: string | null;
}
export interface BuildPricingSnapshotInput {
  fulfillmentMethod: FulfillmentMethod;
  ppnRatePercent: string | number;
  lines: readonly PricingLineInput[];
  shippingBeforeSubsidy?: string | number;
  providerQuotedShippingCost?: string | number | null;
}
export type PricingSnapshotLine = PricingSnapshotLinePayload;
export type PricingSnapshot = PricingSnapshotPayloadV1;

export function buildPricingSnapshot(input: BuildPricingSnapshotInput): PricingSnapshot {
  const fulfillmentMethod = input.fulfillmentMethod;
  if (fulfillmentMethod !== "pickup" && fulfillmentMethod !== "delivery") throw inputInvalid("fulfillmentMethod must be pickup or delivery");
  const lines: PricingSnapshotLine[] = [];
  let sourceGoodsSubtotal = BigInt(0);
  let markdownTotal = BigInt(0);
  let effectiveGoodsTotal = BigInt(0);
  if (input.lines.length === 0) throw inputInvalid("lines must contain at least one cart line");
  if (input.lines.length > MAX_CART_LINES) throw inputInvalid(`lines must not exceed ${MAX_CART_LINES} distinct variants`);
  const variantIds = new Set<string>();
  input.lines.forEach((line, index) => {
    const field = `lines[${index}]`;
    const variantId = parseDomainId(line.variantId, `${field}.variantId`);
    if (variantIds.has(variantId)) throw inputInvalid(`${field}.variantId duplicates another cart line`);
    variantIds.add(variantId);
    const quantity = parseQuantity(line.quantity, `${field}.quantity`);
    const sourceUnitPrice = parseMoney(line.sourceUnitPrice, `${field}.sourceUnitPrice`);
    const effectiveUnitPrice = parseMoney(line.effectiveUnitPrice, `${field}.effectiveUnitPrice`);
    if (effectiveUnitPrice > sourceUnitPrice) throw inputInvalid(`${field}.effectiveUnitPrice must not exceed the source unit price`);
    const markdownRevisionId = line.markdownRevisionId ?? null;
    if (effectiveUnitPrice < sourceUnitPrice) {
      // Markdown aktif WAJIB membawa revision ID: harga coret tanpa histori
      // immutable tidak boleh masuk snapshot/checkout (spec §4.1, §8.1).
      if (markdownRevisionId === null) {
        throw inputInvalid(`${field}.markdownRevisionId is required while the effective unit price is below the source`);
      }
    } else if (markdownRevisionId !== null) {
      throw inputInvalid(`${field}.markdownRevisionId must be null when the effective unit price equals the source`);
    }
    const quantityAmount = BigInt(quantity);
    const sourceLineAmount = sourceUnitPrice * quantityAmount;
    const effectiveLineAmount = effectiveUnitPrice * quantityAmount;
    const markdownAmount = sourceLineAmount - effectiveLineAmount;
    sourceGoodsSubtotal = assertMoneyBound(sourceGoodsSubtotal + sourceLineAmount, "sourceGoodsSubtotal");
    markdownTotal = assertMoneyBound(markdownTotal + markdownAmount, "markdownTotal");
    effectiveGoodsTotal = assertMoneyBound(effectiveGoodsTotal + effectiveLineAmount, "subtotal");
    lines.push({ variantId, quantity, sourceUnitPrice: formatMoney(sourceUnitPrice), effectiveUnitPrice: formatMoney(effectiveUnitPrice),
      sourceLineAmount: formatMoney(sourceLineAmount), markdownAmount: formatMoney(markdownAmount), goodsDiscountAmount: "0",
      netLineAmount: formatMoney(effectiveLineAmount), markdownRevisionId });
  });
  const shippingBeforeSubsidy = parseMoney(input.shippingBeforeSubsidy ?? "0", "shippingBeforeSubsidy");
  if (fulfillmentMethod === "pickup" && shippingBeforeSubsidy !== BigInt(0)) throw inputInvalid("pickup orders must not carry a shipping cost");
  const subtotal = effectiveGoodsTotal;
  const goodsDiscount = BigInt(0);
  const netGoods = assertMoneyBound(subtotal - goodsDiscount, "netGoods");
  const shippingSubsidy = BigInt(0);
  const shippingCost = assertMoneyBound(shippingBeforeSubsidy - shippingSubsidy, "shippingCost");
  const merchantFunding = shippingSubsidy;
  const serviceFee = BigInt(0);
  const taxableBase = netGoods;
  const rateScaled = parseRateScaled(input.ppnRatePercent, "ppnRatePercent");
  const ppnAmount = assertMoneyBound(ceilDiv(taxableBase * rateScaled, HUNDRED * RATE_SCALE), "ppnAmount");
  const total = assertMoneyBound(netGoods + ppnAmount + shippingCost + serviceFee, "total");
  const expectedProviderPayable = assertMoneyBound(netGoods + shippingCost, "expectedProviderPayable");
  return {
    pricingContractVersion: PRICING_CONTRACT_VERSION, pricingEngineVersion: PRICING_ENGINE_VERSION, providerContractVersion: PROVIDER_CONTRACT_VERSION,
    currency: "IDR", fulfillmentMethod, sourceGoodsSubtotal: formatMoney(sourceGoodsSubtotal), markdownTotal: formatMoney(markdownTotal),
    subtotal: formatMoney(subtotal), goodsDiscount: formatMoney(goodsDiscount), netGoods: formatMoney(netGoods),
    shippingBeforeSubsidy: formatMoney(shippingBeforeSubsidy), shippingSubsidy: formatMoney(shippingSubsidy), shippingCost: formatMoney(shippingCost),
    merchantFunding: formatMoney(merchantFunding), serviceFee: formatMoney(serviceFee), taxableBase: formatMoney(taxableBase),
    ppnRatePercent: formatRate(rateScaled), ppnAmount: formatMoney(ppnAmount), total: formatMoney(total), expectedProviderPayable: formatMoney(expectedProviderPayable),
    providerQuotedShippingCost: input.providerQuotedShippingCost === undefined || input.providerQuotedShippingCost === null
      ? null : formatMoney(parseMoney(input.providerQuotedShippingCost, "providerQuotedShippingCost")),
    providerBilledShippingCost: null, lines,
  };
}
function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  if (numerator === BigInt(0)) return BigInt(0);
  return (numerator + denominator - BigInt(1)) / denominator;
}

/** Legacy scale2 is preserved, never repriced with the new formula. */
export interface PersistedOrderPricingRow {
  pricingContractVersion?: number | null;
  pricingEngineVersion?: number | null;
  providerContractVersion?: number | null;
  pricingSnapshot?: unknown;
  fulfillmentMethod?: string | null;
  subtotal: string;
  discount: string;
  shippingCost: string;
  serviceFee: string;
  ppnRate: string;
  ppnAmount: string;
  total: string;
}
export interface LegacyOrderPricingSnapshot {
  pricingContractVersion: 0;
  currency: "IDR";
  fulfillmentMethod: FulfillmentMethod;
  subtotal: string;
  discount: string;
  shippingCost: string;
  serviceFee: string;
  ppnRatePercent: string;
  ppnAmount: string;
  total: string;
  expectedProviderPayable: null;
}
const LEGACY_CENTS_PER_RUPIAH = BigInt(100);
function parseLegacyMoney(value: unknown, field: string): bigint {
  if (typeof value !== "string") throw snapshotCorrupt(`${field} must be a decimal string`);
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) throw snapshotCorrupt(`${field} is not an exact numeric(15,2) amount`);
  const whole = BigInt(match[1]);
  if (whole > MAX_MONEY_RUPIAH) throw snapshotCorrupt(`${field} is outside the legacy numeric range`);
  const fraction = (match[2] ?? "").padEnd(2, "0");
  return whole * LEGACY_CENTS_PER_RUPIAH + BigInt(fraction);
}
function formatLegacyMoney(cents: bigint): string {
  const whole = cents / LEGACY_CENTS_PER_RUPIAH;
  const fraction = (cents % LEGACY_CENTS_PER_RUPIAH).toString().padStart(2, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}
export function decodeLegacyOrderPricing(row: PersistedOrderPricingRow): LegacyOrderPricingSnapshot {
  const fulfillmentMethod = row.fulfillmentMethod ?? "pickup";
  if (fulfillmentMethod !== "pickup" && fulfillmentMethod !== "delivery") throw snapshotCorrupt("legacy order fulfillmentMethod must be pickup or delivery");
  const rateScaled = decodeLegacyRate(row.ppnRate);
  return { pricingContractVersion: 0, currency: "IDR", fulfillmentMethod,
    subtotal: formatLegacyMoney(parseLegacyMoney(row.subtotal, "subtotal")), discount: formatLegacyMoney(parseLegacyMoney(row.discount, "discount")),
    shippingCost: formatLegacyMoney(parseLegacyMoney(row.shippingCost, "shippingCost")), serviceFee: formatLegacyMoney(parseLegacyMoney(row.serviceFee, "serviceFee")),
    ppnRatePercent: formatRate(rateScaled), ppnAmount: formatLegacyMoney(parseLegacyMoney(row.ppnAmount, "ppnAmount")), total: formatLegacyMoney(parseLegacyMoney(row.total, "total")), expectedProviderPayable: null };
}
function decodeLegacyRate(value: unknown): bigint {
  if (typeof value !== "string") throw snapshotCorrupt("ppnRate must be a decimal string");
  try { return parseRateScaled(value, "ppnRate"); }
  catch { throw snapshotCorrupt("ppnRate is not a supported rate"); }
}
export function readOrderPricing(row: PersistedOrderPricingRow): PricingSnapshot | LegacyOrderPricingSnapshot {
  const pricingVersion = row.pricingContractVersion ?? 0;
  if (pricingVersion === PRICING_CONTRACT_VERSION) {
    if ((row.pricingEngineVersion !== undefined && row.pricingEngineVersion !== null && row.pricingEngineVersion !== PRICING_ENGINE_VERSION) ||
        (row.providerContractVersion !== undefined && row.providerContractVersion !== null && row.providerContractVersion !== PROVIDER_CONTRACT_VERSION)) {
      throw snapshotUnsupportedVersion("order relational pricing versions are unknown or unsupported");
    }
    return decodePricingSnapshot(row.pricingSnapshot);
  }
  if (pricingVersion === 0) {
    const engineVersion = row.pricingEngineVersion ?? 0;
    const providerVersion = row.providerContractVersion ?? 0;
    if (engineVersion !== 0 || providerVersion !== 0) throw snapshotUnsupportedVersion("legacy order relational pricing versions are inconsistent");
    return decodeLegacyOrderPricing(row);
  }
  throw snapshotUnsupportedVersion("order pricing contract version is unknown or unsupported");
}

export const MAX_SNAPSHOT_BYTES = 256 * 1024;
const SNAPSHOT_FIELDS = new Set<string>([
  "pricingContractVersion", "pricingEngineVersion", "providerContractVersion", "currency", "fulfillmentMethod", "sourceGoodsSubtotal", "markdownTotal",
  "subtotal", "goodsDiscount", "netGoods", "shippingBeforeSubsidy", "shippingSubsidy", "shippingCost", "merchantFunding", "serviceFee", "taxableBase",
  "ppnRatePercent", "ppnAmount", "total", "expectedProviderPayable", "providerQuotedShippingCost", "providerBilledShippingCost", "lines",
]);
const SNAPSHOT_LINE_FIELDS = new Set<string>([
  "variantId", "quantity", "sourceUnitPrice", "effectiveUnitPrice", "sourceLineAmount", "markdownAmount", "goodsDiscountAmount", "netLineAmount", "markdownRevisionId",
]);
function snapshotCorrupt(message: string): PricingContractError { return new PricingContractError("PRICING_SNAPSHOT_CORRUPT", message); }
function snapshotTooLarge(bytes: number): PricingContractError {
  return new PricingContractError("PRICING_SNAPSHOT_TOO_LARGE", `pricing snapshot exceeds ${MAX_SNAPSHOT_BYTES} bytes (${bytes})`);
}
function snapshotUnsupportedVersion(message: string): PricingContractError { return new PricingContractError("PRICING_UNSUPPORTED_VERSION", message); }
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function snapshotByteLength(payload: unknown): number | null {
  let serialized: string | undefined;
  try { serialized = JSON.stringify(payload); } catch { return null; }
  if (typeof serialized !== "string") return null;
  return new TextEncoder().encode(serialized).length;
}
function assertKnownFields(record: Record<string, unknown>, allowed: ReadonlySet<string>, field: string): void {
  for (const key of Object.keys(record)) if (!allowed.has(key)) throw snapshotCorrupt(`${field} carries an unknown field: ${key}`);
}
function decodeMoneyField(value: unknown, field: string): bigint {
  if (typeof value !== "string") throw snapshotCorrupt(`${field} must be a decimal string`);
  try { return parseMoney(value, field); } catch { throw snapshotCorrupt(`${field} is not an exact whole Rupiah amount`); }
}
function decodeNullableMoneyField(value: unknown, field: string): bigint | null {
  if (value === null) return null;
  return decodeMoneyField(value, field);
}
function decodeRateField(value: unknown, field: string): bigint {
  if (typeof value !== "string") throw snapshotCorrupt(`${field} must be a decimal string`);
  try { return parseRateScaled(value, field); } catch { throw snapshotCorrupt(`${field} is not a supported rate`); }
}
function decodeQuantityField(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > MAX_LINE_QUANTITY) {
    throw snapshotCorrupt(`${field} must be a whole quantity between 1 and ${MAX_LINE_QUANTITY}`);
  }
  return value;
}
function decodeIdField(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_ID_LENGTH) {
    throw snapshotCorrupt(`${field} must be a non-empty string of at most ${MAX_ID_LENGTH} characters`);
  }
  return value;
}
function decodeNullableRevisionId(value: unknown, field: string): string | null {
  if (value === null) return null;
  return decodeIdField(value, field);
}
function decodeBound(amount: bigint, field: string): bigint {
  if (amount < BigInt(0) || amount > MAX_MONEY_RUPIAH) throw snapshotCorrupt(`${field} is outside the supported Rupiah range`);
  return amount;
}

/** Strict immutable decoder: no master/config reads and no legacy downgrade. */
export function decodePricingSnapshot(payload: unknown): PricingSnapshot {
  const bytes = snapshotByteLength(payload);
  if (bytes === null) throw snapshotCorrupt("pricing snapshot is not JSON-serializable");
  if (bytes > MAX_SNAPSHOT_BYTES) throw snapshotTooLarge(bytes);
  if (!isPlainObject(payload)) throw snapshotCorrupt("pricing snapshot must be a JSON object");
  if (payload.pricingContractVersion !== PRICING_CONTRACT_VERSION) {
    throw snapshotUnsupportedVersion("pricing snapshot version is unknown or unsupported; legacy rows need the explicit legacy decoder");
  }
  if (payload.pricingEngineVersion !== PRICING_ENGINE_VERSION) throw snapshotUnsupportedVersion("pricing engine version is unknown or unsupported");
  if (payload.providerContractVersion !== PROVIDER_CONTRACT_VERSION) throw snapshotUnsupportedVersion("provider contract version is unknown or unsupported");
  assertKnownFields(payload, SNAPSHOT_FIELDS, "pricing snapshot");
  if (payload.currency !== "IDR") throw snapshotCorrupt("pricing snapshot currency must be IDR");
  const fulfillmentMethod = payload.fulfillmentMethod;
  if (fulfillmentMethod !== "pickup" && fulfillmentMethod !== "delivery") throw snapshotCorrupt("pricing snapshot fulfillmentMethod must be pickup or delivery");
  const sourceGoodsSubtotal = decodeMoneyField(payload.sourceGoodsSubtotal, "sourceGoodsSubtotal");
  const markdownTotal = decodeMoneyField(payload.markdownTotal, "markdownTotal");
  const subtotal = decodeMoneyField(payload.subtotal, "subtotal");
  const goodsDiscount = decodeMoneyField(payload.goodsDiscount, "goodsDiscount");
  const netGoods = decodeMoneyField(payload.netGoods, "netGoods");
  const shippingBeforeSubsidy = decodeMoneyField(payload.shippingBeforeSubsidy, "shippingBeforeSubsidy");
  const shippingSubsidy = decodeMoneyField(payload.shippingSubsidy, "shippingSubsidy");
  const shippingCost = decodeMoneyField(payload.shippingCost, "shippingCost");
  const merchantFunding = decodeMoneyField(payload.merchantFunding, "merchantFunding");
  const serviceFee = decodeMoneyField(payload.serviceFee, "serviceFee");
  const taxableBase = decodeMoneyField(payload.taxableBase, "taxableBase");
  const rateScaled = decodeRateField(payload.ppnRatePercent, "ppnRatePercent");
  const ppnAmount = decodeMoneyField(payload.ppnAmount, "ppnAmount");
  const total = decodeMoneyField(payload.total, "total");
  const expectedProviderPayable = decodeMoneyField(payload.expectedProviderPayable, "expectedProviderPayable");
  const providerQuotedShippingCost = decodeNullableMoneyField(payload.providerQuotedShippingCost, "providerQuotedShippingCost");
  const providerBilledShippingCost = decodeNullableMoneyField(payload.providerBilledShippingCost, "providerBilledShippingCost");
  if (!Array.isArray(payload.lines)) throw snapshotCorrupt("pricing snapshot lines must be an array");
  if (payload.lines.length === 0) throw snapshotCorrupt("pricing snapshot must carry at least one cart line");
  if (payload.lines.length > MAX_CART_LINES) throw snapshotCorrupt(`pricing snapshot must not exceed ${MAX_CART_LINES} cart lines`);
  const lines: PricingSnapshotLine[] = [];
  const seenVariantIds = new Set<string>();
  let lineSourceTotal = BigInt(0);
  let lineMarkdownTotal = BigInt(0);
  let lineNetTotal = BigInt(0);
  payload.lines.forEach((rawLine, index) => {
    const field = `lines[${index}]`;
    if (!isPlainObject(rawLine)) throw snapshotCorrupt(`${field} must be a JSON object`);
    assertKnownFields(rawLine, SNAPSHOT_LINE_FIELDS, field);
    const variantId = decodeIdField(rawLine.variantId, `${field}.variantId`);
    if (seenVariantIds.has(variantId)) throw snapshotCorrupt(`${field}.variantId duplicates another cart line`);
    seenVariantIds.add(variantId);
    const quantity = decodeQuantityField(rawLine.quantity, `${field}.quantity`);
    const sourceUnitPrice = decodeMoneyField(rawLine.sourceUnitPrice, `${field}.sourceUnitPrice`);
    const effectiveUnitPrice = decodeMoneyField(rawLine.effectiveUnitPrice, `${field}.effectiveUnitPrice`);
    const sourceLineAmount = decodeMoneyField(rawLine.sourceLineAmount, `${field}.sourceLineAmount`);
    const lineMarkdownAmount = decodeMoneyField(rawLine.markdownAmount, `${field}.markdownAmount`);
    const lineGoodsDiscount = decodeMoneyField(rawLine.goodsDiscountAmount, `${field}.goodsDiscountAmount`);
    const netLineAmount = decodeMoneyField(rawLine.netLineAmount, `${field}.netLineAmount`);
    const markdownRevisionId = decodeNullableRevisionId(rawLine.markdownRevisionId, `${field}.markdownRevisionId`);
    const quantityAmount = BigInt(quantity);
    const expectedSourceLineAmount = decodeBound(sourceUnitPrice * quantityAmount, `${field}.sourceLineAmount`);
    if (sourceLineAmount !== expectedSourceLineAmount) throw snapshotCorrupt(`${field}.sourceLineAmount does not match unit price × quantity`);
    const effectiveLineAmount = decodeBound(effectiveUnitPrice * quantityAmount, `${field}.effectiveUnitPrice`);
    if (effectiveLineAmount > expectedSourceLineAmount) throw snapshotCorrupt(`${field}.effectiveUnitPrice must not exceed the source unit price`);
    if (sourceLineAmount - effectiveLineAmount !== lineMarkdownAmount) throw snapshotCorrupt(`${field}.markdownAmount does not match source minus effective`);
    if (lineGoodsDiscount > effectiveLineAmount) throw snapshotCorrupt(`${field}.goodsDiscountAmount exceeds the effective line amount`);
    if (effectiveLineAmount - lineGoodsDiscount !== netLineAmount) throw snapshotCorrupt(`${field}.netLineAmount does not match effective line minus discount`);
    lineSourceTotal = decodeBound(lineSourceTotal + sourceLineAmount, "lines.sourceLineAmount");
    lineMarkdownTotal = decodeBound(lineMarkdownTotal + lineMarkdownAmount, "lines.markdownAmount");
    lineNetTotal = decodeBound(lineNetTotal + netLineAmount, "lines.netLineAmount");
    lines.push({ variantId, quantity, sourceUnitPrice: formatMoney(sourceUnitPrice), effectiveUnitPrice: formatMoney(effectiveUnitPrice),
      sourceLineAmount: formatMoney(sourceLineAmount), markdownAmount: formatMoney(lineMarkdownAmount), goodsDiscountAmount: formatMoney(lineGoodsDiscount),
      netLineAmount: formatMoney(netLineAmount), markdownRevisionId });
  });
  if (lineSourceTotal !== sourceGoodsSubtotal) throw snapshotCorrupt("lines.sourceLineAmount does not sum to sourceGoodsSubtotal");
  if (lineMarkdownTotal !== markdownTotal) throw snapshotCorrupt("lines.markdownAmount does not sum to markdownTotal");
  if (lineNetTotal !== netGoods) throw snapshotCorrupt("lines.netLineAmount does not sum to netGoods");
  if (sourceGoodsSubtotal - markdownTotal !== subtotal) throw snapshotCorrupt("subtotal does not match sourceGoodsSubtotal minus markdownTotal");
  if (subtotal - goodsDiscount !== netGoods) throw snapshotCorrupt("netGoods does not match subtotal minus goodsDiscount");
  if (shippingBeforeSubsidy - shippingSubsidy !== shippingCost) throw snapshotCorrupt("shippingCost does not match shippingBeforeSubsidy minus shippingSubsidy");
  if (fulfillmentMethod === "pickup" && (shippingBeforeSubsidy !== BigInt(0) || shippingCost !== BigInt(0))) throw snapshotCorrupt("pickup snapshots must not carry a shipping cost");
  if (serviceFee !== BigInt(0)) throw snapshotCorrupt("this pricing contract version does not charge a service fee");
  if (taxableBase !== netGoods) throw snapshotCorrupt("taxableBase must equal netGoods: PPN is charged on goods only");
  const expectedPpnAmount = decodeBound(ceilDiv(netGoods * rateScaled, HUNDRED * RATE_SCALE), "ppnAmount");
  if (ppnAmount !== expectedPpnAmount) throw snapshotCorrupt("ppnAmount does not match netGoods × ppnRatePercent");
  if (netGoods + ppnAmount + shippingCost + serviceFee !== total) throw snapshotCorrupt("total does not match netGoods + PPN + shippingCost");
  if (netGoods + shippingCost !== expectedProviderPayable) throw snapshotCorrupt("expectedProviderPayable does not match netGoods + shippingCost");
  return { pricingContractVersion: PRICING_CONTRACT_VERSION, pricingEngineVersion: PRICING_ENGINE_VERSION, providerContractVersion: PROVIDER_CONTRACT_VERSION,
    currency: "IDR", fulfillmentMethod, sourceGoodsSubtotal: formatMoney(sourceGoodsSubtotal), markdownTotal: formatMoney(markdownTotal),
    subtotal: formatMoney(subtotal), goodsDiscount: formatMoney(goodsDiscount), netGoods: formatMoney(netGoods),
    shippingBeforeSubsidy: formatMoney(shippingBeforeSubsidy), shippingSubsidy: formatMoney(shippingSubsidy), shippingCost: formatMoney(shippingCost),
    merchantFunding: formatMoney(merchantFunding), serviceFee: formatMoney(serviceFee), taxableBase: formatMoney(taxableBase), ppnRatePercent: formatRate(rateScaled),
    ppnAmount: formatMoney(ppnAmount), total: formatMoney(total), expectedProviderPayable: formatMoney(expectedProviderPayable),
    providerQuotedShippingCost: providerQuotedShippingCost === null ? null : formatMoney(providerQuotedShippingCost),
    providerBilledShippingCost: providerBilledShippingCost === null ? null : formatMoney(providerBilledShippingCost), lines };
}

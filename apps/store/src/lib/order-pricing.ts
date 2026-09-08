export const DEFAULT_PPN_RATE_PERCENT = "11";
const RATE_SCALE_DIGITS = 6;
const RATE_SCALE = BigInt(10) ** BigInt(RATE_SCALE_DIGITS);
const CENTS_PER_RUPIAH = BigInt(100);

export interface OrderPricingInput {
  subtotal: string | number;
  discount?: string | number;
  shippingCost?: string | number;
  serviceFee?: string | number;
  ppnRatePercent: string | number;
}

export interface OrderPricing {
  subtotal: string;
  discount: string;
  taxableBase: string;
  shippingCost: string;
  serviceFee: string;
  ppnRatePercent: string;
  ppnAmount: string;
  total: string;
}

function parseFixed(value: string | number, digits: number): bigint | null {
  const text = String(value).trim();
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) return null;
  const fraction = match[2] ?? "";
  if (fraction.length > digits) return null;
  return BigInt(match[1]) * BigInt(10) ** BigInt(digits) + BigInt((fraction + "0".repeat(digits)).slice(0, digits));
}

function moneyToCents(value: string | number | undefined): bigint {
  const parsed = parseFixed(value ?? "0", 2);
  if (parsed === null) throw new Error(`Invalid non-negative monetary value: ${value}`);
  return parsed;
}

function formatMoney(cents: bigint): string {
  return `${cents / CENTS_PER_RUPIAH}.${(cents % CENTS_PER_RUPIAH).toString().padStart(2, "0")}`;
}

export function calculateLineItemSubtotal(
  items: readonly { price: string | number; quantity: number }[]
): string {
  const cents = items.reduce((sum, item) => {
    if (!Number.isSafeInteger(item.quantity) || item.quantity < 0) {
      throw new Error(`Invalid item quantity: ${item.quantity}`);
    }
    return sum + moneyToCents(item.price) * BigInt(item.quantity);
  }, BigInt(0));
  return formatMoney(cents);
}

function formatRate(scaled: bigint): string {
  const whole = scaled / RATE_SCALE;
  const fraction = (scaled % RATE_SCALE).toString().padStart(RATE_SCALE_DIGITS, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export function resolvePpnRate(value: unknown): string {
  if (typeof value !== "string" && typeof value !== "number") return DEFAULT_PPN_RATE_PERCENT;
  if (typeof value === "number" && !Number.isFinite(value)) return DEFAULT_PPN_RATE_PERCENT;
  const scaled = parseFixed(value, RATE_SCALE_DIGITS);
  if (scaled === null || scaled > BigInt(100) * RATE_SCALE) return DEFAULT_PPN_RATE_PERCENT;
  return formatRate(scaled);
}

export function calculateOrderPricing(input: OrderPricingInput): OrderPricing {
  const subtotal = moneyToCents(input.subtotal);
  const discount = moneyToCents(input.discount);
  const shippingCost = moneyToCents(input.shippingCost);
  const serviceFee = moneyToCents(input.serviceFee);
  const taxableBase = subtotal > discount ? subtotal - discount : BigInt(0);
  const ppnRatePercent = resolvePpnRate(input.ppnRatePercent);
  const rate = parseFixed(ppnRatePercent, RATE_SCALE_DIGITS)!;
  const denominator = BigInt(100) * RATE_SCALE * CENTS_PER_RUPIAH;
  const numerator = taxableBase * rate;
  const ppnRupiah = numerator === BigInt(0) ? BigInt(0) : (numerator + denominator - BigInt(1)) / denominator;
  const ppnAmount = ppnRupiah * CENTS_PER_RUPIAH;
  const total = taxableBase + shippingCost + serviceFee + ppnAmount;

  return {
    subtotal: formatMoney(subtotal),
    discount: formatMoney(discount),
    taxableBase: formatMoney(taxableBase),
    shippingCost: formatMoney(shippingCost),
    serviceFee: formatMoney(serviceFee),
    ppnRatePercent,
    ppnAmount: formatMoney(ppnAmount),
    total: formatMoney(total),
  };
}

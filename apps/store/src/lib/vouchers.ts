/**
 * Voucher discount preview — the pure computation behind
 * POST /api/vouchers/validate. Extracted so the discount rules are
 * unit-testable.
 *
 * - `percentage`: subtotal × value/100, capped at maxDiscount.
 * - `fixed` / `shipping`: flat `value`.
 */
export function computeVoucherDiscount(
  discountType: string,
  value: string,
  subtotal: number,
  maxDiscount?: string | null
): number {
  if (discountType === "percentage") {
    const discount = subtotal * (parseFloat(value) / 100);
    if (maxDiscount) {
      return Math.min(discount, parseFloat(maxDiscount));
    }
    return discount;
  }
  // fixed and shipping are both flat amounts.
  return parseFloat(value);
}

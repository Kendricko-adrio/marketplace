/**
 * Discount percent shown on product cards and the detail page, derived from
 * the RRP (`base_price`) vs the net price (`variant.price`). Returns 0 when
 * there is no discount (net >= RRP) or the RRP is not positive.
 */
export function computeDiscountPercent(
  originalPrice: number,
  currentPrice: number
): number {
  if (originalPrice <= 0 || currentPrice >= originalPrice) return 0;
  return Math.round(((originalPrice - currentPrice) / originalPrice) * 100);
}

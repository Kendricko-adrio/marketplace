import crypto from "crypto";

/**
 * Constant-time comparison of a customer-provided pickup code against the
 * stored one. Lengths must match (timingSafeEqual throws otherwise) and the
 * stored code must be non-empty. Extracted from the verify-pickup route so
 * the comparison rules are unit-testable.
 */
export function verifyPickupCode(
  input: string,
  expected: string | null | undefined
): boolean {
  if (!expected || expected.length === 0) return false;
  if (input.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(input), Buffer.from(expected));
}

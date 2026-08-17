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

const MAX_PICKUP_ATTEMPTS = 5;
const PICKUP_LOCK_MS = 15 * 60_000;

export function isPickupVerificationLocked(
  lockedUntil: Date | null | undefined,
  now = new Date()
): boolean {
  return Boolean(lockedUntil && lockedUntil.getTime() > now.getTime());
}

export function getFailedPickupAttemptUpdate(currentAttempts: number, now = new Date()) {
  const attempts = currentAttempts + 1;
  return {
    attempts,
    lockedUntil:
      attempts >= MAX_PICKUP_ATTEMPTS
        ? new Date(now.getTime() + PICKUP_LOCK_MS)
        : null,
  };
}

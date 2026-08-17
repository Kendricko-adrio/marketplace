import { createHash } from "crypto";

/**
 * Verify the Jubelio webhook signature: SHA256(rawBody + secret), hex.
 * Jubelio sends it in either the `webhook-signature` or
 * `x-jubelio-signature` header (the spec shows it only in a screenshot).
 * Extracted from the webhook route so the verification is unit-testable.
 */
export function verifyJubelioSignature(
  rawBody: string,
  secret: string,
  provided: string | null | undefined
): boolean {
  if (!provided) return false;
  const expected = createHash("sha256").update(rawBody + secret).digest("hex");
  return provided === expected;
}

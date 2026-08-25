import { createHash, createHmac, timingSafeEqual } from "crypto";

/** Read the signature header emitted by Jubelio, with legacy aliases retained. */
export function getJubelioSignature(headers: Pick<Headers, "get">): string | null {
  return (
    headers.get("sign") ||
    headers.get("webhook-signature") ||
    headers.get("x-jubelio-signature")
  );
}

/**
 * Verify the Jubelio webhook signature:
 * HMAC-SHA256(message = rawBody + secret, key = secret), hex.
 * Jubelio sends it in the `Sign` header. Legacy aliases are accepted by
 * `getJubelioSignature` for compatibility.
 * Extracted from the webhook route so the verification is unit-testable.
 */
export function verifyJubelioSignature(
  rawBody: string,
  secret: string,
  provided: string | null | undefined
): boolean {
  if (!provided || !/^[a-f\d]{64}$/i.test(provided)) return false;
  const expected = createHmac("sha256", secret)
    .update(rawBody + secret)
    .digest("hex");
  return timingSafeEqual(Buffer.from(provided, "hex"), Buffer.from(expected, "hex"));
}

export interface JubelioSignatureInspection {
  valid: boolean;
  reason: "valid" | "missing" | "malformed" | "mismatch";
  bodyBytes: number;
  bodyHashPrefix: string;
  expectedSignaturePrefix: string;
  providedSignaturePrefix: string | null;
  secretFingerprint: string;
}

/**
 * Produce safe diagnostics for signature failures. Only short hash prefixes are
 * returned; neither the webhook secret nor the complete signatures are logged.
 */
export function inspectJubelioSignature(
  rawBody: string,
  secret: string,
  provided: string | null | undefined
): JubelioSignatureInspection {
  const expected = createHmac("sha256", secret)
    .update(rawBody + secret)
    .digest("hex");
  const valid =
    Boolean(provided) &&
    /^[a-f\d]{64}$/i.test(provided!) &&
    timingSafeEqual(Buffer.from(provided!, "hex"), Buffer.from(expected, "hex"));
  const reason = valid
    ? "valid"
    : !provided
      ? "missing"
      : !/^[a-f\d]{64}$/i.test(provided)
        ? "malformed"
        : "mismatch";

  return {
    valid,
    reason,
    bodyBytes: Buffer.byteLength(rawBody),
    bodyHashPrefix: createHash("sha256").update(rawBody).digest("hex").slice(0, 12),
    expectedSignaturePrefix: expected.slice(0, 12),
    providedSignaturePrefix: provided?.slice(0, 12) ?? null,
    secretFingerprint: createHash("sha256").update(secret).digest("hex").slice(0, 12),
  };
}

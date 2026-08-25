import { describe, it, expect } from "vitest";
import crypto from "crypto";
import {
  getJubelioSignature,
  inspectJubelioSignature,
  verifyJubelioSignature,
} from "./jubelio-webhook";

// Backs POST /api/webhooks/jubelio signature verification.
// Expected values computed independently with node:crypto.

const SECRET = "webhook-secret-abc";
const BODY = JSON.stringify({ action: "update-product", item_group_id: 42 });

function sign(body: string, secret: string): string {
  return crypto
    .createHmac("sha256", secret)
    .update(body + secret)
    .digest("hex");
}

describe("getJubelioSignature", () => {
  it("accepts the Sign header sent by Jubelio", () => {
    const headers = new Headers({ Sign: "jubelio-signature" });

    expect(getJubelioSignature(headers)).toBe("jubelio-signature");
  });
});

describe("inspectJubelioSignature", () => {
  it("reports safe diagnostics when a provided signature does not match", () => {
    expect(inspectJubelioSignature(BODY, SECRET, "a".repeat(64))).toEqual({
      valid: false,
      reason: "mismatch",
      bodyBytes: 46,
      bodyHashPrefix: "42f5203fda0f",
      expectedSignaturePrefix: "ac44fe5b6e74",
      providedSignaturePrefix: "aaaaaaaaaaaa",
      secretFingerprint: "056bf4fb5eec",
    });
  });
});

describe("verifyJubelioSignature", () => {
  it("accepts the documented Jubelio HMAC signature format", () => {
    expect(
      verifyJubelioSignature(
        BODY,
        SECRET,
        "ac44fe5b6e745afaa9536a405e17046e0e99e22a05b09f80f5dc908536e7b6be"
      )
    ).toBe(true);
  });

  it("rejects a tampered body", () => {
    const sig = sign(BODY, SECRET);
    expect(verifyJubelioSignature(BODY + "x", SECRET, sig)).toBe(false);
  });

  it("rejects a signature made with a different secret", () => {
    expect(verifyJubelioSignature(BODY, SECRET, sign(BODY, "other-secret"))).toBe(
      false
    );
  });

  it("rejects a missing signature header", () => {
    expect(verifyJubelioSignature(BODY, SECRET, null)).toBe(false);
    expect(verifyJubelioSignature(BODY, SECRET, undefined)).toBe(false);
    expect(verifyJubelioSignature(BODY, SECRET, "")).toBe(false);
  });
});

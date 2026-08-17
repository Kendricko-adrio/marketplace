import { describe, it, expect } from "vitest";
import crypto from "crypto";
import { verifyJubelioSignature } from "./jubelio-webhook";

// Backs POST /api/webhooks/jubelio signature verification.
// Expected values computed independently with node:crypto.

const SECRET = "webhook-secret-abc";
const BODY = JSON.stringify({ action: "update-product", item_group_id: 42 });

function sign(body: string, secret: string): string {
  return crypto.createHash("sha256").update(body + secret).digest("hex");
}

describe("verifyJubelioSignature", () => {
  it("accepts a valid signature", () => {
    expect(verifyJubelioSignature(BODY, SECRET, sign(BODY, SECRET))).toBe(true);
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

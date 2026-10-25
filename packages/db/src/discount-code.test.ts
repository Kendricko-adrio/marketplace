/**
 * Seam L — kanonikalisasi Manual Promo Code (ticket 09, spec §7.1).
 *
 * Expected literal diambil dari spec, bukan dari implementasi: trim + uppercase,
 * ASCII 3–64 karakter, karakter pertama alfanumerik, sisanya alfanumerik,
 * underscore, atau hyphen. Internal space dan alias Unicode ditolak.
 */
import { describe, expect, it } from "vitest";

import {
  canonicalizePromoCode,
  maskPromoCode,
  PROMO_CODE_MAX_LENGTH,
  PROMO_CODE_MIN_LENGTH,
} from "./discount-code";

describe("canonicalizePromoCode", () => {
  it("trims surrounding whitespace and uppercases the literal", () => {
    expect(canonicalizePromoCode(" hemat17agustus ")).toBe("HEMAT17AGUSTUS");
    expect(canonicalizePromoCode("Hemat17Agustus")).toBe("HEMAT17AGUSTUS");
  });

  it("keeps underscore and hyphen after the first alphanumeric", () => {
    expect(canonicalizePromoCode("promo_2026-ok")).toBe("PROMO_2026-OK");
    expect(canonicalizePromoCode("a_b")).toBe("A_B");
  });

  it("rejects internal spaces, Unicode aliases and separator characters", () => {
    expect(canonicalizePromoCode("hemat 17agustus")).toBeNull();
    expect(canonicalizePromoCode("hemat\t17agustus")).toBeNull();
    expect(canonicalizePromoCode("hémät17")).toBeNull();
    // Dotless i uppercases to ASCII "I" in JS; the raw alias must still fail.
    expect(canonicalizePromoCode("ı7agustus")).toBeNull();
    expect(canonicalizePromoCode("HEMAT.17")).toBeNull();
    expect(canonicalizePromoCode("HEMAT/17")).toBeNull();
    expect(canonicalizePromoCode("HEMAT 17\n")).toBeNull();
  });

  it("enforces the 3–64 ASCII boundary and first-character rule", () => {
    expect(canonicalizePromoCode("ab")).toBeNull();
    expect(canonicalizePromoCode("a".repeat(PROMO_CODE_MIN_LENGTH))).toBe("AAA");
    expect(canonicalizePromoCode("a".repeat(PROMO_CODE_MAX_LENGTH))).toBe(
      "A".repeat(64)
    );
    expect(canonicalizePromoCode("a".repeat(PROMO_CODE_MAX_LENGTH + 1))).toBeNull();
    expect(canonicalizePromoCode("_abc")).toBeNull();
    expect(canonicalizePromoCode("-abc")).toBeNull();
    expect(canonicalizePromoCode("9abc")).toBe("9ABC");
  });

  it("rejects empty and non-string input without throwing", () => {
    expect(canonicalizePromoCode("")).toBeNull();
    expect(canonicalizePromoCode("   ")).toBeNull();
    expect(canonicalizePromoCode(undefined)).toBeNull();
    expect(canonicalizePromoCode(12345)).toBeNull();
  });
});

describe("maskPromoCode", () => {
  it("never returns the full canonical literal for a stored code", () => {
    const code = "HEMAT17AGUSTUS";
    const masked = maskPromoCode(code);
    expect(masked).not.toBe(code);
    expect(masked).not.toContain(code);
    expect(masked.startsWith("HE")).toBe(true);
    expect(masked.endsWith("US")).toBe(true);
    expect(masked).toContain("•");
  });

  it("fully masks short codes instead of leaking them", () => {
    expect(maskPromoCode("ABC")).toBe("••••");
    expect(maskPromoCode("ABCDEFG")).toBe("••••");
  });

  it("is stable for the same literal and safe for invalid input", () => {
    expect(maskPromoCode("PROMO_2026")).toBe(maskPromoCode("PROMO_2026"));
    expect(maskPromoCode("")).toBe("••••");
    expect(maskPromoCode(null)).toBe("••••");
  });
});

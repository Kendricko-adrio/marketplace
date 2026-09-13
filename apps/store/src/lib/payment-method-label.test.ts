import { describe, it, expect } from "vitest";
import { formatPaymentMethodLabel } from "./payment-method-label";

describe("formatPaymentMethodLabel", () => {
  it("maps known Midtrans payment types to readable labels", () => {
    expect(formatPaymentMethodLabel("qris")).toBe("QRIS");
    expect(formatPaymentMethodLabel("gopay")).toBe("GoPay");
    expect(formatPaymentMethodLabel("credit_card")).toBe("Kartu Kredit/Debit");
    expect(formatPaymentMethodLabel("bank_transfer")).toBe("Transfer Bank/VA");
    expect(formatPaymentMethodLabel("bca_va")).toBe("VA BCA");
    expect(formatPaymentMethodLabel("echannel")).toBe("Mandiri Bill Payment");
  });

  it("falls back to the upper-cased raw code for unknown methods", () => {
    expect(formatPaymentMethodLabel("akulaku")).toBe("AKULAKU");
  });

  it("renders an em-dash for null/undefined/empty", () => {
    expect(formatPaymentMethodLabel(null)).toBe("—");
    expect(formatPaymentMethodLabel(undefined)).toBe("—");
    expect(formatPaymentMethodLabel("")).toBe("—");
  });
});
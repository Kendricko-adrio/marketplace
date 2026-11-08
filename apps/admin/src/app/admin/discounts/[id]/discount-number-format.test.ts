import { describe, expect, it } from "vitest";
import { parseMoneyInput, formatMoneyInput, parsePercentInput, formatPercentInput } from "./discount-number-format";

describe("angka editor diskon", () => {
  it.each([
    { text: "", canonical: null },
    { text: "100000", canonical: "100000" },
    { text: "Rp 100.000,00", canonical: "100000" },
    { text: "100.000", canonical: "100000" },
    { text: "000100000", canonical: "100000" },
    { text: "0", canonical: "0" },
    { text: "9.999.999.999.999,00", canonical: "9999999999999" },
  ])("membaca uang $text tanpa floating point", ({ text, canonical }) => {
    expect(parseMoneyInput(text)).toEqual({ status: "valid", canonical });
  });

  it.each(["100,000.00", "1.00", "1e5", "-100", "Rp", "10000000000000", "1,01", "1,001", "1,000", "1,", "1."])("menolak atau menahan input uang %s tanpa menebak", (text) => {
    expect(parseMoneyInput(text).status).not.toBe("valid");
  });

  it("buffer koma kosong adalah input sementara, bukan angka tersimpan", () => {
    expect(parseMoneyInput("100.000,")).toEqual({ status: "incomplete", canonical: null });
  });

  it("memformat focus/blur tanpa memaksa nol pada field kosong", () => {
    expect(formatMoneyInput("100000", false)).toBe("100.000,00");
    expect(formatMoneyInput("100000", true)).toBe("100.000");
    expect(formatMoneyInput(null, false)).toBe("");
    expect(formatMoneyInput("0", false)).toBe("0,00");
    expect(formatMoneyInput("9999999999999", false)).toBe("9.999.999.999.999,00");
  });

  it.each([
    { text: "", canonical: null },
    { text: "10", canonical: "10" },
    { text: "10%", canonical: "10" },
    { text: "12,5%", canonical: "12.5" },
    { text: "12,500000", canonical: "12.5" },
    { text: "0,000001", canonical: "0.000001" },
    { text: "100,000000", canonical: "100" },
  ])("membaca persen $text", ({ text, canonical }) => {
    expect(parsePercentInput(text)).toEqual({ status: "valid", canonical });
  });

  it.each(["12.5", "100,000001", "0", "-1", "12,1234567", "%", "1e1", "1.000"])("menolak persen %s", (text) => {
    expect(parsePercentInput(text).status).toBe("invalid");
  });

  it("mempertahankan buffer persen dan memakai koma untuk display", () => {
    expect(parsePercentInput("12,")).toEqual({ status: "incomplete", canonical: null });
    expect(formatPercentInput("12.5")).toBe("12,5");
    expect(formatPercentInput("10")).toBe("10");
    expect(formatPercentInput(null)).toBe("");
  });
});

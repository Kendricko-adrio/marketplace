import { describe, expect, it } from "vitest";
import {
  parseMoneyInput,
  formatMoneyInput,
  parsePercentInput,
  formatPercentInput,
  displayNumberInput,
  numberTypingBuffer,
} from "./discount-number-format";

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

  it("memakai buffer koma untuk display persen", () => {
    expect(displayNumberInput("12,5", "percent", true)).toBe("12,5");
    expect(displayNumberInput("10", "percent", false)).toBe("10");
    expect(displayNumberInput("", "percent", false)).toBe("");
  });
});

/** Meniru input controlled: tiap ketikan memakai teks yang tampil lalu menyimpan buffer state. */
function typeDigitByDigit(keys: string, kind: "money" | "percent" = "money") {
  let buffer = "";
  const shown: string[] = [];
  for (const key of keys) {
    const displayed = displayNumberInput(buffer, kind, true);
    buffer = numberTypingBuffer(buffer, displayed + key, kind);
    shown.push(displayNumberInput(buffer, kind, true));
  }
  return { buffer, shown, blurred: displayNumberInput(buffer, kind, false) };
}

describe("mengetik nominal rupiah", () => {
  it("memberi grouping yang hidup tanpa merusak nilainya", () => {
    const typed = typeDigitByDigit("200000");

    expect(typed.shown).toEqual(["2", "20", "200", "2.000", "20.000", "200.000"]);
    expect(typed.blurred).toBe("200.000,00");
    expect(parseMoneyInput(typed.buffer)).toEqual({ status: "valid", canonical: "200000" });
  });

  it("tetap benar setelah mengetik lewat batas ribuan berkali-kali", () => {
    const typed = typeDigitByDigit("2000000");

    expect(typed.shown.at(-1)).toBe("2.000.000");
    expect(parseMoneyInput(typed.buffer)).toEqual({ status: "valid", canonical: "2000000" });
  });

  it("menerima nominal yang ditempel lengkap dengan separator", () => {
    const buffer = numberTypingBuffer("", "Rp 20.000,00", "money");

    expect(displayNumberInput(buffer, "money", true)).toBe("20.000");
    expect(parseMoneyInput(buffer)).toEqual({ status: "valid", canonical: "20000" });
  });
});

describe("mengetik persentase diskon", () => {
  it("tidak memakan angka nol di belakang koma saat mengetik", () => {
    const typed = typeDigitByDigit("12,50", "percent");

    expect(typed.shown).toEqual(["1", "12", "12,", "12,5", "12,50"]);
    expect(typed.blurred).toBe("12,5");
    expect(parsePercentInput(typed.buffer)).toEqual({ status: "valid", canonical: "12.5" });
  });

  it("mengizinkan tepat 100", () => {
    const typed = typeDigitByDigit("100", "percent");

    expect(typed.shown.at(-1)).toBe("100");
    expect(typed.blurred).toBe("100");
    expect(parsePercentInput(typed.buffer)).toEqual({ status: "valid", canonical: "100" });
  });

  it("menolak ketikan yang membuat nilai melewati 100%", () => {
    const typed = typeDigitByDigit("150", "percent");

    expect(typed.shown).toEqual(["1", "15", "15"]);
    expect(parsePercentInput(typed.buffer)).toEqual({ status: "valid", canonical: "15" });
  });

  it("menolak pecahan di atas 100% tanpa memakan ketikan sebelumnya", () => {
    const typed = typeDigitByDigit("100,5", "percent");

    expect(typed.shown).toEqual(["1", "10", "100", "100,", "100,"]);
    expect(parsePercentInput(typed.buffer)).toEqual({ status: "incomplete", canonical: null });
  });

  it("menolak tempelan di atas 100% dan mempertahankan nilai lama", () => {
    expect(numberTypingBuffer("12,5", "150", "percent")).toBe("12,5");
    expect(numberTypingBuffer("", "12,50", "percent")).toBe("12,50");
  });
});

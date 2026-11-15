import { describe, expect, it } from "vitest";
import {
  classifyEmailTransportError,
  classifyEmailTransportResult,
} from "./order-email-client";

/**
 * Klasifikasi hasil transport email (spec §5.2 butir 4). Kegagalan definitif
 * tidak boleh diulang otomatis; gangguan sementara dan hasil tidak pasti
 * memakai batas retry yang sama. Raw transport error tidak pernah diekspos —
 * hanya kode token.
 */
describe("classifyEmailTransportResult", () => {
  it("penerima yang diterima server email berarti accepted", () => {
    expect(
      classifyEmailTransportResult({
        accepted: ["penerima@example.test"],
        rejected: [],
      })
    ).toEqual({ outcome: "accepted", code: null });
  });

  it("semua penerima ditolak berarti kegagalan definitif", () => {
    expect(
      classifyEmailTransportResult({ accepted: [], rejected: ["a@example.test"] })
    ).toEqual({ outcome: "permanent", code: "RECIPIENT_REJECTED" });
  });

  it("tanpa bukti penerimaan diperlakukan sebagai hasil tidak pasti", () => {
    expect(
      classifyEmailTransportResult({ accepted: [], rejected: [] })
    ).toEqual({ outcome: "uncertain", code: "NO_RECIPIENT_ACCEPTED" });
  });
});

describe("classifyEmailTransportError", () => {
  it.each(["EAUTH", "EENVELOPE", "EMESSAGE", "ECONFIG", "ETLS"])(
    "%s adalah kegagalan definitif",
    (code) => {
      expect(classifyEmailTransportError({ code })).toEqual({
        outcome: "permanent",
        code: `SMTP_${code}`,
      });
    }
  );

  it.each(["ECONNECTION", "EDNS", "ESOCKET", "ECONNRESET"])(
    "%s adalah gangguan sementara",
    (code) => {
      expect(classifyEmailTransportError({ code })).toEqual({
        outcome: "temporary",
        code: `SMTP_${code}`,
      });
    }
  );

  it("timeout dan error tak dikenal adalah hasil tidak pasti", () => {
    expect(classifyEmailTransportError({ code: "ETIMEDOUT" })).toEqual({
      outcome: "uncertain",
      code: "SMTP_ETIMEDOUT",
    });
    expect(classifyEmailTransportError(new Error("boom"))).toEqual({
      outcome: "uncertain",
      code: "SMTP_UNKNOWN",
    });
    expect(classifyEmailTransportError(null)).toEqual({
      outcome: "uncertain",
      code: "SMTP_UNKNOWN",
    });
  });

  it("tidak pernah membocorkan pesan transport mentah", () => {
    const result = classifyEmailTransportError({
      code: "EAUTH",
      message: "535-5.7.8 Username and Password not accepted. password=hunter2",
    });
    expect(JSON.stringify(result)).not.toContain("hunter2");
    expect(result.code).toBe("SMTP_EAUTH");
  });
});

import { describe, expect, it, vi } from "vitest";

import {
  CheckoutTaxUnavailableError,
  prepareCheckoutTax,
} from "./prepare-checkout-tax-service";
import type { CheckoutTaxDatabase } from "./jubelio-tax-config-repository";

// =========================================================
// Preflight pajak checkout — config DB strict + master provider
// =========================================================
// Expected values adalah literal dari spec PPN §5.1/§5.2: config tenant `-2`
// dengan rate website 11 dan master 11.00 adalah kombinasi sah; nilai hilang,
// malformed, rate berbeda, atau mapping keluaran yang tidak ada WAJIB memblokir
// checkout sebelum pembayaran (tidak jatuh ke No Tax/rate 0).

type ConfigRow = { key: string; value: string; type: string };

function databaseOf(rows: ConfigRow[] | null): CheckoutTaxDatabase {
  return {
    select: () => ({
      from: () => ({
        where: async () => {
          if (rows === null) throw new Error("database unavailable");
          return rows;
        },
      }),
    }),
  } as unknown as CheckoutTaxDatabase;
}

function config(overrides: Partial<Record<"taxId" | "rate", Partial<ConfigRow>>> = {}): ConfigRow[] {
  return [
    {
      key: "jubelio.salesTaxId",
      value: "-2",
      type: "number",
      ...overrides.taxId,
    },
    {
      key: "tax.ppnRatePercent",
      value: "11",
      type: "number",
      ...overrides.rate,
    },
  ];
}

function gatewayOf(
  record: { taxId: number; ratePercent: string; outputAccount: string | null } | null,
  options: { throws?: Error } = {}
) {
  return {
    getTaxRecord: vi.fn(async () => {
      if (options.throws) throw options.throws;
      return record;
    }),
  };
}

const masterPpn11 = {
  taxId: -2,
  ratePercent: "11",
  outputAccount: "2-2103 PPN Pengeluaran",
};

describe("prepareCheckoutTax", () => {
  it("menerima tax id -2 dengan rate website sama persis seperti master", async () => {
    const gateway = gatewayOf(masterPpn11);
    await expect(
      prepareCheckoutTax({ database: databaseOf(config()), salesGateway: gateway })
    ).resolves.toEqual({ taxId: -2, ratePercent: "11" });
    expect(gateway.getTaxRecord).toHaveBeenCalledWith(-2);
  });

  it("menerima kesetaraan rate kanonik 11 vs 11.00", async () => {
    await expect(
      prepareCheckoutTax({
        database: databaseOf(config({ taxId: { value: "-2" }, rate: { value: "11" } })),
        salesGateway: gatewayOf({ ...masterPpn11, ratePercent: "11.00" }),
      })
    ).resolves.toEqual({ taxId: -2, ratePercent: "11" });
  });

  it("menerima rate 0 (No Tax) tanpa akun keluaran", async () => {
    await expect(
      prepareCheckoutTax({
        database: databaseOf(config({ taxId: { value: "1" }, rate: { value: "0" } })),
        salesGateway: gatewayOf({ taxId: 1, ratePercent: "0", outputAccount: null }),
      })
    ).resolves.toEqual({ taxId: 1, ratePercent: "0" });
  });

  it("memblokir checkout bila salah satu key config hilang", async () => {
    const gateway = gatewayOf(masterPpn11);
    await expect(
      prepareCheckoutTax({
        database: databaseOf(config().filter((row) => row.key !== "jubelio.salesTaxId")),
        salesGateway: gateway,
      })
    ).rejects.toMatchObject({ code: "CHECKOUT_TAX_UNAVAILABLE", reason: "missing_config" });
    expect(gateway.getTaxRecord).not.toHaveBeenCalled();
  });

  it("memblokir checkout bila nilai config tidak valid tanpa memanggil master", async () => {
    const invalid: Array<Partial<Record<"taxId" | "rate", Partial<ConfigRow>>>> = [
      { taxId: { value: "0" } },
      { taxId: { value: "-0" } },
      { taxId: { value: "007" } },
      { taxId: { value: "1.5" } },
      { taxId: { value: "" } },
      { taxId: { value: "9007199254740993" } },
      { taxId: { value: "-2", type: "string" } },
      { rate: { value: "101" } },
      { rate: { value: "-2" } },
      { rate: { value: "11.1234567" } },
      { rate: { value: "abc" } },
      { rate: { value: "11", type: "string" } },
    ];
    for (const overrides of invalid) {
      const gateway = gatewayOf(masterPpn11);
      await expect(
        prepareCheckoutTax({
          database: databaseOf(config(overrides)),
          salesGateway: gateway,
        })
      ).rejects.toMatchObject({
        code: "CHECKOUT_TAX_UNAVAILABLE",
        reason: "config_malformed",
      });
      expect(gateway.getTaxRecord).not.toHaveBeenCalled();
    }
  });

  it("memblokir checkout bila config DB tidak dapat dibaca", async () => {
    await expect(
      prepareCheckoutTax({ database: databaseOf(null), salesGateway: gatewayOf(masterPpn11) })
    ).rejects.toMatchObject({ reason: "config_unavailable" });
  });

  it("memblokir checkout bila GET master pajak gagal", async () => {
    await expect(
      prepareCheckoutTax({
        database: databaseOf(config()),
        salesGateway: gatewayOf(null, { throws: new Error("provider down") }),
      })
    ).rejects.toMatchObject({ reason: "tax_lookup_failed" });
  });

  it("memblokir checkout bila tax id tidak ada di master", async () => {
    await expect(
      prepareCheckoutTax({ database: databaseOf(config()), salesGateway: gatewayOf(null) })
    ).rejects.toMatchObject({ reason: "tax_not_found" });
  });

  it("memblokir checkout bila rate website berbeda dari master (tanpa fallback)", async () => {
    await expect(
      prepareCheckoutTax({
        database: databaseOf(config()),
        salesGateway: gatewayOf({ ...masterPpn11, ratePercent: "12" }),
      })
    ).rejects.toMatchObject({ reason: "tax_rate_mismatch" });
  });

  it("memblokir checkout bila rate positif tidak punya mapping pajak keluaran", async () => {
    await expect(
      prepareCheckoutTax({
        database: databaseOf(config()),
        salesGateway: gatewayOf({ ...masterPpn11, outputAccount: null }),
      })
    ).rejects.toMatchObject({ reason: "tax_output_unavailable" });
  });

  it("tidak membocorkan rate/id master pada pesan error", async () => {
    const error = await prepareCheckoutTax({
      database: databaseOf(config()),
      salesGateway: gatewayOf({ ...masterPpn11, ratePercent: "12" }),
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(CheckoutTaxUnavailableError);
    const message = (error as Error).message;
    expect(message).not.toContain("12");
    expect(message).not.toContain("-2");
    expect(message).not.toContain("2-2103");
  });
});

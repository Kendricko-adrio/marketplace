/**
 * Seam H — percentage goods pada kontrak provider Sales (ticket 10).
 *
 * Pure: membandingkan DUA record immutable (pricing snapshot order dan create
 * intent provider) tanpa membaca master/config. Expected di sini adalah literal
 * independen spec §4.4: source100000 → target90000 qty2, Coupon 10% = 18000,
 * Markdown whole-line 20000, sehingga provider line disc = 38000 (sekali per
 * line, bukan 76000) dan payable 162000.
 */
import { describe, expect, it } from "vitest";
import { evaluatePricing } from "@marketplace/db/src/discount-pricing";
import {
  JubelioSalesContractError,
  assertOrderSnapshotAgreesWithIntent,
  type VersionedSalesOrderExpectation,
} from "./jubelio-sales-expected";

function percentageSnapshot() {
  return evaluatePricing({
    fulfillmentMethod: "pickup",
    ppnRatePercent: "11",
    lines: [
      {
        variantId: "variant-qty2-provider",
        quantity: 2,
        sourceUnitPrice: "100000",
        effectiveUnitPrice: "90000",
        markdownRevisionId: "revision-qty2-provider",
      },
    ],
    benefit: { kind: "percentage_goods", paramsVersion: 1, rate: "10", capAmount: null },
  });
}

function intent(overrides: Partial<VersionedSalesOrderExpectation> = {}): VersionedSalesOrderExpectation {
  return {
    providerContractVersion: 2,
    contactId: -1,
    customerName: "Customer",
    locationId: 1,
    note: "OKCIR_SO_CREATE:fixture",
    originalShipmentCost: 0,
    shippingCost: 0,
    netGoods: 162_000,
    expectedProviderPayable: 162_000,
    lines: [
      { itemId: 930_001, quantity: 2, price: 100_000, discAmount: 38_000, taxAmount: 0, unit: "Buah", taxId: 1 },
    ],
    ...overrides,
  };
}

describe("assertOrderSnapshotAgreesWithIntent — percentage goods", () => {
  it("snapshot percentage qty2 dan intent provider sepakat pada disc whole-line38000", () => {
    const snapshot = percentageSnapshot();
    expect(snapshot.sourceGoodsSubtotal).toBe("200000");
    expect(snapshot.markdownTotal).toBe("20000");
    expect(snapshot.goodsDiscount).toBe("18000");
    expect(snapshot.netGoods).toBe("162000");
    expect(snapshot.ppnAmount).toBe("17820");
    expect(snapshot.total).toBe("179820");
    expect(snapshot.expectedProviderPayable).toBe("162000");

    expect(() => assertOrderSnapshotAgreesWithIntent(intent(), snapshot)).not.toThrow();
  });

  it("selisih1 Rupiah pada disc provider ditolak sebagai drift, bukan ditoleransi", () => {
    const snapshot = percentageSnapshot();
    try {
      assertOrderSnapshotAgreesWithIntent(
        intent({
          lines: [
            { itemId: 930_001, quantity: 2, price: 100_000, discAmount: 38_001, taxAmount: 0, unit: "Buah", taxId: 1 },
          ],
        }),
        snapshot
      );
      throw new Error("expected drift rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(JubelioSalesContractError);
      expect((error as JubelioSalesContractError).code).toBe("SALES_CONTRACT_RECORD_DRIFT");
    }
  });

  it("payable/net provider yang berbeda1 Rupiah juga ditolak", () => {
    const snapshot = percentageSnapshot();
    try {
      assertOrderSnapshotAgreesWithIntent(
        intent({ netGoods: 161_999, expectedProviderPayable: 161_999 }),
        snapshot
      );
      throw new Error("expected drift rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(JubelioSalesContractError);
      expect((error as JubelioSalesContractError).code).toBe(
        "SALES_CONTRACT_RECORD_DRIFT"
      );
    }
  });
});

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
  readJubelioSalesOrderExpectation,
  readSettlementAuthorityRecord,
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

function signedLocationPayload(locationId: unknown) {
  const { lines, ...create } = intent();
  return { type: "create", create: { ...create, locationId, items: lines } };
}

describe("provider location identity", () => {
  it.each([-27, 0, 15, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER])(
    "preserves signed safe integer location %s",
    (locationId) => {
      expect(readJubelioSalesOrderExpectation(signedLocationPayload(locationId))).toMatchObject({ locationId });
    }
  );

  it.each([
    { label: "undefined", value: undefined },
    { label: "null", value: null },
    { label: "numeric string", value: "-1" },
    { label: "boolean", value: true },
    { label: "fraction", value: -1.5 },
    { label: "NaN", value: NaN },
    { label: "positive infinity", value: Infinity },
    { label: "negative infinity", value: -Infinity },
    { label: "unsafe positive integer", value: Number.MAX_SAFE_INTEGER + 1 },
    { label: "unsafe negative integer", value: Number.MIN_SAFE_INTEGER - 1 },
  ])("rejects $label without coercing the location identity", ({ value }) => {
    expect(() => readJubelioSalesOrderExpectation(signedLocationPayload(value))).toThrow(
      expect.objectContaining({
        code: "SALES_CONTRACT_SHAPE_INVALID",
        message: "sales create intent locationId must be a safe integer",
      })
    );
  });

  it("rejects an absent location instead of supplying a default", () => {
    const payload = signedLocationPayload(-1);
    const { locationId: _locationId, ...create } = payload.create;
    expect(() => readJubelioSalesOrderExpectation({ type: "create", create })).toThrow(
      expect.objectContaining({ code: "SALES_CONTRACT_SHAPE_INVALID" })
    );
  });

  it.each(["itemId", "taxId", "quantity"] as const)(
    "does not permit a negative %s when location is negative",
    (field) => {
      const payload = signedLocationPayload(-1);
      payload.create.items = payload.create.items.map((line) => ({ ...line, [field]: -1 }));
      expect(() => readJubelioSalesOrderExpectation(payload)).toThrow(
        expect.objectContaining({ code: "SALES_CONTRACT_SHAPE_INVALID" })
      );
    }
  );

  it("accepts negative location in paired immutable settlement records", () => {
    expect(readSettlementAuthorityRecord({
      createPayload: signedLocationPayload(-1),
      orderRow: {
        pricingContractVersion: 1, pricingEngineVersion: 1, providerContractVersion: 2,
        pricingSnapshot: percentageSnapshot(), fulfillmentMethod: "pickup",
        subtotal: "180000", discount: "18000", shippingCost: "0", serviceFee: "0",
        ppnRate: "11", ppnAmount: "17820", total: "179820",
      },
    })).toMatchObject({ providerContractVersion: 2, locationId: -1, expectedProviderPayable: 162_000 });
  });

  it("accepts Tangerang location -1 without remapping the stored identity", () => {
    expect(readJubelioSalesOrderExpectation(signedLocationPayload(-1))).toMatchObject({
      providerContractVersion: 2,
      locationId: -1,
      netGoods: 162_000,
      expectedProviderPayable: 162_000,
    });
  });
});

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

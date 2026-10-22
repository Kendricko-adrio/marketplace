/**
 * Seam H — subsidi ongkir pada kontrak provider Sales (ticket 11).
 *
 * Pure: dua record immutable dibandingkan tanpa master/config. Literal
 * independen spec §4.4: goods150000, ongkir quote30000, cap20000 → subsidi20000,
 * net ongkir10000, PPN16500, customer176500, provider payable160000. Booking
 * cost tetap original30000; subsidi TIDAK pernah masuk disc_amount barang.
 */
import { describe, expect, it } from "vitest";
import { evaluatePricing } from "@marketplace/db/src/discount-pricing";
import { buildSalesOrderPayload } from "./jubelio-sales-client";
import {
  assertOrderSnapshotAgreesWithIntent,
  type VersionedSalesOrderExpectation,
} from "./jubelio-sales-expected";

function shippingSnapshot() {
  return evaluatePricing({
    fulfillmentMethod: "delivery",
    ppnRatePercent: "11",
    lines: [
      {
        variantId: "variant-shipping-150000",
        quantity: 1,
        sourceUnitPrice: "150000",
        effectiveUnitPrice: "150000",
      },
    ],
    shippingBeforeSubsidy: "30000",
    providerQuotedShippingCost: "30000",
    benefit: { kind: "shipping", paramsVersion: 1, capAmount: "20000" },
  });
}

function intent(): VersionedSalesOrderExpectation {
  return {
    providerContractVersion: 2,
    contactId: -1,
    customerName: "Customer",
    locationId: 1,
    note: "OKCIR_SO_CREATE:shipping-fixture",
    originalShipmentCost: 30_000,
    shippingCost: 10_000,
    netGoods: 150_000,
    expectedProviderPayable: 160_000,
    lines: [
      { itemId: 940_001, quantity: 1, price: 150_000, discAmount: 0, taxAmount: 0, unit: "Buah", taxId: 1 },
    ],
  };
}

describe("provider shipping — subsidi bukan line discount", () => {
  it("snapshot dan intent sepakat pada original30000/net10000/payable160000 tanpa drift", () => {
    const snapshot = shippingSnapshot();
    expect(snapshot.shippingBeforeSubsidy).toBe("30000");
    expect(snapshot.shippingSubsidy).toBe("20000");
    expect(snapshot.shippingCost).toBe("10000");
    expect(snapshot.total).toBe("176500");
    expect(snapshot.expectedProviderPayable).toBe("160000");
    expect(() => assertOrderSnapshotAgreesWithIntent(intent(), snapshot)).not.toThrow();
  });

  it("request SO memakai original_shipment_cost/net shipping, grand_total net, add_disc0, tanpa shipping_cost_discount", () => {
    const payload = buildSalesOrderPayload({
      contactId: -1,
      customerName: "Customer",
      locationId: 1,
      note: "OKCIR_SO_CREATE:shipping-fixture",
      refNo: "shipping-fixture",
      items: [
        { itemId: 940_001, quantity: 1, price: 150_000, discAmount: 0, taxAmount: 0, unit: "Buah", taxId: 1 },
      ],
      providerContractVersion: 2,
      originalShipmentCost: 30_000,
      shippingCost: 10_000,
      expectedProviderPayable: 160_000,
    });
    expect(payload).toMatchObject({
      original_shipment_cost: 30_000,
      shipping_cost: 10_000,
      grand_total: 160_000,
      sub_total: 150_000,
      total_disc: 0,
      total_tax: 0,
      add_disc: 0,
      add_fee: 0,
      service_fee: 0,
    });
    expect(payload).not.toHaveProperty("shipping_cost_discount");
    // Subsidi tidak pernah masuk disc_amount barang (bukan kedua kali).
    expect((payload.items as Array<{ disc_amount: number }>)[0].disc_amount).toBe(0);
  });

  it("selisih1 Rupiah pada net shipping provider ditolak sebagai drift", () => {
    const snapshot = shippingSnapshot();
    expect(() =>
      assertOrderSnapshotAgreesWithIntent({ ...intent(), shippingCost: 9_999 }, snapshot)
    ).toThrow(/net shipping/);
  });
});

import { describe, expect, it } from "vitest";
import { calculateLineItemSubtotal, calculateOrderPricing } from "./order-pricing";
import { compareDeliveryApproval, createDeliverySnapshot } from "./delivery-order";

// =========================================================
// delivery-order — the immutable delivery snapshot + re-approval gate
// (ticket 04, spec Ready "Harga dan UX quote" + "Penyimpanan").
//
// Proposed PUBLIC SEAM (implemented by main in lib/delivery-order.ts):
//   createDeliverySnapshot({address, origin, parcel, service, pricing}) →
//     a deep-independent JSON payload (the `orders.delivery_snapshot` JSONB)
//     holding exactly {address, origin, parcel, pricing, service} — NO quote
//     id, NO ttl, NO prepared-readiness flag.
//   compareDeliveryApproval(approvedPricing, currentPricing) →
//     { approved: boolean; changedFields: string[] } — the Buat-pesanan gate:
//     approved ONLY when EVERY money field of the order-pricing reuse matches
//     what the customer approved at checkout; a changed field list supports
//     the re-approval flow ("Ongkir telah berubah…" → klik kedua).
//
// Independent worked case (spec): goods Rp100.000 + ongkir Rp20.000 at PPN
// 11% → PPN Rp13.200 (ceil) and total Rp133.200 — money strings reused from
// the order-pricing module, never recomputed here.
//
// RED until the module exists.
// =========================================================

const ADDRESS_INPUT = {
  recipientName: "Budi Penerima",
  phone: "081299999999",
  fullAddress: "Jl. Tujuan No. 9",
  provinceId: "01",
  province: "Fixture Province",
  cityId: "0101",
  city: "Fixture City",
  districtId: "010101",
  district: "Fixture District",
  areaId: "01010101",
  area: "Fixture Area",
  postalCode: "01234",
  isDefault: true,
};

const ORIGIN_INPUT = {
  branchId: "branch-e2e",
  name: "E2E Origin Delivery Branch",
  phone: "021999888777",
  address: "Jl. Origin E2E No. 7, Gudang B",
  zipcode: "10110",
  areaId: "01010101",
};

const PARCEL_INPUT = {
  weight: 290, // 1 × 250 master grams + 40 kemasan
  items: [
    {
      item_name: "Delivery Anchor",
      quantity: 1,
      value: 100000,
      weight: 250,
      length: 30,
      width: 20,
      height: 10,
    },
  ],
};

const SERVICE_INPUT = {
  courierId: 13,
  serviceId: 1327,
  name: "JNE REG Fixture",
  shippingCost: "20000.00",
};

const PRICING_INPUT = calculateOrderPricing({
  subtotal: calculateLineItemSubtotal([{ price: "100000.00", quantity: 1 }]),
  shippingCost: "20000.00",
  fulfillmentMethod: "delivery",
  ppnRatePercent: "11",
});
// Independent literals per the spec worked case:
//   taxable 120.000 × 11% → PPN 13.200 → total 133.200.
const APPROVED_PPN = "13200.00";
const APPROVED_TOTAL = "133200.00";

describe("createDeliverySnapshot", () => {
  it("freezes the quoted delivery money exactly (goods 100k + ongkir 20k, PPN 11% → 13.200/133.200) with no quote id or ttl", () => {
    const snapshot = createDeliverySnapshot({
      address: { ...ADDRESS_INPUT },
      origin: { ...ORIGIN_INPUT },
      parcel: structuredClone(PARCEL_INPUT),
      service: { ...SERVICE_INPUT },
      pricing: { ...PRICING_INPUT },
    });

    // The snapshot is exactly the five immutable blocks — NO quote id/ttl.
    expect(Object.keys(snapshot).sort()).toEqual([
      "address",
      "origin",
      "parcel",
      "pricing",
      "service",
    ]);
    expect(snapshot.pricing.ppnAmount).toBe(APPROVED_PPN);
    expect(snapshot.pricing.total).toBe(APPROVED_TOTAL);
    expect(snapshot.service.shippingCost).toBe("20000.00");
  });

  it("stays deep-independent: mutating the live book address, origin, master parcel, service or pricing after the order never changes the taken snapshot", () => {
    const address = { ...ADDRESS_INPUT };
    const origin = { ...ORIGIN_INPUT };
    const parcel: typeof PARCEL_INPUT = structuredClone(PARCEL_INPUT);
    parcel.items = [...PARCEL_INPUT.items];
    const service = { ...SERVICE_INPUT };
    const pricing = { ...PRICING_INPUT };

    const snapshot = createDeliverySnapshot({ address, origin, parcel, service, pricing });
    const frozen = JSON.stringify(snapshot);

    // The LIVE world drifts after the order was placed — including NESTED
    // members (parcel items), the aliasing trap for a shallow snapshot.
    address.fullAddress = "Jl. DIUBAHH Setelah Order";
    address.areaId = "99999999";
    address.postalCode = "99999";
    origin.phone = "000";
    origin.zipcode = "99999";
    parcel.weight = 1;
    parcel.items[0].weight = 1;
    parcel.items[0].quantity = 77;
    service.shippingCost = "30000.00";
    service.name = "Berubah";
    pricing.ppnAmount = "999.00";
    pricing.total = "999.00";

    // The TAKEN snapshot is untouched by every drift above (deep copy).
    expect(JSON.stringify(snapshot)).toBe(frozen);
    expect(snapshot.pricing.ppnAmount).toBe(APPROVED_PPN);
    expect(snapshot.pricing.total).toBe(APPROVED_TOTAL);
    expect(snapshot.service.shippingCost).toBe("20000.00");
    expect(snapshot.service.name).toBe("JNE REG Fixture");
    expect(snapshot.origin.phone).toBe("021999888777");
    expect(snapshot.parcel.items[0].weight).toBe(250);
    expect(snapshot.address.fullAddress).toBe("Jl. Tujuan No. 9");
  });

  it("preserves leading-zero string region ids and the canonical region block in the persisted payload", () => {
    const snapshot = createDeliverySnapshot({
      address: { ...ADDRESS_INPUT },
      origin: { ...ORIGIN_INPUT },
      parcel: structuredClone(PARCEL_INPUT),
      service: { ...SERVICE_INPUT },
      pricing: { ...PRICING_INPUT },
    });

    // Shipment identifiers stay STRINGS incl. leading zeros (never numbers).
    expect(snapshot.address.areaId).toBe("01010101");
    expect(snapshot.address.postalCode).toBe("01234");
    expect(snapshot.origin.areaId).toBe("01010101");
    expect(snapshot.address.province).toBe("Fixture Province");
    expect(snapshot.address.area).toBe("Fixture Area");
    // The persisted column is a plain JSON payload — roundtrip exact.
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
  });
});

describe("compareDeliveryApproval", () => {
  it("approves only when EVERY money field of the re-derived pricing matches the approved snapshot", () => {
    const approved = { ...PRICING_INPUT };
    const current = { ...PRICING_INPUT }; // server re-derived, same money
    expect(compareDeliveryApproval(approved, current)).toEqual({
      approved: true,
      changedFields: [],
    });
  });

  it("rejects and names every changed money field when the quoted rates moved", () => {
    const approved = { ...PRICING_INPUT };
    // Mocked rates moved 20.000 → 30.000 between quote and Buat pesanan:
    // base 130.000 → PPN 14.300 → total 144.300 (independent literals).
    const current = calculateOrderPricing({
      subtotal: "100000.00",
      shippingCost: "30000.00",
      fulfillmentMethod: "delivery",
      ppnRatePercent: "11",
    });
    const verdict = compareDeliveryApproval(approved, current);
    expect(verdict.approved).toBe(false);
    expect(verdict.changedFields).toEqual(
      expect.arrayContaining(["shippingCost", "ppnAmount", "total", "taxableBase"])
    );
    // The re-approval numbers themselves are the spec's worked case.
    expect(current.ppnAmount).toBe("14300.00");
    expect(current.total).toBe("144300.00");
  });

  it("ignores non-money baggage (no quote id/ttl) and fails closed on unknown/missing money fields", () => {
    const approved = { ...PRICING_INPUT };
    expect(
      compareDeliveryApproval(approved, {
        ...(approved as unknown as Record<string, unknown>),
        quoteId: "vendor-quote-123",
        ttlSeconds: 900,
      } as unknown as typeof approved).approved
    ).toBe(true);

    // A pricing object that loses a money field cannot silently approve.
    const missing = { ...approved } as Partial<typeof approved>;
    delete missing.total;
    const verdict = compareDeliveryApproval(approved, missing as typeof approved);
    expect(verdict.approved).toBe(false);
  });
});
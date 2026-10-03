import { describe, expect, it } from "vitest";
import { quoteDelivery } from "./delivery-quote";
import type { ShipmentDimensions } from "./shipment-parcel";

// =========================================================
// quoteDelivery — backend quote seam for the checkout delivery choice
// (ticket 03, spec Ready "Harga dan UX quote").
//
// PUBLIC SEAM (proposed): quoteDelivery(input, gateway) → { services }
//
//   input: {
//     branch: { id, ...local shipping-origin complement (name/status/
//              shippingPhone/shippingAddress/shippingPostalCode/
//              shippingAreaId) },
//     items: [{ branchId, itemName, quantity, value, dimensions }],
//     destination: canonical ClientAddressView (verified region chain),
//     fallback: ShipmentDimensions | null,
//     packagingWeight: number,
//     ppnRatePercent: number,
//   }
//   gateway.rates(request) → raw vendor rates[] (the ONLY external boundary
//   mocked here — same mock boundary style as the branch/parcel seams).
//
// Contract under test:
// - The request carries origin + destination (zipcode/area_id from the
//   canonical address) + the worked weight — money NEVER comes from the
//   browser; the server re-derives subtotal/weights server-side.
// - The quoted ongkir is the vendor `rates` — `final_rates` (discounted) is
//   NEVER honored: independent worked case goods Rp100.000 + rates Rp20.000
//   (final_rates Rp10.000 as a trap) → website PPN 11% Rp13.200 and total
//   Rp133.200 (PPN delivery taxes goods + ongkir, rounded up per Rupiah —
//   reuses the existing order-pricing strings).
// - Insurance fail-closed: a rate carrying unknown NON-EMPTY insurance
//   metadata (`insurance_info`, documented in the attributes table but
//   absent from samples — semantics unknown) is EXCLUDED. The exclusion test
//   probes the metadata AS OPAQUE (arbitrary non-empty content), never an
//   assumed required-key shape; `insurance_info: null` stays includable.
// - Invalid / cross-branch cart throws BEFORE the gateway is touched
//   (gateway must never be consulted for an illegitimate cart).
// - Failed / malformed / EMPTY quote lists throw — never a stale or zero
//   ongkir fallback.
// - The quote carries NO ID and NO TTL (no invented quote contract).
//
// RED until apps/store/src/lib/delivery-quote.ts exists. Expected values are
// the independent literals below (worked examples by hand), never recomputed
// from the implementation.
// =========================================================

const BRANCH = {
  id: "branch-origin",
  name: "Cabang Jakarta Pusat",
  status: "aktif",
  shippingPhone: "021999888777",
  shippingAddress: "Jl. Origin E2E No. 7, Gudang B",
  shippingPostalCode: "10110",
  shippingAreaId: "01010101",
} as const;

const FALLBACK: ShipmentDimensions = {
  weight: 100,
  length: 15,
  width: 10,
  height: 5,
};

// Two-SKU cart on the single origin branch; worked weight example:
// 2 × 250 g + 1 × 100 g (fallback) + 40 g kemasan = 840 g.
const ITEMS = [
  {
    branchId: "branch-origin",
    itemName: "Grip Pro",
    quantity: 2,
    value: 40000,
    dimensions: { weight: 250, length: 30, width: 20, height: 10 },
  },
  {
    branchId: "branch-origin",
    itemName: "Band Wide",
    quantity: 1,
    value: 20000,
    dimensions: null,
  },
];

const DESTINATION = {
  id: "addr-e2e",
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
} as const;

const BASE_INPUT = {
  branch: BRANCH,
  items: ITEMS,
  destination: DESTINATION,
  fallback: FALLBACK,
  packagingWeight: 40,
  ppnRatePercent: 11,
  // goods subtotal = 40000 × 2 + 20000 = 100000 — the spec's controlled case.
} as const;

const JNE_REG = {
  courier_id: 13,
  courier_name: "JNE",
  courier_service_id: 1327,
  courier_service_code: "REG",
  courier_service_name: "JNE REG Fixture",
  courier_service_category: 1,
  // The independent trap of the spec: final_rates is HALF of rates — the
  // quote must read `rates` only.
  rates: 20000,
  final_rates: 10000,
  eta_from: null,
  eta_to: null,
  is_cod_supported: false,
  shipping_insurance: null,
} as const;

const NEUTRAL_SERVICE = {
  courier_id: 21,
  courier_name: "SiCepat",
  courier_service_id: 2101,
  courier_service_code: "REG",
  courier_service_name: "SiCepat Regular Fixture",
  courier_service_category: 1,
  rates: 25000,
  final_rates: 25000,
  eta_from: null,
  eta_to: null,
  is_cod_supported: false,
  shipping_insurance: null,
  // Explicitly empty insurance metadata: presence of the FIELD is fine —
  // only non-empty content is the unknown-semantics fail-closed trigger.
  insurance_info: null,
} as const;

const INSURED_SERVICE = {
  courier_id: 42,
  courier_name: "Kurir Asuransi",
  courier_service_id: 4201,
  courier_service_code: "SI",
  courier_service_name: "Kurir Asuransi Wajib",
  courier_service_category: 1,
  rates: 15000,
  final_rates: 5000,
  eta_from: null,
  eta_to: null,
  is_cod_supported: false,
  shipping_insurance: null,
  // OPAQUE vendor metadata — the test asserts exclusion by non-emptiness
  // WITHOUT assuming any required-key semantics.
  insurance_info: { shape: "arbitrary-and-unknown", level: 7 },
} as const;

describe("quoteDelivery", () => {
  it("builds the server-side rates request and selects vendor `rates` (never final_rates), pricing goods+ongkir as order-pricing strings", async () => {
    const recorder = recordingGateway([JNE_REG, NEUTRAL_SERVICE, INSURED_SERVICE]);

    const quote = await quoteDelivery(BASE_INPUT, recorder.gateway);

    // Server-side request: origin from the branch complement, destination
    // from the verified canonical address, worked weight 2×250 + 1×100 + 40.
    expect(recorder.calls).toHaveLength(1);
    expect(recorder.calls[0]).toMatchObject({
      origin: { name: "Cabang Jakarta Pusat", zipcode: "10110" },
      destination: { zipcode: "01234", area_id: "01010101" },
      weight: 640,
    });

    // The quote has NO id and NO ttl — the only key is the service list.
    expect(Object.keys(quote).sort()).toEqual(["services"]);

    // Opaque insurance metadata + the required-insurance signal exclude their
    // services; two honest services survive. The test locates them by name —
    // no fixed-order assumption.
    expect(quote.services).toHaveLength(2);

    const jne = quote.services.find((service) =>
      String(service.name).includes("JNE REG")
    );
    expect(jne, "the honest JNE REG Fixture service must survive").toBeTruthy();
    expect(jne).toMatchObject({
      courierId: 13,
      serviceId: 1327,
    });
    expect(
      Number(jne!.shippingCost),
      "ongkir must be vendor `rates`, never final_rates"
    ).toBe(20000);
    expect(jne!.shippingCost).not.toBe(null);
    // Pricing reuses the order-pricing strings (subtotal + shipping PPN at
    // 11%, per-Rupiah rounding up): 13200 = ceil(120.000 × 11%), 133.200 total.
    expect(jne!.pricing).toMatchObject({
      subtotal: "100000.00",
      ppnAmount: "13200.00",
      total: "133200.00",
    });

    const other = quote.services.find((service) =>
      String(service.name).includes("SiCepat Regular")
    );
    expect(other, "the neutral insurance_info=null service must survive").toBeTruthy();
    expect(Number(other!.shippingCost)).toBe(25000);
    // 100.000 + 25.000 = 125.000 taxable → PPN 13.750 → total 138.750.
    expect(other!.pricing).toMatchObject({
      subtotal: "100000.00",
      ppnAmount: "13750.00",
      total: "138750.00",
    });
  });

  it("excludes rate services carrying non-empty unknown insurance metadata (fail closed, opaque probe)", async () => {
    const recorder = recordingGateway([JNE_REG, INSURED_SERVICE]);

    const quote = await quoteDelivery(BASE_INPUT, recorder.gateway);

    expect(quote.services).toHaveLength(1);
    expect(quote.services.map((service) => String(service.name)).join(" | ")).not.toContain(
      "Kurir Asuransi"
    );
    expect(Number(quote.services[0].shippingCost)).toBe(20000);
  });

  it("throws for a cross-branch cart BEFORE consulting the gateway", async () => {
    const recorder = recordingGateway([JNE_REG]);
    const crossBranch = {
      ...BASE_INPUT,
      items: [{ ...ITEMS[0], branchId: "branch-other" }],
    };

    await expect(quoteDelivery(crossBranch, recorder.gateway)).rejects.toThrow();
    // The gateway must never be consulted for an illegitimate cart.
    expect(recorder.calls).toHaveLength(0);
  });

  it("throws for failed, malformed or empty rate responses — no stale or zero ongkir", async () => {
    // Empty vendor quote list.
    await expect(
      quoteDelivery(BASE_INPUT, recordingGateway([]).gateway)
    ).rejects.toThrow();
    // Gateway failure propagates as a quote failure (no zero ongkir).
    await expect(
      quoteDelivery(
        BASE_INPUT,
        recordingGateway(new Error("rates all failed")).gateway
      )
    ).rejects.toThrow("rates failed");
    // Malformed rate row (missing `rates`) — the only usable service must not
    // be invented from zeros.
    await expect(
      quoteDelivery(
        BASE_INPUT,
        recordingGateway([{ ...JNE_REG, rates: undefined }]).gateway
      )
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Test doubles (external boundary ONLY: the Shipment rates quote)
// ---------------------------------------------------------------------------

function recordingGateway(rateList: unknown): {
  calls: unknown[];
  gateway: {
    rates: (request: unknown) => Promise<unknown[]>;
  };
} {
  const calls: unknown[] = [];
  return {
    calls,
    gateway: {
      rates: async (request: unknown) => {
        calls.push(request);
        if (rateList instanceof Error) throw rateList;
        return rateList as unknown[];
      },
    },
  };
}
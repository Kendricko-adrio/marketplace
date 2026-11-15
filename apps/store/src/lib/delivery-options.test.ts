import { describe, expect, it } from "vitest";
import { formatDeliveryEta, getDeliveryOptionsPage } from "./delivery-options";

// Public display seam: sort all quoted options before taking five per page.
describe("delivery options pagination", () => {
  it("shows the five cheapest options first without changing the quote list", () => {
    const options = [
      { name: "Express", shippingCost: 100000 },
      { name: "Regular A", shippingCost: 20000 },
      { name: "Economy", shippingCost: 9000 },
      { name: "Regular B", shippingCost: 15000 },
      { name: "Regular C", shippingCost: 12000 },
      { name: "Regular D", shippingCost: 25000 },
      { name: "Regular E", shippingCost: 18000 },
    ];
    const first = getDeliveryOptionsPage(options, 1);
    expect(first.options.map((row) => row.name)).toEqual([
      "Economy", "Regular C", "Regular B", "Regular E", "Regular A",
    ]);
    expect(first).toMatchObject({ page: 1, pageCount: 2, start: 1, end: 5, total: 7, cheapestCost: 9000 });
    expect(getDeliveryOptionsPage(options, 2).options.map((row) => row.name)).toEqual(["Regular D", "Express"]);
    expect(options[0].name).toBe("Express");
  });

  it("filters official categories before sorting/pagination and finds the cheapest within the active group", () => {
    const options = [
      { name: "Regular F", serviceCategoryId: 1, shippingCost: 15000 },
      { name: "Next Day B", serviceCategoryId: 3, shippingCost: 20000 },
      { name: "Economy B", serviceCategoryId: 2, shippingCost: 11000 },
      { name: "Regular A", serviceCategoryId: 1, shippingCost: 10000 },
      { name: "Same Day A", serviceCategoryId: 5, shippingCost: 7000 },
      { name: "Economy D", serviceCategoryId: 2, shippingCost: 13000 },
      { name: "Regular C", serviceCategoryId: 1, shippingCost: 12000 },
      { name: "Economy E", serviceCategoryId: 2, shippingCost: 14000 },
      { name: "Next Day A", serviceCategoryId: 3, shippingCost: 9000 },
      { name: "Cargo", serviceCategoryId: 6, shippingCost: 9999 },
      { name: "Unknown category", serviceCategoryId: 99, shippingCost: 5000 },
      { name: "Same Day name without metadata", shippingCost: 6000 },
      { name: "Instant", serviceCategoryId: 4, shippingCost: 8000 },
      { name: "Truck", serviceCategoryId: 7, shippingCost: 30000 },
    ];
    const first = getDeliveryOptionsPage(options, 1, "regular-economy");
    expect(first.options.map((row) => row.name)).toEqual([
      "Regular A", "Economy B", "Regular C", "Economy D", "Economy E",
    ]);
    expect(first).toMatchObject({ total: 6, pageCount: 2, cheapestCost: 10000,
      categoryCounts: { all: 14, "regular-economy": 6, nextday: 2, sameday: 1, instant: 1, other: 4 },
    });
    expect(getDeliveryOptionsPage(options, 2, "regular-economy").options.map((row) => row.name)).toEqual(["Regular F"]);
    expect(getDeliveryOptionsPage(options, 1, "nextday").options.map((row) => row.name)).toEqual(["Next Day A", "Next Day B"]);
    expect(getDeliveryOptionsPage(options, 1, "other").options.map((row) => row.name)).toEqual([
      "Unknown category", "Same Day name without metadata", "Cargo", "Truck",
    ]);
    expect(options[0].name).toBe("Regular F");
  });

  it("clamps the page after a shorter quote and handles empty/single-page lists", () => {
    expect(getDeliveryOptionsPage([{ shippingCost: 9000 }], 4)).toMatchObject({
      page: 1, pageCount: 1, start: 1, end: 1, total: 1,
    });
    expect(getDeliveryOptionsPage([], 2)).toMatchObject({
      page: 1, pageCount: 1, start: 0, end: 0, total: 0, options: [],
    });
    expect(getDeliveryOptionsPage([{ shippingCost: 9000 }], 0).page).toBe(1);
  });
});

describe("delivery arrival estimate", () => {
  it.each([
    ["2026-10-06T09:18:03.751Z", "2026-10-11T09:18:03.751Z", "Estimasi tiba 6–11 Okt 2026"],
    ["2026-10-06T00:00:00Z", "2026-10-06T09:00:00Z", "Estimasi tiba 6 Okt 2026"],
    ["2026-10-31T00:00:00Z", "2026-11-02T00:00:00Z", "Estimasi tiba 31 Okt–2 Nov 2026"],
    ["2026-12-31T00:00:00Z", "2027-01-02T00:00:00Z", "Estimasi tiba 31 Des 2026–2 Jan 2027"],
    // Both instants fall on October 7 in WIB, regardless of browser timezone.
    ["2026-10-06T18:00:00Z", "2026-10-07T01:00:00Z", "Estimasi tiba 7 Okt 2026"],
    ["not-a-date", "2026-10-11T00:00:00Z", "Estimasi tiba belum tersedia"],
    ["2026-10-11T00:00:00Z", "2026-10-06T00:00:00Z", "Estimasi tiba belum tersedia"],
  ])("formats %s through %s as %s", (from, to, expected) => {
    expect(formatDeliveryEta({ from, to })).toBe(expected);
  });

  it("does not invent an ETA when the provider omits it", () => {
    expect(formatDeliveryEta(undefined)).toBe("Estimasi tiba belum tersedia");
  });
});

import { describe, expect, it } from "vitest";
import {
  getCustomerTrackingDetail,
  getTrackingStatusLabel,
  newestTrackingEvents,
  type OrderTimelineEvent,
} from "./order-tracking-presentation";

// Nilai harapan diambil langsung dari tabel mapping di plan
// `.scratch/orders-presentation/plan/customer-order-detail-redesign.md`
// (sumber independen), bukan dihitung ulang dari implementasi.
describe("getTrackingStatusLabel", () => {
  it.each([
    ["WAITING", "Menunggu kurir"],
    ["CONFIRMED_BY_COURIER", "Kurir dikonfirmasi"],
    ["ON_THE_WAY_PICK_UP", "Kurir menuju lokasi pengambilan"],
    ["ON_THE_WAY_PICKUP", "Kurir menuju lokasi pengambilan"],
    ["PICKED_UP", "Paket diambil kurir"],
    ["ON_DELIVERY", "Dalam pengantaran"],
    ["DELIVERED", "Paket telah diterima"],
    ["ON_HOLD", "Pengiriman tertunda"],
    ["RETURNED", "Paket dikembalikan"],
    ["CANCELED", "Pengiriman dibatalkan"],
    ["SHIPMENT_ISSUE", "Pengiriman mengalami kendala"],
  ])("maps the provider status %s to a customer label", (status, label) => {
    expect(getTrackingStatusLabel(status)).toBe(label);
  });

  it.each([null, "", "SOME_FUTURE_CODE"])(
    "never leaks an unknown or missing code as a heading (%s)",
    (status) => {
      expect(getTrackingStatusLabel(status)).toBe("Pembaruan pengiriman");
    }
  );
});

describe("getCustomerTrackingDetail", () => {
  it("keeps an informative courier detail as-is", () => {
    expect(getCustomerTrackingDetail("Paket diambil kurir uji")).toBe(
      "Paket diambil kurir uji"
    );
  });

  it("hides the repo simulator marker", () => {
    expect(
      getCustomerTrackingDetail("Simulasi webhook Jubelio: ON_DELIVERY")
    ).toBeNull();
    expect(
      getCustomerTrackingDetail("simulasi webhook jubelio: PICKED_UP")
    ).toBeNull();
  });

  it("returns null for a missing detail", () => {
    expect(getCustomerTrackingDetail(null)).toBeNull();
  });
});

describe("newestTrackingEvents", () => {
  const event = (status: string, at: string | null): OrderTimelineEvent => ({
    status,
    detail: null,
    at,
  });

  it("shows a copy in reverse order so the latest receipt comes first", () => {
    const oldest = event("WAITING", "2026-10-01T01:00:00Z");
    const middle = event("PICKED_UP", "2026-10-01T02:00:00Z");
    const latest = event("ON_DELIVERY", "2026-10-01T03:00:00Z");
    const timeline = [oldest, middle, latest];

    expect(newestTrackingEvents(timeline)).toEqual([latest, middle, oldest]);
  });

  it("does not reorder the source array in place", () => {
    const timeline = [
      event("WAITING", "2026-10-01T01:00:00Z"),
      event("PICKED_UP", "2026-10-01T02:00:00Z"),
    ];
    const source = [...timeline];

    newestTrackingEvents(timeline);

    expect(timeline).toEqual(source);
  });

  it("keeps a null timestamp in its delivered order instead of guessing", () => {
    const withoutTime = event("ON_HOLD", null);
    const later = event("RETURNED", "2026-10-01T04:00:00Z");

    expect(newestTrackingEvents([withoutTime, later])).toEqual([
      later,
      withoutTime,
    ]);
  });

  it("returns an empty list for a shipment without events", () => {
    expect(newestTrackingEvents([])).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { extractPlaceOrderFields, parsePlaceOrderBody } from "./place-order-input";

const pickup = {
  phone: "081234567890", email: "test@example.invalid", pickupDate: "2030-01-01",
  pickupTime: "10:00", selectedItemIds: ["item-0"],
};
const delivery = {
  fulfillmentMethod: "delivery", contactPhone: pickup.phone, contactEmail: pickup.email,
  itemIds: ["item-0"], addressId: "address", courierId: 1, serviceId: 2,
  approvedPricing: {}, originFingerprint: "a".repeat(64),
};

describe("place-order method-aware input contract", () => {
  it("parses pickup without inventing a delivery body", () => {
    const parsed = parsePlaceOrderBody(pickup, undefined);
    expect(parsed.success).toBe(true);
    if (!parsed.success) throw new Error("Pickup must parse");
    expect(extractPlaceOrderFields(parsed.data, false)).toEqual({
      phone: "081234567890", email: "test@example.invalid", selectedItemIds: ["item-0"],
      pickupDate: "2030-01-01", pickupTime: "10:00", deliveryBody: null,
    });
  });
  it("parses delivery contact and selection without pickup slots", () => {
    const parsed = parsePlaceOrderBody(delivery, "delivery");
    expect(parsed.success).toBe(true);
    if (!parsed.success) throw new Error("Delivery must parse");
    expect(extractPlaceOrderFields(parsed.data, true)).toEqual({
      phone: "081234567890", email: "test@example.invalid", selectedItemIds: ["item-0"],
      pickupDate: null, pickupTime: null, deliveryBody: delivery,
    });
  });
  it("normalizes request keys without normalizing contact fields", () => {
    const parsed = parsePlaceOrderBody({ ...pickup,
      requestKey: "A1200000-0000-4000-8000-000000000023", phone: " 0812345678 ",
    }, "pickup");
    expect(parsed.success).toBe(true);
    if (!parsed.success) throw new Error("Pickup must parse");
    expect(parsed.data.requestKey).toBe("a1200000-0000-4000-8000-000000000023");
    expect(extractPlaceOrderFields(parsed.data, false).phone).toBe(" 0812345678 ");
  });
  it.each([
    { ...pickup, selectedItemIds: [] },
    { ...pickup, selectedItemIds: ["same", "same"] },
    { ...pickup, selectedItemIds: Array.from({ length: 51 }, (_, i) => `item-${i}`) },
    { ...pickup, selectedItemIds: ["a".repeat(129)] },
    { ...pickup, phone: "123" },
    { ...pickup, email: "invalid" },
    { ...pickup, requestKey: "invalid" },
    { ...pickup, reviewToken: "" },
    { ...pickup, acknowledgements: { promoIncrease: true } },
    { ...pickup, acknowledgements: { promoIncrease: { candidateFingerprint: "A".repeat(64) } } },
    { ...pickup, acknowledgements: { unexpected: {} } },
    { ...pickup, promoSelection: { kind: "public" } },
    { ...pickup, promoSelection: { kind: "manual", code: "" } },
    { ...pickup, promoSelection: { kind: "none", code: "unexpected" } },
  ])("rejects invalid pickup input %#", (body) => {
    expect(parsePlaceOrderBody(body, undefined).success).toBe(false);
  });
  it.each([
    { kind: "none" }, { kind: "public", offerId: "offer" }, { kind: "manual", code: "SAVE" },
  ])("preserves the single promo selection ($kind)", (promoSelection) => {
    const parsed = parsePlaceOrderBody({ ...pickup, promoSelection }, undefined);
    expect(parsed.success).toBe(true);
    if (!parsed.success) throw new Error("Selection must parse");
    expect(parsed.data.promoSelection).toEqual(promoSelection);
  });
  it.each([
    { ...delivery, pickupDate: "2030-01-01" },
    { ...delivery, courierId: 1.5 },
    { ...delivery, addressId: "" },
    { ...delivery, originFingerprint: "bad" },
    { ...delivery, approvedPricing: { total: null } },
    { ...delivery, saveAddress: true },
  ])("rejects invalid delivery approval %#", (body) => {
    expect(parsePlaceOrderBody(body, "delivery").success).toBe(false);
  });
  it("keeps non-delivery method values on the legacy pickup parser", () => {
    expect(parsePlaceOrderBody(pickup, "unknown").success).toBe(true);
    expect(parsePlaceOrderBody({ ...pickup, fulfillmentMethod: "pickup" }, "pickup").success).toBe(false);
  });
});

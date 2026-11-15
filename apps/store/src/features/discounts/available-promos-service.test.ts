import { expect, it } from "vitest";
import { readAvailablePromoPage } from "./available-promos-service";

it.each(["-1", "oops", "0.5", "10000000000000"])("rejects malformed advisory shipping %s before reading the cart", async shippingBeforeSubsidy => {
  await expect(readAvailablePromoPage({
    clientId: "customer", selectedItemIds: ["item"],
    fulfillment: { fulfillmentMethod: "delivery", shippingBeforeSubsidy }, page: 1,
  })).rejects.toMatchObject({ code: "INPUT_INVALID", message: "Ongkir promo tidak valid." });
});

it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])("rejects invalid numbered page %s before accessing persistence", async page => {
  await expect(readAvailablePromoPage({
    clientId: "customer", selectedItemIds: ["item"], fulfillment: { fulfillmentMethod: "pickup" }, page,
  })).rejects.toMatchObject({ code: "INPUT_INVALID", message: "Halaman promo tidak valid." });
});

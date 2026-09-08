import { describe, expect, it } from "vitest";
import { orderCompletedEmailHTML, orderCompletedEmailText } from "./email-templates-order";

const props = {
  order: {
    id: "12345678-order",
    total: "111000.00",
    subtotal: "100000.00",
    serviceFee: "0.00",
    ppnRate: "11.000000",
    ppnAmount: "11000.00",
    pickupDate: null,
    pickupTime: null,
  },
  items: [{ productName: "Sepatu", variantInfo: null, price: "100000.00", quantity: 1 }],
};

describe("order emails", () => {
  it("shows the order's immutable PPN snapshot in HTML and text", () => {
    expect(orderCompletedEmailHTML(props)).toContain("PPN (11%)");
    expect(orderCompletedEmailHTML(props)).toContain("Rp 11.000");
    expect(orderCompletedEmailText(props)).toContain("PPN (11%): Rp 11.000");
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { buildPricingSnapshot } from "@/lib/versioned-pricing";
import { buildJubelioSalesCreateRequest } from "./place-order-jubelio-request";

const selectedItems = [{ variantId: "variant", jubelioItemId: 101, quantity: 2, variantPrice: "1000" }];
const input = { selectedItems, branch: { jubelioLocationId: 7 }, sessionUserName: "Customer", orderId: "order", createReference: "reference", legacyProviderTaxId: 1 };
afterEach(() => vi.unstubAllEnvs());
describe("place-order Jubelio create payload", () => {
  it("preserves legacy source price, fallback customer and per-line unit", () => {
    vi.stubEnv("JUBELIO_ITEM_UNIT", " Pair ");
    expect(buildJubelioSalesCreateRequest({ ...input, sessionUserName: "", pricingSnapshot: null })).toEqual({
      contactId: -1, customerName: "Customer", locationId: 7, note: "reference", refNo: "order", channelStatus: "Belum Bayar",
      items: [{ itemId: 101, quantity: 2, price: 1000, discAmount: 0, taxAmount: 0, unit: "Pair", taxId: 1 }],
    });
  });
  it("keeps provider2 Markdown as whole-line discount without customer PPN", () => {
    vi.stubEnv("JUBELIO_ITEM_UNIT", "");
    const pricingSnapshot = buildPricingSnapshot({ fulfillmentMethod: "pickup", ppnRatePercent: 11,
      lines: [{ variantId: "variant", quantity: 2, sourceUnitPrice: "1000", effectiveUnitPrice: "800", markdownRevisionId: "markdown" }] });
    expect(buildJubelioSalesCreateRequest({ ...input, pricingSnapshot })).toMatchObject({
      providerContractVersion: 2, shippingCost: 0, originalShipmentCost: 0, expectedProviderPayable: 1600,
      items: [{ itemId: 101, quantity: 2, price: 1000, discAmount: 400, taxAmount: 0, taxId: 1, unit: "Buah" }],
    });
  });
  it("uses provider3 frozen tax id and whole-line tax", () => {
    const pricingSnapshot = buildPricingSnapshot({ fulfillmentMethod: "pickup", ppnRatePercent: 11, providerTax: { taxId: -2, ratePercent: "11" },
      lines: [{ variantId: "variant", quantity: 2, sourceUnitPrice: "1000", effectiveUnitPrice: "800", markdownRevisionId: "markdown" }] });
    expect(buildJubelioSalesCreateRequest({ ...input, pricingSnapshot })).toMatchObject({
      providerContractVersion: 3, expectedProviderPayable: 1776, providerTax: { taxId: -2, ratePercent: "11" },
      items: [{ price: 1000, discAmount: 400, taxAmount: 176, taxId: -2 }],
    });
  });
});

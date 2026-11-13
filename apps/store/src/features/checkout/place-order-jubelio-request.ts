import type { JubelioSalesOrderCreateRequest } from "@marketplace/db/src/schema";
import type { PricingSnapshot } from "@/lib/versioned-pricing";

export interface PlaceOrderJubelioRequestInput {
  selectedItems: readonly { variantId: string; jubelioItemId: number | null; quantity: number; variantPrice: string }[];
  pricingSnapshot: PricingSnapshot | null;
  branch: { jubelioLocationId: number | null };
  sessionUserName: string | null | undefined;
  orderId: string;
  createReference: string;
  legacyProviderTaxId: number;
}

export function buildJubelioSalesCreateRequest({ selectedItems, pricingSnapshot, branch, sessionUserName, orderId, createReference, legacyProviderTaxId }: PlaceOrderJubelioRequestInput): JubelioSalesOrderCreateRequest {
  const taxContractSnapshot =
    pricingSnapshot && pricingSnapshot.providerContractVersion === 3
      ? pricingSnapshot
      : null;
  const createRequestBase = {
    // The verified generic Jubelio customer contact.
    contactId: -1,
    customerName: sessionUserName || "Customer",
    locationId: branch.jubelioLocationId!,
    note: createReference,
    refNo: orderId,
    channelStatus: "Belum Bayar" as const,
    items: selectedItems.map((item) => {
      // Provider price stays the SOURCE unit; the whole-line Markdown is a
      // line discount, never a lowered source price or a raised payment.
      const line = pricingSnapshot?.lines.find(
        (row) => row.variantId === item.variantId
      );
      const providerTaxAmount =
        taxContractSnapshot && line && "providerTaxAmount" in line
          ? Number(line.providerTaxAmount)
          : 0;
      return {
        itemId: item.jubelioItemId!,
        quantity: item.quantity,
        price: Number(item.variantPrice),
        discAmount: pricingSnapshot && line
          ? // Provider line discount = Markdown whole-line + Coupon allocation
            // (whole-line, NEVER multiplied by quantity again). The snapshot's
            // source/net line amounts are the independent authority.
            Math.round(Number(line.sourceLineAmount)) -
            Math.round(Number(line.netLineAmount))
          : 0,
        taxAmount: providerTaxAmount,
        unit: process.env.JUBELIO_ITEM_UNIT?.trim() || "Buah",
        // Provider3 memakai tax id tervalidasi dari master; cabang lama tetap
        // memakai record No Tax (provider FK menolak tax_id 0).
        taxId: taxContractSnapshot
          ? taxContractSnapshot.providerTax.taxId
          : legacyProviderTaxId,
      };
    }),
  };
  const createRequest: JubelioSalesOrderCreateRequest = !pricingSnapshot
    ? createRequestBase
    : taxContractSnapshot
      ? {
          ...createRequestBase,
          providerContractVersion: 3,
          originalShipmentCost: Number(taxContractSnapshot.shippingBeforeSubsidy),
          shippingCost: Number(taxContractSnapshot.shippingCost),
          expectedProviderPayable: Number(taxContractSnapshot.expectedProviderPayable),
          providerTax: taxContractSnapshot.providerTax,
        }
      : {
          ...createRequestBase,
          providerContractVersion: 2,
          originalShipmentCost: Number(pricingSnapshot.shippingBeforeSubsidy),
          shippingCost: Number(pricingSnapshot.shippingCost),
          expectedProviderPayable: Number(pricingSnapshot.expectedProviderPayable),
        };
  return createRequest;
}

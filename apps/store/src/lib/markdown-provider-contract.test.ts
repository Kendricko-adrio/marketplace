import { describe, expect, it } from "vitest";

import {
  JubelioSalesGatewayError,
  buildSalesOrderPayload,
} from "./jubelio-sales-client";
import {
  JubelioSalesContractError,
  readJubelioSalesOrderExpectation,
  readSettlementAuthorityRecord,
} from "./jubelio-sales-expected";

/**
 * Seam H/P — provider contract v2 with a whole-line Markdown discount.
 *
 * Expected values are the approved spec §4.4/§10.1 literals:
 *   source300000 → target150000: provider price300000, disc_amount150000,
 *   amount150000, sub_total300000, total_disc150000, add_disc0.
 *   qty2 of source100000 → 90000: disc_amount20000, amount180000.
 */
const BASE_INPUT = {
  providerContractVersion: 2 as const,
  contactId: -1,
  customerName: "Pelanggan Umum",
  locationId: 61,
  note: "OKCIR_SO_CREATE:order-x:op-1",
  refNo: "order-x",
  transactionDate: new Date("2026-10-24T00:00:00.000Z"),
  originalShipmentCost: 0,
  shippingCost: 0,
  expectedProviderPayable: 150_000,
};

const setPriceItem = {
  itemId: 101187,
  quantity: 1,
  price: 300_000,
  discAmount: 150_000,
  taxAmount: 0,
  unit: "Buah",
  taxId: 1,
};

describe("provider create payload carries a whole-line Markdown discount", () => {
  it("source300000→150000 qty1 pickup: price source, disc_amount150000, amount150000", () => {
    const payload = buildSalesOrderPayload({
      ...BASE_INPUT,
      items: [setPriceItem],
    });
    expect(payload).toMatchObject({
      sub_total: 300_000,
      total_disc: 150_000,
      total_tax: 0,
      grand_total: 150_000,
      add_disc: 0,
      add_fee: 0,
      service_fee: 0,
    });
    expect(payload.items).toEqual([
      expect.objectContaining({
        item_id: 101187,
        price: 300_000,
        disc: 50,
        disc_amount: 150_000,
        tax_amount: 0,
        amount: 150_000,
      }),
    ]);
    // `shipping_cost_discount` is omitted, never 0/null/empty string.
    expect(payload).not.toHaveProperty("shipping_cost_discount");
  });

  it("qty2 source100000→90000: disc_amount20000 (not multiplied twice), amount180000", () => {
    const payload = buildSalesOrderPayload({
      ...BASE_INPUT,
      expectedProviderPayable: 180_000,
      items: [
        {
          itemId: 101188,
          quantity: 2,
          price: 100_000,
          discAmount: 20_000,
          taxAmount: 0,
          unit: "Buah",
          taxId: 1,
        },
      ],
    });
    expect(payload).toMatchObject({
      sub_total: 200_000,
      total_disc: 20_000,
      grand_total: 180_000,
    });
    expect(payload.items).toEqual([
      expect.objectContaining({
        qty_in_base: 2,
        price: 100_000,
        disc_amount: 20_000,
        amount: 180_000,
      }),
    ]);
  });

  it("delivery: grand_total = net goods + net shipping, original kept separately", () => {
    const payload = buildSalesOrderPayload({
      ...BASE_INPUT,
      originalShipmentCost: 30_000,
      shippingCost: 10_000,
      expectedProviderPayable: 160_000,
      items: [setPriceItem],
    });
    expect(payload).toMatchObject({
      sub_total: 300_000,
      total_disc: 150_000,
      grand_total: 160_000,
      original_shipment_cost: 30_000,
      shipping_cost: 10_000,
    });
  });

  it("rejects nonzero tax, discount exceeding the line gross, and payable mismatch", () => {
    expect(() =>
      buildSalesOrderPayload({
        ...BASE_INPUT,
        items: [{ ...setPriceItem, taxAmount: 1 }],
      })
    ).toThrow(JubelioSalesGatewayError);
    expect(() =>
      buildSalesOrderPayload({
        ...BASE_INPUT,
        items: [{ ...setPriceItem, discAmount: 400_000 }],
      })
    ).toThrow(JubelioSalesGatewayError);
    expect(() =>
      buildSalesOrderPayload({
        ...BASE_INPUT,
        expectedProviderPayable: 149_999,
        items: [setPriceItem],
      })
    ).toThrow(JubelioSalesGatewayError);
  });

  it("legacy (unversioned) input with a discount is rejected", () => {
    expect(() =>
      buildSalesOrderPayload({
        contactId: -1,
        customerName: "Pelanggan Umum",
        locationId: 61,
        note: "legacy",
        items: [setPriceItem],
      })
    ).toThrow(JubelioSalesGatewayError);
  });
});

const CREATE_PAYLOAD = {
  type: "create" as const,
  create: {
    providerContractVersion: 2,
    contactId: -1,
    customerName: "Pelanggan Umum",
    locationId: 61,
    note: "OKCIR_SO_CREATE:order-x:op-1",
    refNo: "order-x",
    originalShipmentCost: 0,
    shippingCost: 0,
    expectedProviderPayable: 150_000,
    items: [setPriceItem],
  },
};

const ORDER_PRICING_ROW = {
  pricingContractVersion: 1,
  pricingEngineVersion: 1,
  providerContractVersion: 2,
  pricingSnapshot: {
    pricingContractVersion: 1,
    pricingEngineVersion: 1,
    providerContractVersion: 2,
    currency: "IDR",
    fulfillmentMethod: "pickup",
    sourceGoodsSubtotal: "300000",
    markdownTotal: "150000",
    subtotal: "150000",
    goodsDiscount: "0",
    netGoods: "150000",
    shippingBeforeSubsidy: "0",
    shippingSubsidy: "0",
    shippingCost: "0",
    merchantFunding: "0",
    serviceFee: "0",
    taxableBase: "150000",
    ppnRatePercent: "11",
    ppnAmount: "16500",
    total: "166500",
    expectedProviderPayable: "150000",
    providerQuotedShippingCost: null,
    providerBilledShippingCost: null,
    lines: [
      {
        variantId: "variant-a",
        quantity: 1,
        sourceUnitPrice: "300000",
        effectiveUnitPrice: "150000",
        sourceLineAmount: "300000",
        markdownAmount: "150000",
        goodsDiscountAmount: "0",
        netLineAmount: "150000",
        markdownRevisionId: "rev-1",
      },
    ],
  },
  subtotal: "150000",
  discount: "0",
  shippingCost: "0",
  serviceFee: "0",
  ppnRate: "11",
  ppnAmount: "16500",
  total: "166500",
};

describe("persisted create intent decoder with Markdown", () => {
  it("derives net goods from gross - whole-line discount", () => {
    const expectation = readJubelioSalesOrderExpectation(CREATE_PAYLOAD);
    if (expectation.providerContractVersion !== 2) throw new Error("v2 expected");
    expect(expectation.netGoods).toBe(150_000);
    expect(expectation.lines[0].discAmount).toBe(150_000);
    expect(expectation.expectedProviderPayable).toBe(150_000);
  });

  it("rejects nonzero tax and a discount above the line gross", () => {
    expect(() =>
      readJubelioSalesOrderExpectation({
        type: "create",
        create: {
          ...CREATE_PAYLOAD.create,
          items: [{ ...setPriceItem, taxAmount: 1 }],
        },
      })
    ).toThrow(JubelioSalesContractError);
    expect(() =>
      readJubelioSalesOrderExpectation({
        type: "create",
        create: {
          ...CREATE_PAYLOAD.create,
          expectedProviderPayable: 150_000,
          items: [{ ...setPriceItem, discAmount: 400_000 }],
        },
      })
    ).toThrow(JubelioSalesContractError);
  });

  it("cross-checks the order snapshot's markdown totals against the intent", () => {
    const authority = readSettlementAuthorityRecord({
      createPayload: CREATE_PAYLOAD,
      orderRow: ORDER_PRICING_ROW,
    });
    if (authority.providerContractVersion !== 2) throw new Error("v2 expected");
    expect(authority.expectedProviderPayable).toBe(150_000);

    const drifted = {
      ...ORDER_PRICING_ROW,
      pricingSnapshot: {
        ...ORDER_PRICING_ROW.pricingSnapshot,
        markdownTotal: "140000",
      },
    };
    expect(() =>
      readSettlementAuthorityRecord({
        createPayload: CREATE_PAYLOAD,
        orderRow: drifted,
      })
    ).toThrow(JubelioSalesContractError);
  });
});

// ---------------------------------------------------------------------------
// Mirror pre-read (P03): the pre-edit GET must show the same whole-line
// discount and money; a changed/serialized discount is a mismatch, never an
// edit POST.
// ---------------------------------------------------------------------------

import { mirrorPreReadMismatch } from "./jubelio-channel-mirror";

const PRE_READ_SNAPSHOT = {
  salesorderId: 68378,
  salesorderNo: "SO-000068378",
  source: 1,
  refNo: "order-x",
  contactId: -1,
  customerName: "Pelanggan Umum",
  locationId: 61,
  note: "OKCIR_SO_CREATE:order-x:op-1",
  transactionDate: "2026-10-24T00:00:00.000Z",
  isTaxIncluded: false,
  isCanceled: false,
  invoiceId: 45974,
  channelStatus: "Belum Bayar",
  subTotal: 300_000,
  totalDisc: 150_000,
  totalTax: 0,
  grandTotal: 150_000,
  addFee: 0,
  addDisc: 0,
  serviceFee: 0,
  originalShipmentCost: 0,
  shippingCost: 0,
  items: [
    {
      salesorderDetailId: 1,
      itemId: 101187,
      quantity: 1,
      price: 300_000,
      disc: 50,
      discAmount: 150_000,
      taxAmount: 0,
      amount: 150_000,
      unit: "Buah",
      taxId: 1,
      locationId: 61,
    },
  ],
};

function preReadInput(snapshot: unknown = PRE_READ_SNAPSHOT) {
  return {
    snapshot: snapshot as never,
    create: {
      status: "confirmed",
      payload: CREATE_PAYLOAD,
    } as never,
    verifiedInvoiceId: 45974,
  };
}

describe("mirror pre-read with a whole-line Markdown discount", () => {
  it("accepts a GET that preserves disc_amount, amount, sub_total and total_disc", () => {
    expect(mirrorPreReadMismatch(preReadInput())).toBeNull();
  });

  it("refuses a changed discount or amount", () => {
    const changedDisc = structuredClone(PRE_READ_SNAPSHOT);
    changedDisc.items[0].discAmount = 100_000;
    expect(mirrorPreReadMismatch(preReadInput(changedDisc))).toBe(
      "PRE_READ_ITEM_MISMATCH"
    );

    const changedAmount = structuredClone(PRE_READ_SNAPSHOT);
    changedAmount.items[0].amount = 300_000;
    expect(mirrorPreReadMismatch(preReadInput(changedAmount))).toBe(
      "PRE_READ_ITEM_MISMATCH"
    );
  });

  it("refuses a header discount/payable that no longer matches the intent", () => {
    const changedTotalDisc = structuredClone(PRE_READ_SNAPSHOT);
    changedTotalDisc.totalDisc = 0;
    expect(mirrorPreReadMismatch(preReadInput(changedTotalDisc))).toBe(
      "PRE_READ_MONEY_MISMATCH"
    );

    const changedPayable = structuredClone(PRE_READ_SNAPSHOT);
    changedPayable.grandTotal = 160_000;
    expect(mirrorPreReadMismatch(preReadInput(changedPayable))).toBe(
      "PRE_READ_MONEY_MISMATCH"
    );
  });
});

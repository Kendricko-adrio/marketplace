import { describe, expect, it } from "vitest";
import { evaluatePricing, type EvaluatePricingInput, type FixedGoodsBenefitInput } from "./discount-pricing";
import { PricingContractError, type PricingSnapshot } from "./versioned-pricing";

// Kasus review lanjutan pada seam L yang sama untuk implementasi fixed goods yang
// digeneralisasi: alokasi proporsional, tie-break variantId, clip ke subtotal, dan guard
// runtime. Expected di bawah tetap literal independen dari spec ticket06, bukan hasil
// hitung ulang rumus implementasi, dan bukan harga redeem maupun provider write.
function pickupSimulation(
  lines: readonly { variantId: string; unitPrice: string }[],
  benefit: unknown,
): EvaluatePricingInput {
  return {
    fulfillmentMethod: "pickup",
    ppnRatePercent: "11",
    lines: lines.map((line) => ({
      variantId: line.variantId,
      quantity: 1,
      sourceUnitPrice: line.unitPrice,
      effectiveUnitPrice: line.unitPrice,
    })),
    // Cast hanya di sini: tabel guard di bawah sengaja mengirim benefit tidak valid
    // (kind/paramsVersion/field asing) ke guard runtime publik.
    benefit: benefit as EvaluatePricingInput["benefit"],
  };
}

function fixedGoods(fixedAmount: string | number): FixedGoodsBenefitInput {
  return { kind: "fixed_goods", paramsVersion: 1, fixedAmount };
}

function discountByVariant(result: PricingSnapshot): Record<string, string> {
  return Object.fromEntries(result.lines.map((line) => [line.variantId, line.goodsDiscountAmount]));
}

// Seam L — antarmuka Pricing publik yang dipakai simulasi admin (spec §4.2/§4.4,
// ticket06). Expected di bawah adalah literal independen dari contoh simulasi
// yang disetujui: subtotal 150000, fixed goods 17000, PPN 11%, pickup tanpa ongkir
// dan tanpa service fee. Bukan harga customer hasil redeem dan bukan provider write.
describe("evaluatePricing — simulasi admin fixed goods", () => {
  it("subtotal150000 dengan fixed goods17000 menghasilkan net133000, PPN14630, pickup total147630", () => {
    const result = evaluatePricing({
      fulfillmentMethod: "pickup",
      ppnRatePercent: "11",
      lines: [
        {
          variantId: "sku-fixed-simulation",
          quantity: 1,
          sourceUnitPrice: "150000",
          effectiveUnitPrice: "150000",
        },
      ],
      benefit: {
        kind: "fixed_goods",
        paramsVersion: 1,
        fixedAmount: "17000",
      },
    });

    expect(result.subtotal).toBe("150000");
    expect(result.goodsDiscount).toBe("17000");
    expect(result.netGoods).toBe("133000");
    expect(result.taxableBase).toBe("133000");
    expect(result.ppnAmount).toBe("14630");
    expect(result.total).toBe("147630");
    expect(result.serviceFee).toBe("0");
    expect(result.shippingCost).toBe("0");
    expect(result.expectedProviderPayable).toBe("133000");
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].goodsDiscountAmount).toBe("17000");
    expect(result.lines[0].netLineAmount).toBe("133000");
  });
});

describe("evaluatePricing — alokasi goods diskon proporsional", () => {
  it("baris150000+100000 dengan fixed25000 membagi15000+10000, net225000, PPN24750, total249750", () => {
    const result = evaluatePricing(
      pickupSimulation(
        [
          { variantId: "variant-150k", unitPrice: "150000" },
          { variantId: "variant-100k", unitPrice: "100000" },
        ],
        fixedGoods("25000"),
      ),
    );

    expect(result.subtotal).toBe("250000");
    expect(result.goodsDiscount).toBe("25000");
    expect(discountByVariant(result)).toEqual({ "variant-150k": "15000", "variant-100k": "10000" });
    expect(result.lines[0].netLineAmount).toBe("135000");
    expect(result.lines[1].netLineAmount).toBe("90000");
    expect(result.netGoods).toBe("225000");
    expect(result.taxableBase).toBe("225000");
    expect(result.ppnAmount).toBe("24750");
    expect(result.total).toBe("249750");
    expect(result.expectedProviderPayable).toBe("225000");
  });

  it("urutan baris dibalik memberi alokasi per variant yang sama", () => {
    const reversed = evaluatePricing(
      pickupSimulation(
        [
          { variantId: "variant-100k", unitPrice: "100000" },
          { variantId: "variant-150k", unitPrice: "150000" },
        ],
        fixedGoods("25000"),
      ),
    );

    expect(discountByVariant(reversed)).toEqual({ "variant-100k": "10000", "variant-150k": "15000" });
    expect(reversed.netGoods).toBe("225000");
    expect(reversed.ppnAmount).toBe("24750");
    expect(reversed.total).toBe("249750");
    expect(reversed.expectedProviderPayable).toBe("225000");
  });

  it("basis100+200 dengan fixed1 memberi alokasi 0 pada baris kecil dan 1 pada baris besar", () => {
    const result = evaluatePricing(
      pickupSimulation(
        [
          { variantId: "variant-100", unitPrice: "100" },
          { variantId: "variant-200", unitPrice: "200" },
        ],
        fixedGoods("1"),
      ),
    );

    expect(discountByVariant(result)).toEqual({ "variant-100": "0", "variant-200": "1" });
    expect(result.lines[0].netLineAmount).toBe("100");
    expect(result.lines[1].netLineAmount).toBe("199");
    expect(result.netGoods).toBe("299");
    expect(result.total).toBe("332");
  });

  it("sisa pembagian sama jatuh ke variantId terkecil, juga saat urutan input dibalik", () => {
    const benefit = fixedGoods("1");
    const forward = evaluatePricing(
      pickupSimulation(
        [
          { variantId: "variant-a", unitPrice: "100" },
          { variantId: "variant-b", unitPrice: "100" },
        ],
        benefit,
      ),
    );
    const reversed = evaluatePricing(
      pickupSimulation(
        [
          { variantId: "variant-b", unitPrice: "100" },
          { variantId: "variant-a", unitPrice: "100" },
        ],
        benefit,
      ),
    );

    expect(discountByVariant(forward)).toEqual({ "variant-a": "1", "variant-b": "0" });
    expect(discountByVariant(reversed)).toEqual({ "variant-a": "1", "variant-b": "0" });
    expect(reversed.netGoods).toBe("199");
  });
});

describe("evaluatePricing — fixed goods di-clip ke subtotal", () => {
  it("fixed17000 pada subtotal10000 jadi goodsDiscount10000 tanpa ongkir atau provider tercatat", () => {
    const result = evaluatePricing(
      pickupSimulation([{ variantId: "variant-10000", unitPrice: "10000" }], fixedGoods("17000")),
    );

    expect(result.subtotal).toBe("10000");
    expect(result.goodsDiscount).toBe("10000");
    expect(result.netGoods).toBe("0");
    expect(result.taxableBase).toBe("0");
    expect(result.ppnAmount).toBe("0");
    expect(result.total).toBe("0");
    expect(result.serviceFee).toBe("0");
    expect(result.shippingCost).toBe("0");
    expect(result.expectedProviderPayable).toBe("0");
    expect(result.providerQuotedShippingCost).toBeNull();
    expect(result.providerBilledShippingCost).toBeNull();
    expect(result.lines[0].goodsDiscountAmount).toBe("10000");
    expect(result.lines[0].netLineAmount).toBe("0");
  });
});

// Baseline setiap kasus di bawah valid (pickup, PPN11, satu baris100000) supaya kegagalan
// hanya bisa berasal dari guard benefit, bukan dari builder snapshot baseline.
const invalidBenefits: { label: string; benefit: unknown }[] = [
  { label: "kind persentase belum ada di kontrak versi ini", benefit: { kind: "percentage_goods", paramsVersion: 1, fixedAmount: "1000" } },
  { label: "paramsVersion2 belum ada di kontrak versi ini", benefit: { kind: "fixed_goods", paramsVersion: 2, fixedAmount: "1000" } },
  { label: "field asing di objek benefit", benefit: { kind: "fixed_goods", paramsVersion: 1, fixedAmount: "1000", usageLimitPerOrder: 1 } },
  { label: "fixedAmount nol", benefit: { kind: "fixed_goods", paramsVersion: 1, fixedAmount: "0" } },
  { label: "fixedAmount negatif", benefit: { kind: "fixed_goods", paramsVersion: 1, fixedAmount: -1000 } },
  { label: "fixedAmount pecahan Rupiah", benefit: { kind: "fixed_goods", paramsVersion: 1, fixedAmount: "1500.5" } },
  { label: "fixedAmount di atas batas Rupiah", benefit: { kind: "fixed_goods", paramsVersion: 1, fixedAmount: "10000000000000" } },
];

describe("evaluatePricing — guard runtime benefit fixed goods", () => {
  it.each(invalidBenefits)("menolak benefit $label", ({ benefit }) => {
    expect(() =>
      evaluatePricing(pickupSimulation([{ variantId: "variant-100000", unitPrice: "100000" }], benefit)),
    ).toThrow(PricingContractError);
  });
});

// Ticket 07 — kombinasi Markdown + Coupon fixed goods (spec §4.4 baris pertama
// dengan benefit fixed setara 10% dari 150000, bukan percentage engine10).
// Expected literal independen: source300000→target150000, coupon15000.
describe("evaluatePricing — Markdown dan Coupon fixed goods dalam satu snapshot", () => {
  it("source300000 target150000 dengan fixed15000 memberi markdown150000, net135000, PPN14850, total149850", () => {
    const result = evaluatePricing({
      fulfillmentMethod: "pickup",
      ppnRatePercent: "11",
      lines: [
        {
          variantId: "variant-markdown",
          quantity: 1,
          sourceUnitPrice: "300000",
          effectiveUnitPrice: "150000",
          markdownRevisionId: "revision-markdown-1",
        },
      ],
      benefit: fixedGoods("15000"),
    });

    expect(result.sourceGoodsSubtotal).toBe("300000");
    expect(result.markdownTotal).toBe("150000");
    expect(result.subtotal).toBe("150000");
    expect(result.goodsDiscount).toBe("15000");
    expect(result.netGoods).toBe("135000");
    expect(result.taxableBase).toBe("135000");
    expect(result.ppnAmount).toBe("14850");
    expect(result.total).toBe("149850");
    expect(result.serviceFee).toBe("0");
    expect(result.expectedProviderPayable).toBe("135000");
    expect(result.lines[0].markdownAmount).toBe("150000");
    expect(result.lines[0].goodsDiscountAmount).toBe("15000");
    expect(result.lines[0].netLineAmount).toBe("135000");
  });
});

// Ticket 07 — qty2 whole-line: discount dihitung sekali per line, bukan per unit
// dan bukan dikali quantity dua kali (spec §4.4). Literal independen:
// source100000→target90000 qty2, fixed18000 → markdown20000, net162000,
// PPN17820, total179820.
describe("evaluatePricing — qty2 dengan Markdown dan Coupon", () => {
  it("source100000 target90000 qty2 fixed18000 memberi markdown20000 dan net162000", () => {
    const result = evaluatePricing({
      fulfillmentMethod: "pickup",
      ppnRatePercent: "11",
      lines: [
        {
          variantId: "variant-qty2",
          quantity: 2,
          sourceUnitPrice: "100000",
          effectiveUnitPrice: "90000",
          markdownRevisionId: "revision-qty2",
        },
      ],
      benefit: fixedGoods("18000"),
    });

    expect(result.sourceGoodsSubtotal).toBe("200000");
    expect(result.markdownTotal).toBe("20000");
    expect(result.subtotal).toBe("180000");
    expect(result.goodsDiscount).toBe("18000");
    expect(result.netGoods).toBe("162000");
    expect(result.ppnAmount).toBe("17820");
    expect(result.total).toBe("179820");
    expect(result.lines[0].sourceLineAmount).toBe("200000");
    expect(result.lines[0].markdownAmount).toBe("20000");
    expect(result.lines[0].goodsDiscountAmount).toBe("18000");
    expect(result.lines[0].netLineAmount).toBe("162000");
  });
});

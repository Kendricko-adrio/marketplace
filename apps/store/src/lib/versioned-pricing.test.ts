import { describe, expect, it } from "vitest";
import {
  PricingContractError,
  buildPricingSnapshot,
  decodeLegacyOrderPricing,
  decodePricingSnapshot,
  readOrderPricing,
} from "./versioned-pricing";
import type { PricingLineInput } from "./versioned-pricing";

// Seam L — the public pricing contract (spec §4.2/§4.3/§8.3).
// Expected values are independent literals from the approved spec §4.4 and the
// ticket-01 worked examples, never recomputed through the module under test.
describe("buildPricingSnapshot — baseline tanpa promo", () => {
  it("pickup: PPN 11% hanya atas net barang, tanpa service fee", () => {
    const snapshot = buildPricingSnapshot({
      fulfillmentMethod: "pickup",
      ppnRatePercent: "11",
      lines: [line()],
    });

    expect(snapshot.pricingContractVersion).toBe(1);
    expect(snapshot.pricingEngineVersion).toBe(1);
    expect(snapshot.providerContractVersion).toBe(2);
    expect(snapshot.currency).toBe("IDR");
    expect(snapshot.sourceGoodsSubtotal).toBe("150000");
    expect(snapshot.markdownTotal).toBe("0");
    expect(snapshot.subtotal).toBe("150000");
    expect(snapshot.goodsDiscount).toBe("0");
    expect(snapshot.netGoods).toBe("150000");
    expect(snapshot.shippingBeforeSubsidy).toBe("0");
    expect(snapshot.shippingSubsidy).toBe("0");
    expect(snapshot.shippingCost).toBe("0");
    expect(snapshot.serviceFee).toBe("0");
    expect(snapshot.taxableBase).toBe("150000");
    expect(snapshot.ppnRatePercent).toBe("11");
    expect(snapshot.ppnAmount).toBe("16500");
    expect(snapshot.total).toBe("166500");
    expect(snapshot.expectedProviderPayable).toBe("150000");
  });

  it("delivery: ongkir quote asli 30000 menjadi net ongkir customer, bukan subsidi", () => {
    const snapshot = buildPricingSnapshot({
      fulfillmentMethod: "delivery",
      ppnRatePercent: "11",
      shippingBeforeSubsidy: "30000",
      lines: [line({ variantId: "variant-delivery" })],
    });

    expect(snapshot.shippingBeforeSubsidy).toBe("30000");
    expect(snapshot.shippingSubsidy).toBe("0");
    expect(snapshot.shippingCost).toBe("30000");
    expect(snapshot.merchantFunding).toBe("0");
    expect(snapshot.taxableBase).toBe("150000");
    expect(snapshot.ppnAmount).toBe("16500");
    expect(snapshot.total).toBe("196500");
    expect(snapshot.expectedProviderPayable).toBe("180000");
  });

  it("menyimpan line snapshot yang konsisten dengan total header", () => {
    const snapshot = buildPricingSnapshot({
      fulfillmentMethod: "pickup",
      ppnRatePercent: "11",
      lines: [line({ variantId: "variant-qty", quantity: 2 })],
    });

    expect(snapshot.lines).toHaveLength(1);
    expect(snapshot.lines[0]).toEqual({
      variantId: "variant-qty",
      quantity: 2,
      sourceUnitPrice: "150000",
      effectiveUnitPrice: "150000",
      sourceLineAmount: "300000",
      markdownAmount: "0",
      goodsDiscountAmount: "0",
      netLineAmount: "300000",
      markdownRevisionId: null,
    });
    expect(snapshot.total).toBe("333000");
    expect(snapshot.expectedProviderPayable).toBe("300000");
  });
});

function line(overrides: Partial<PricingLineInput> = {}): PricingLineInput {
  return {
    variantId: "variant-pickup",
    quantity: 1,
    sourceUnitPrice: "150000",
    effectiveUnitPrice: "150000",
    ...overrides,
  };
}

function expectRejection(run: () => unknown, code: string): void {
  let caught: unknown;
  try {
    run();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(PricingContractError);
  expect((caught as PricingContractError).code).toBe(code);
}

describe("buildPricingSnapshot — batas money, rate, dan cart", () => {
  const rejectedMoneyInputs: Array<{ label: string; value: string | number }> = [
    { label: "negatif", value: "-150000" },
    { label: "pecahan Rupiah nonzero", value: "150000.50" },
    { label: "bertanda plus", value: "+150000" },
    { label: "notasi eksponen", value: "1.5e5" },
    { label: "pemisah ribuan koma", value: "150,000" },
    { label: "angka unsafe", value: Number.MAX_SAFE_INTEGER + 2 },
    { label: "angka berkoma", value: 150000.5 },
  ];

  it.each(rejectedMoneyInputs)("menolak nominal $label", ({ value }) => {
    expectRejection(
      () =>
        buildPricingSnapshot({
          fulfillmentMethod: "pickup",
          ppnRatePercent: "11",
          lines: [line({ sourceUnitPrice: value, effectiveUnitPrice: value })],
        }),
      "PRICING_INPUT_INVALID"
    );
  });

  it.each(["150000", "150000.00", "150000.0000"])(
    "menerima nominal utuh %s termasuk trailing zero fraction",
    (value) => {
      const snapshot = buildPricingSnapshot({
        fulfillmentMethod: "pickup",
        ppnRatePercent: "11",
        lines: [line({ sourceUnitPrice: value, effectiveUnitPrice: value })],
      });
      expect(snapshot.sourceGoodsSubtotal).toBe("150000");
      expect(snapshot.total).toBe("166500");
    }
  );

  it("menerima decimal sumber dengan trailing zero fraction tiga digit", () => {
    const snapshot = buildPricingSnapshot({
      fulfillmentMethod: "pickup",
      ppnRatePercent: "0",
      lines: [line({ sourceUnitPrice: "150.000", effectiveUnitPrice: "150.000" })],
    });
    expect(snapshot.sourceGoodsSubtotal).toBe("150");
    expect(snapshot.total).toBe("150");
  });

  it("menghitung rate 6 desimal secara exact tanpa pembulatan input", () => {
    const snapshot = buildPricingSnapshot({
      fulfillmentMethod: "pickup",
      ppnRatePercent: "11.5",
      lines: [line()],
    });
    expect(snapshot.ppnRatePercent).toBe("11.5");
    expect(snapshot.ppnAmount).toBe("17250");
    expect(snapshot.total).toBe("167250");
  });

  it.each(["11.1234567", "100.01", "-1", "0,11", "NaN", "1e1"])(
    "menolak rate %s",
    (value) => {
      expectRejection(
        () =>
          buildPricingSnapshot({
            fulfillmentMethod: "pickup",
            ppnRatePercent: value,
            lines: [line()],
          }),
        "PRICING_INPUT_INVALID"
      );
    }
  );

  it("menerima 50 variant unik dan menolak 51", () => {
    const snapshot = buildPricingSnapshot({
      fulfillmentMethod: "pickup",
      ppnRatePercent: "0",
      lines: cartLines(50),
    });
    expect(snapshot.lines).toHaveLength(50);
    expect(snapshot.sourceGoodsSubtotal).toBe("50000");

    expectRejection(
      () =>
        buildPricingSnapshot({
          fulfillmentMethod: "pickup",
          ppnRatePercent: "0",
          lines: cartLines(51),
        }),
      "PRICING_INPUT_INVALID"
    );
  });

  it("menerima quantity 1 dan 99 dengan total yang sesuai, menolak 0 dan 100", () => {
    const single = buildPricingSnapshot({
      fulfillmentMethod: "pickup",
      ppnRatePercent: "11",
      lines: [line({ quantity: 1 })],
    });
    expect(single.sourceGoodsSubtotal).toBe("150000");
    expect(single.ppnAmount).toBe("16500");
    expect(single.total).toBe("166500");

    const maximum = buildPricingSnapshot({
      fulfillmentMethod: "pickup",
      ppnRatePercent: "11",
      lines: [line({ quantity: 99 })],
    });
    expect(maximum.sourceGoodsSubtotal).toBe("14850000");
    expect(maximum.ppnAmount).toBe("1633500");
    expect(maximum.total).toBe("16483500");
    expect(maximum.expectedProviderPayable).toBe("14850000");

    for (const quantity of [0, 100]) {
      expectRejection(
        () =>
          buildPricingSnapshot({
            fulfillmentMethod: "pickup",
            ppnRatePercent: "0",
            lines: [line({ quantity })],
          }),
        "PRICING_INPUT_INVALID"
      );
    }
  });

  it("menolak cart kosong dan variant ID duplikat", () => {
    expectRejection(
      () =>
        buildPricingSnapshot({
          fulfillmentMethod: "pickup",
          ppnRatePercent: "0",
          lines: [],
        }),
      "PRICING_INPUT_INVALID"
    );
    expectRejection(
      () =>
        buildPricingSnapshot({
          fulfillmentMethod: "pickup",
          ppnRatePercent: "0",
          lines: [line(), line()],
        }),
      "PRICING_INPUT_INVALID"
    );
  });

  it("menerima variant ID 128 karakter dan menolak 129 karakter", () => {
    const longest = "v".repeat(128);
    const snapshot = buildPricingSnapshot({
      fulfillmentMethod: "pickup",
      ppnRatePercent: "0",
      lines: [line({ variantId: longest })],
    });
    expect(snapshot.lines[0].variantId).toBe(longest);

    expectRejection(
      () =>
        buildPricingSnapshot({
          fulfillmentMethod: "pickup",
          ppnRatePercent: "0",
          lines: [line({ variantId: "v".repeat(129) })],
        }),
      "PRICING_INPUT_INVALID"
    );
    expectRejection(
      () =>
        buildPricingSnapshot({
          fulfillmentMethod: "pickup",
          ppnRatePercent: "0",
          lines: [line({ variantId: "" })],
        }),
      "PRICING_INPUT_INVALID"
    );
  });

  it("menerima nominal tepat di bound 9999999999999", () => {
    const snapshot = buildPricingSnapshot({
      fulfillmentMethod: "pickup",
      ppnRatePercent: "0",
      lines: [
        line({
          sourceUnitPrice: "9999999999999",
          effectiveUnitPrice: "9999999999999",
        }),
      ],
    });
    expect(snapshot.sourceGoodsSubtotal).toBe("9999999999999");
    expect(snapshot.total).toBe("9999999999999");
    expect(snapshot.expectedProviderPayable).toBe("9999999999999");
  });

  const overflowCases: Array<{
    label: string;
    lines: PricingLineInput[];
    ppnRatePercent: string;
  }> = [
    {
      label: "agregat dua line melewati bound",
      ppnRatePercent: "0",
      lines: [
        line({
          variantId: "variant-a",
          sourceUnitPrice: "9999999999999",
          effectiveUnitPrice: "9999999999999",
        }),
        line({
          variantId: "variant-b",
          sourceUnitPrice: "9999999999999",
          effectiveUnitPrice: "9999999999999",
        }),
      ],
    },
    {
      label: "PPN mendorong total melewati bound",
      ppnRatePercent: "11",
      lines: [
        line({
          sourceUnitPrice: "9999999999999",
          effectiveUnitPrice: "9999999999999",
        }),
      ],
    },
  ];

  it.each(overflowCases)("menolak overflow: $label", ({ lines, ppnRatePercent }) => {
    expectRejection(
      () =>
        buildPricingSnapshot({
          fulfillmentMethod: "pickup",
          ppnRatePercent,
          lines,
        }),
      "PRICING_INPUT_INVALID"
    );
  });

  it("menolak ongkir negatif atau berpecahan", () => {
    for (const shippingBeforeSubsidy of ["-30000", "30000.75"]) {
      expectRejection(
        () =>
          buildPricingSnapshot({
            fulfillmentMethod: "delivery",
            ppnRatePercent: "11",
            shippingBeforeSubsidy,
            lines: [line()],
          }),
        "PRICING_INPUT_INVALID"
      );
    }
  });

  it("menolak pickup yang membawa ongkir", () => {
    expectRejection(
      () =>
        buildPricingSnapshot({
          fulfillmentMethod: "pickup",
          ppnRatePercent: "11",
          shippingBeforeSubsidy: "30000",
          lines: [line()],
        }),
      "PRICING_INPUT_INVALID"
    );
  });

  it("menolak effective unit di atas source", () => {
    expectRejection(
      () =>
        buildPricingSnapshot({
          fulfillmentMethod: "pickup",
          ppnRatePercent: "11",
          lines: [line({ effectiveUnitPrice: "200000" })],
        }),
      "PRICING_INPUT_INVALID"
    );
  });

  it("menerima Markdown tervalidasi: effective di bawah source dengan revision ID", () => {
    const snapshot = buildPricingSnapshot({
      fulfillmentMethod: "pickup",
      ppnRatePercent: "11",
      lines: [
        line({
          sourceUnitPrice: "300000",
          effectiveUnitPrice: "150000",
          markdownRevisionId: "markdown-revision-1",
        }),
      ],
    });
    // Approved spec §4.4: source300000→target150000, PPN11% pickup.
    expect(snapshot.sourceGoodsSubtotal).toBe("300000");
    expect(snapshot.markdownTotal).toBe("150000");
    expect(snapshot.subtotal).toBe("150000");
    expect(snapshot.ppnAmount).toBe("16500");
    expect(snapshot.total).toBe("166500");
    expect(snapshot.expectedProviderPayable).toBe("150000");
    expect(snapshot.lines[0]).toMatchObject({
      markdownAmount: "150000",
      netLineAmount: "150000",
      markdownRevisionId: "markdown-revision-1",
    });
  });

  it("menolak Markdown tanpa revision ID dan revision ID tanpa Markdown", () => {
    expectRejection(
      () =>
        buildPricingSnapshot({
          fulfillmentMethod: "pickup",
          ppnRatePercent: "11",
          lines: [
            line({ sourceUnitPrice: "300000", effectiveUnitPrice: "150000" }),
          ],
        }),
      "PRICING_INPUT_INVALID"
    );
    expectRejection(
      () =>
        buildPricingSnapshot({
          fulfillmentMethod: "pickup",
          ppnRatePercent: "11",
          lines: [line({ markdownRevisionId: "markdown-revision-1" })],
        }),
      "PRICING_INPUT_INVALID"
    );
  });
});

function cartLines(count: number): PricingLineInput[] {
  return Array.from({ length: count }, (_unused, index) => ({
    variantId: `variant-${index}`,
    quantity: 1,
    sourceUnitPrice: "1000",
    effectiveUnitPrice: "1000",
  }));
}

// Fixture otoritatif independen untuk decoder: ditulis literal dari spec §4.4/
// §8.3 (barang 150000 dalam 2 line unit 75000, ongkir quote 30000, PPN 11%),
// TIDAK dibangun lewat builder yang diuji.
const VALID_SNAPSHOT_V1 = {
  pricingContractVersion: 1,
  pricingEngineVersion: 1,
  providerContractVersion: 2,
  currency: "IDR",
  fulfillmentMethod: "delivery",
  sourceGoodsSubtotal: "150000",
  markdownTotal: "0",
  subtotal: "150000",
  goodsDiscount: "0",
  netGoods: "150000",
  shippingBeforeSubsidy: "30000",
  shippingSubsidy: "0",
  shippingCost: "30000",
  merchantFunding: "0",
  serviceFee: "0",
  taxableBase: "150000",
  ppnRatePercent: "11",
  ppnAmount: "16500",
  total: "196500",
  expectedProviderPayable: "180000",
  providerQuotedShippingCost: "27000",
  providerBilledShippingCost: null,
  lines: [
    {
      variantId: "var-mug",
      quantity: 2,
      sourceUnitPrice: "75000",
      effectiveUnitPrice: "75000",
      sourceLineAmount: "150000",
      markdownAmount: "0",
      goodsDiscountAmount: "0",
      netLineAmount: "150000",
      markdownRevisionId: null,
    },
  ],
};

describe("decodePricingSnapshot — snapshot pricing1 fail closed", () => {
  it("menerima snapshot literal v1 dan mengembalikan breakdown yang sama", () => {
    const decoded = decodePricingSnapshot(VALID_SNAPSHOT_V1);

    expect(decoded.pricingContractVersion).toBe(1);
    expect(decoded.pricingEngineVersion).toBe(1);
    expect(decoded.providerContractVersion).toBe(2);
    expect(decoded.netGoods).toBe("150000");
    expect(decoded.shippingBeforeSubsidy).toBe("30000");
    expect(decoded.shippingCost).toBe("30000");
    expect(decoded.total).toBe("196500");
    expect(decoded.expectedProviderPayable).toBe("180000");
    expect(decoded.providerQuotedShippingCost).toBe("27000");
    expect(decoded.providerBilledShippingCost).toBeNull();
    expect(decoded.lines).toHaveLength(1);
    expect(decoded.lines[0].netLineAmount).toBe("150000");
  });

  it("menerima hasil builder kontrak yang sama (round-trip)", () => {
    const built = buildPricingSnapshot({
      fulfillmentMethod: "delivery",
      ppnRatePercent: "11",
      shippingBeforeSubsidy: "30000",
      lines: [line({ variantId: "var-mug", quantity: 2 })],
    });
    const decoded = decodePricingSnapshot(JSON.parse(JSON.stringify(built)));
    expect(decoded).toEqual(built);
  });

  it.each([
    { label: "tanpa version eksplisit", payload: stripVersion(VALID_SNAPSHOT_V1) },
    { label: "version 0 legacy", payload: { ...VALID_SNAPSHOT_V1, pricingContractVersion: 0 } },
    { label: "version 2", payload: { ...VALID_SNAPSHOT_V1, pricingContractVersion: 2 } },
    { label: "version sebagai string", payload: { ...VALID_SNAPSHOT_V1, pricingContractVersion: "1" } },
    { label: "engine version 2", payload: { ...VALID_SNAPSHOT_V1, pricingEngineVersion: 2 } },
    { label: "provider version 1", payload: { ...VALID_SNAPSHOT_V1, providerContractVersion: 1 } },
    { label: "provider version 3", payload: { ...VALID_SNAPSHOT_V1, providerContractVersion: 3 } },
  ])("menolak versi tidak dikenal: $label", ({ payload }) => {
    expectRejection(() => decodePricingSnapshot(payload), "PRICING_UNSUPPORTED_VERSION");
  });

  it.each([
    { label: "null", payload: null },
    { label: "string", payload: "snapshot" },
    { label: "array", payload: [] },
  ])("menolak payload bukan objek: $label", ({ payload }) => {
    expectRejection(() => decodePricingSnapshot(payload), "PRICING_SNAPSHOT_CORRUPT");
  });

  it("menolak field tak dikenal", () => {
    expectRejection(
      () => decodePricingSnapshot({ ...VALID_SNAPSHOT_V1, promo: null }),
      "PRICING_SNAPSHOT_CORRUPT"
    );
    expectRejection(
      () =>
        decodePricingSnapshot({
          ...VALID_SNAPSHOT_V1,
          lines: [{ ...VALID_SNAPSHOT_V1.lines[0], discountId: "x" }],
        }),
      "PRICING_SNAPSHOT_CORRUPT"
    );
  });

  it("menolak snapshot melebihi batas 256KiB", () => {
    expectRejection(
      () =>
        decodePricingSnapshot({
          ...VALID_SNAPSHOT_V1,
          ignoredBlob: "x".repeat(300 * 1024),
        }),
      "PRICING_SNAPSHOT_TOO_LARGE"
    );
  });

  const corruptedSnapshots: Array<{ label: string; payload: unknown }> = [
    { label: "total tidak sama dengan net+PPN+ongkir", payload: { ...VALID_SNAPSHOT_V1, total: "196501" } },
    { label: "service fee nonzero", payload: { ...VALID_SNAPSHOT_V1, serviceFee: "1000", total: "197500" } },
    { label: "taxable base bukan net barang", payload: { ...VALID_SNAPSHOT_V1, taxableBase: "180000", ppnAmount: "19800", total: "199800" } },
    { label: "PPN tidak sesuai rate tersimpan", payload: { ...VALID_SNAPSHOT_V1, ppnAmount: "16000", total: "196000" } },
    { label: "net barang tidak sama dengan subtotal dikurangi diskon", payload: { ...VALID_SNAPSHOT_V1, goodsDiscount: "10000", netGoods: "150000" } },
    { label: "net ongkir tidak sama dengan quote dikurangi subsidi", payload: { ...VALID_SNAPSHOT_V1, shippingSubsidy: "10000" } },
    { label: "expected provider payable salah", payload: { ...VALID_SNAPSHOT_V1, expectedProviderPayable: "150000" } },
    { label: "total line tidak sama dengan header", payload: { ...VALID_SNAPSHOT_V1, lines: [{ ...VALID_SNAPSHOT_V1.lines[0], netLineAmount: "149000" }] } },
    { label: "markdown line tidak sama dengan source dikurangi effective", payload: { ...VALID_SNAPSHOT_V1, lines: [{ ...VALID_SNAPSHOT_V1.lines[0], markdownAmount: "5000" }] } },
    { label: "nominal berpecahan", payload: { ...VALID_SNAPSHOT_V1, total: "196500.50" } },
    { label: "quantity di luar bound", payload: { ...VALID_SNAPSHOT_V1, lines: [{ ...VALID_SNAPSHOT_V1.lines[0], quantity: 100 }] } },
    { label: "variant duplikat", payload: { ...VALID_SNAPSHOT_V1, lines: [VALID_SNAPSHOT_V1.lines[0], VALID_SNAPSHOT_V1.lines[0]] } },
    { label: "pickup dengan ongkir", payload: { ...VALID_SNAPSHOT_V1, fulfillmentMethod: "pickup" } },
    { label: "fulfillment tak dikenal", payload: { ...VALID_SNAPSHOT_V1, fulfillmentMethod: "courier" } },
    { label: "currency bukan IDR", payload: { ...VALID_SNAPSHOT_V1, currency: "USD" } },
  ];

  it.each(corruptedSnapshots)("menolak snapshot rusak: $label", ({ payload }) => {
    expectRejection(() => decodePricingSnapshot(payload), "PRICING_SNAPSHOT_CORRUPT");
  });
});

function stripVersion(snapshot: Record<string, unknown>): Record<string, unknown> {
  const { pricingContractVersion: _dropped, ...rest } = snapshot;
  return rest;
}

// Baris legacy: kolom relational yang SUDAH tersimpan (numeric(15,2) → string).
// Decoder legacy hanya membaca nilai tersimpan; tidak pernah menerapkan formula
// PPN kontrak baru maupun master/config saat ini.
const LEGACY_PICKUP_ROW = {
  pricingContractVersion: 0,
  pricingSnapshot: null,
  fulfillmentMethod: "pickup",
  subtotal: "100000.00",
  discount: "0.00",
  shippingCost: "0.00",
  serviceFee: "0.00",
  ppnRate: "11.000000",
  ppnAmount: "11000.00",
  total: "111000.00",
};

const LEGACY_DELIVERY_ROW = {
  pricingContractVersion: 0,
  pricingSnapshot: null,
  fulfillmentMethod: "delivery",
  subtotal: "100000.00",
  discount: "0.00",
  shippingCost: "20000.00",
  serviceFee: "0.00",
  ppnRate: "11.000000",
  // Legacy menagihkan PPN di atas barang+ongkir: 120000 × 11% = 13200.
  ppnAmount: "13200.00",
  total: "133200.00",
};

describe("decodeLegacyOrderPricing — decoder legacy eksplisit", () => {
  it("membaca money legacy pickup apa adanya tanpa formula kontrak baru", () => {
    const decoded = decodeLegacyOrderPricing(LEGACY_PICKUP_ROW);

    expect(decoded.pricingContractVersion).toBe(0);
    expect(decoded.currency).toBe("IDR");
    expect(decoded.fulfillmentMethod).toBe("pickup");
    expect(decoded.subtotal).toBe("100000");
    expect(decoded.discount).toBe("0");
    expect(decoded.shippingCost).toBe("0");
    expect(decoded.serviceFee).toBe("0");
    expect(decoded.ppnRatePercent).toBe("11");
    expect(decoded.ppnAmount).toBe("11000");
    expect(decoded.total).toBe("111000");
    expect(decoded.expectedProviderPayable).toBeNull();
  });

  it("tidak menghitung ulang PPN legacy delivery yang sudah tersimpan", () => {
    const decoded = decodeLegacyOrderPricing(LEGACY_DELIVERY_ROW);

    // Formula kontrak baru (PPN hanya net barang) akan menghasilkan 11000;
    // decoder legacy wajib mempertahankan nilai tersimpan 13200.
    expect(decoded.ppnAmount).toBe("13200");
    expect(decoded.total).toBe("133200");
    expect(decoded.shippingCost).toBe("20000");
  });

  it.each([
    { label: "presisi melebihi numeric(15,2)", row: { ...LEGACY_PICKUP_ROW, subtotal: "100000.005" } },
    { label: "total non-finite", row: { ...LEGACY_PICKUP_ROW, total: "Infinity" } },
    { label: "total negatif", row: { ...LEGACY_PICKUP_ROW, total: "-111000.00" } },
    { label: "PPN eksponen", row: { ...LEGACY_PICKUP_ROW, ppnAmount: "1.1e4" } },
    { label: "fulfillment tak dikenal", row: { ...LEGACY_PICKUP_ROW, fulfillmentMethod: "courier" } },
    { label: "rate di luar 0..100", row: { ...LEGACY_PICKUP_ROW, ppnRate: "111.000000" } },
  ])("menolak baris legacy rusak: $label", ({ row }) => {
    expectRejection(() => decodeLegacyOrderPricing(row), "PRICING_SNAPSHOT_CORRUPT");
  });

  it("mempertahankan cents legacy exact tanpa rounding atau repricing", () => {
    const decoded = decodeLegacyOrderPricing({
      ...LEGACY_PICKUP_ROW,
      subtotal: "909092.82",
      ppnAmount: "100001.00",
      total: "1009093.82",
    });

    expect(decoded.subtotal).toBe("909092.82");
    expect(decoded.ppnAmount).toBe("100001");
    expect(decoded.total).toBe("1009093.82");
  });
});

describe("readOrderPricing — dispatch versi eksplisit", () => {
  it("membaca snapshot pricing1 yang sah", () => {
    const decoded = readOrderPricing({
      ...LEGACY_DELIVERY_ROW,
      pricingContractVersion: 1,
      pricingSnapshot: VALID_SNAPSHOT_V1,
    });
    expect(decoded.pricingContractVersion).toBe(1);
    expect(decoded.total).toBe("196500");
    expect(decoded.expectedProviderPayable).toBe("180000");
  });

  it.each([0, null, undefined])(
    "membaca baris legacy (version %s) lewat decoder legacy eksplisit",
    (version) => {
      const decoded = readOrderPricing({
        ...LEGACY_PICKUP_ROW,
        pricingContractVersion: version,
      });
      expect(decoded.pricingContractVersion).toBe(0);
      expect(decoded.total).toBe("111000");
    }
  );

  it("tidak men-downgrade baris pricing1 yang payload-nya hilang atau rusak", () => {
    // Versi barisnya diketahui (1); payload null/rusak adalah korupsi, bukan
    // versi tak dikenal, dan tidak boleh fallback ke legacy.
    expectRejection(
      () =>
        readOrderPricing({
          ...LEGACY_PICKUP_ROW,
          pricingContractVersion: 1,
          pricingSnapshot: null,
        }),
      "PRICING_SNAPSHOT_CORRUPT"
    );
    expectRejection(
      () =>
        readOrderPricing({
          ...LEGACY_PICKUP_ROW,
          pricingContractVersion: 1,
          pricingSnapshot: { ...VALID_SNAPSHOT_V1, total: "1" },
        }),
      "PRICING_SNAPSHOT_CORRUPT"
    );
  });

  it("menolak versi order yang tidak dikenal tanpa fallback legacy", () => {
    expectRejection(
      () =>
        readOrderPricing({
          ...LEGACY_PICKUP_ROW,
          pricingContractVersion: 2,
          pricingSnapshot: VALID_SNAPSHOT_V1,
        }),
      "PRICING_UNSUPPORTED_VERSION"
    );
  });

  it("abaikan payload tak dikenal pada baris legacy", () => {
    const decoded = readOrderPricing({
      ...LEGACY_PICKUP_ROW,
      pricingSnapshot: { random: "stale" },
    });
    expect(decoded.pricingContractVersion).toBe(0);
  });

  it("menerima baris version1 tanpa kolom engine/provider (caller lama) dan baris yang konsisten", () => {
    const minimalRow = readOrderPricing({
      ...LEGACY_DELIVERY_ROW,
      pricingContractVersion: 1,
      pricingSnapshot: VALID_SNAPSHOT_V1,
    });
    expect(minimalRow.pricingContractVersion).toBe(1);

    const consistentRow = readOrderPricing({
      ...LEGACY_DELIVERY_ROW,
      pricingContractVersion: 1,
      pricingEngineVersion: 1,
      providerContractVersion: 2,
      pricingSnapshot: VALID_SNAPSHOT_V1,
    });
    expect(consistentRow.pricingContractVersion).toBe(1);
    expect(consistentRow.total).toBe("196500");
  });

  it.each([
    { label: "row engine 2 dengan payload engine 1", engine: 2, provider: 2 },
    { label: "row provider 3 dengan payload provider 2", engine: 1, provider: 3 },
    { label: "row provider 1 dengan payload provider 2", engine: 1, provider: 1 },
    { label: "row engine 0", engine: 0, provider: 2 },
  ])(
    "menolak versi relational yang tak dikenal pada baris pricing1: $label",
    ({ engine, provider }) => {
      expectRejection(
        () =>
          readOrderPricing({
            ...LEGACY_DELIVERY_ROW,
            pricingContractVersion: 1,
            pricingEngineVersion: engine,
            providerContractVersion: provider,
            pricingSnapshot: VALID_SNAPSHOT_V1,
          }),
        "PRICING_UNSUPPORTED_VERSION"
      );
    }
  );

  it("menolak versi relational yang tidak konsisten pada baris legacy", () => {
    expectRejection(
      () =>
        readOrderPricing({
          ...LEGACY_PICKUP_ROW,
          pricingContractVersion: 0,
          pricingEngineVersion: 1,
          providerContractVersion: 2,
        }),
      "PRICING_UNSUPPORTED_VERSION"
    );
  });
});

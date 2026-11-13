import dotenv from "dotenv";
import path from "node:path";
dotenv.config({ path: path.resolve(import.meta.dirname, "../../../.env"), quiet: true });
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";

// Seam D — SQL constraint tests untuk snapshot uang kontrak baru (spec §8.3).
// Assertions hanya lewat SQL/constraint Postgres (bukan pembacaan source schema).
// Fixture IDs berprefix dan cleanup FK-ordered; tidak ada TRUNCATE/delete luas.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 2,
  connectionTimeoutMillis: 2000,
});
let reachable = false;
try {
  const client = await pool.connect();
  client.release();
  reachable = true;
} catch {
  console.warn("pricing snapshot DB tests skipped: PostgreSQL unavailable");
}

const prefix = "pricing-snapshot-test-";
const clientId = `${prefix}client`;
const productId = `${prefix}product`;
const variantId = `${prefix}variant`;
const orderId = `${prefix}order`;
const legacyOrderId = `${prefix}legacy-order`;
const itemId = `${prefix}item`;

const ORDER_COLUMNS =
  "id, user_id, branch_id, contact_phone, contact_email, subtotal, discount, shipping_cost, service_fee, ppn_rate, ppn_amount, total";

// Snapshot literal otoritatif v1 (barang 150000, ongkir quote 30000, PPN 11%):
// ppn 16500 / total 196500 / expected provider payable 180000.
const PRICING_SNAPSHOT_V1 = {
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
      variantId,
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

// Snapshot literal provider3 (spec PPN §5.2/§5.3): fixture yang sama dengan
// provider2, tetapi PPN barang 16500 ikut menjadi payable provider 196500 dan
// setiap line membawa alokasi pajaknya sendiri.
const PRICING_SNAPSHOT_PROVIDER3 = {
  ...PRICING_SNAPSHOT_V1,
  providerContractVersion: 3,
  expectedProviderPayable: "196500",
  providerTax: { taxId: -2, ratePercent: "11" },
  lines: PRICING_SNAPSHOT_V1.lines.map((line) => ({
    ...line,
    providerTaxAmount: "16500",
  })),
};

const PRICING_ORDER_VALUES = [
  orderId, // 0 id
  clientId, // 1 user_id
  null, // 2 branch_id
  "081200000000", // 3 contact_phone
  "pricing-snapshot@example.test", // 4 contact_email
  "150000.00", // 5 subtotal
  "0.00", // 6 discount
  "30000.00", // 7 shipping_cost (net customer)
  "0.00", // 8 service_fee
  "11.000000", // 9 ppn_rate
  "16500.00", // 10 ppn_amount
  "196500.00", // 11 total
  "IDR", // 12 pricing_currency
  "150000.00", // 13 source_goods_subtotal
  "0.00", // 14 markdown_total
  "150000.00", // 15 net_goods
  "30000.00", // 16 shipping_before_subsidy
  "0.00", // 17 shipping_subsidy
  "0.00", // 18 merchant_funding
  "150000.00", // 19 taxable_base
  "180000.00", // 20 expected_provider_payable
  "27000.00", // 21 provider_quoted_shipping_cost
  null, // 22 provider_billed_shipping_cost
  1, // 23 pricing_contract_version
  1, // 24 pricing_engine_version
  2, // 25 provider_contract_version
  JSON.stringify(PRICING_SNAPSHOT_V1), // 26 pricing_snapshot
];

const insertPricingOrderSql = `
  INSERT INTO orders (${ORDER_COLUMNS},
    pricing_currency, source_goods_subtotal, markdown_total, net_goods,
    shipping_before_subsidy, shipping_subsidy, merchant_funding, taxable_base,
    expected_provider_payable, provider_quoted_shipping_cost, provider_billed_shipping_cost,
    pricing_contract_version, pricing_engine_version, provider_contract_version, pricing_snapshot)
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)
  RETURNING id`;

async function insertPricingOrder(): Promise<void> {
  await pool.query(insertPricingOrderSql, PRICING_ORDER_VALUES);
}

async function insertOrderItem(values: {
  id: string;
  variantId: string;
  pricingContractVersion: number;
  sourceUnitPrice: string | null;
  markdownAmount: string | null;
  goodsDiscountAmount: string | null;
  netLineAmount: string | null;
  quantity?: number;
  price?: string;
}): Promise<void> {
  await pool.query(
    `INSERT INTO order_item (id, order_id, variant_id, product_name, price, quantity,
       pricing_contract_version, source_unit_price, markdown_amount, goods_discount_amount,
       net_line_amount)
     VALUES ($1,$2,$3,'Pricing snapshot product',$9,$10,$4,$5,$6,$7,$8)`,
    [
      values.id,
      orderId,
      values.variantId,
      values.pricingContractVersion,
      values.sourceUnitPrice,
      values.markdownAmount,
      values.goodsDiscountAmount,
      values.netLineAmount,
      values.price ?? "75000.00",
      values.quantity ?? 2,
    ]
  );
}

/** Salinan fixture order kontrak baru dengan override per indeks parameter. */
function pricingOrderValuesWith(
  overrides: ReadonlyArray<[number, string | number | null]>
): Array<string | number | null> {
  const values: Array<string | number | null> = [...PRICING_ORDER_VALUES];
  for (const [index, value] of overrides) values[index] = value;
  return values;
}

async function expectSqlRejected(
  run: () => Promise<unknown>,
  expectedCode: string
): Promise<void> {
  let caught: unknown;
  try {
    await run();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(Error);
  expect((caught as { code?: string }).code).toBe(expectedCode);
}

async function cleanup(): Promise<void> {
  await pool.query("DELETE FROM order_item WHERE order_id = ANY($1)", [
    [orderId, legacyOrderId],
  ]);
  await pool.query("DELETE FROM orders WHERE id = ANY($1)", [[orderId, legacyOrderId]]);
  await pool.query("DELETE FROM product_variant WHERE product_id = $1", [productId]);
  await pool.query("DELETE FROM product WHERE id = $1", [productId]);
  await pool.query("DELETE FROM client WHERE id = $1", [clientId]);
}

beforeEach(async () => {
  if (!reachable) return;
  await cleanup();
  await pool.query(
    "INSERT INTO client (id, name, email) VALUES ($1,'Pricing snapshot test','pricing-snapshot@example.test')",
    [clientId]
  );
  await pool.query(
    "INSERT INTO product (id, name, slug, base_price, status) VALUES ($1,'Pricing snapshot','pricing-snapshot-test-slug',150000,'aktif')",
    [productId]
  );
  await pool.query(
    "INSERT INTO product_variant (id, product_id, sku, price) VALUES ($1,$2,'PRICING-SNAPSHOT-TEST',75000)",
    [variantId, productId]
  );
});

afterEach(async () => {
  if (!reachable) return;
  await cleanup();
});

afterAll(async () => {
  await pool.end();
});

describe("pricing snapshot money/version constraints (SQL)", () => {
  it.skipIf(!reachable)(
    "menerima order kontrak baru pricing1 dengan money, versi, dan snapshot lengkap",
    async () => {
      await insertPricingOrder();
      const row = (
        await pool.query(
          "SELECT pricing_contract_version, provider_contract_version, expected_provider_payable::text AS payable, pricing_snapshot->>'total' AS snapshot_total FROM orders WHERE id = $1",
          [orderId]
        )
      ).rows[0];

      expect(row.pricing_contract_version).toBe(1);
      expect(row.provider_contract_version).toBe(2);
      expect(row.payable).toBe("180000.00");
      expect(row.snapshot_total).toBe("196500");
    }
  );

  it.skipIf(!reachable)(
    "menerima order kontrak provider3 dengan PPN pada payable provider",
    async () => {
      const values = [...PRICING_ORDER_VALUES];
      values[20] = "196500.00"; // expected_provider_payable = net barang + PPN + net ongkir
      values[25] = 3; // provider_contract_version
      values[26] = JSON.stringify(PRICING_SNAPSHOT_PROVIDER3);
      await pool.query(insertPricingOrderSql, values);
      const row = (
        await pool.query(
          "SELECT provider_contract_version, expected_provider_payable::text AS payable, pricing_snapshot->>'total' AS snapshot_total, pricing_snapshot->'providerTax'->>'taxId' AS tax_id FROM orders WHERE id = $1",
          [orderId]
        )
      ).rows[0];

      expect(row.provider_contract_version).toBe(3);
      expect(row.payable).toBe("196500.00");
      expect(row.snapshot_total).toBe("196500");
      expect(row.tax_id).toBe("-2");
    }
  );

  it.skipIf(!reachable)(
    "menolak kombinasi versi provider yang tidak dikenal",
    async () => {
      for (const providerVersion of [1, 4]) {
        const values = [...PRICING_ORDER_VALUES];
        values[25] = providerVersion;
        await expectSqlRejected(
          () => pool.query(insertPricingOrderSql, values),
          "23514"
        );
      }
    }
  );

  it.skipIf(!reachable)(
    "menolak order pricing1 tanpa money kontrak lengkap",
    async () => {
      const values = [...PRICING_ORDER_VALUES];
      values[18] = null; // merchant_funding
      await expectSqlRejected(
        () => pool.query(insertPricingOrderSql, values),
        "23514"
      );
    }
  );

  it.skipIf(!reachable)("menolak order pricing1 tanpa snapshot atau currency bukan IDR", async () => {
    const withoutSnapshot = [...PRICING_ORDER_VALUES];
    withoutSnapshot[26] = null;
    await expectSqlRejected(
      () => pool.query(insertPricingOrderSql, withoutSnapshot),
      "23514"
    );

    const wrongCurrency = [...PRICING_ORDER_VALUES];
    wrongCurrency[12] = "USD";
    await expectSqlRejected(
      () => pool.query(insertPricingOrderSql, wrongCurrency),
      "23514"
    );
  });

  it.skipIf(!reachable)("menolak money kontrak negatif dan versi negatif", async () => {
    const negativePayable = [...PRICING_ORDER_VALUES];
    negativePayable[20] = "-1.00";
    await expectSqlRejected(
      () => pool.query(insertPricingOrderSql, negativePayable),
      "23514"
    );

    const negativeVersion = [...PRICING_ORDER_VALUES];
    negativeVersion[23] = -1;
    await expectSqlRejected(
      () => pool.query(insertPricingOrderSql, negativeVersion),
      "23514"
    );
  });

  it.skipIf(!reachable)("menolak snapshot melebihi batas 256KiB", async () => {
    const oversized = [...PRICING_ORDER_VALUES];
    oversized[26] = JSON.stringify({ ...PRICING_SNAPSHOT_V1, ignoredBlob: "x".repeat(300 * 1024) });
    await expectSqlRejected(
      () => pool.query(insertPricingOrderSql, oversized),
      "23514"
    );
  });

  it.skipIf(!reachable)(
    "baris legacy tetap boleh: version0 dan kolom money kontrak null",
    async () => {
      await pool.query(
        `INSERT INTO orders (${ORDER_COLUMNS}) VALUES ($1,$2,$3,$4,$5,'100000.00','0.00','0.00','0.00','11.000000','11000.00','111000.00')`,
        [
          legacyOrderId,
          clientId,
          null,
          "081200000000",
          "pricing-snapshot@example.test",
        ]
      );
      const row = (
        await pool.query(
          "SELECT pricing_contract_version, pricing_engine_version, provider_contract_version, pricing_snapshot, expected_provider_payable FROM orders WHERE id = $1",
          [legacyOrderId]
        )
      ).rows[0];

      expect(row.pricing_contract_version).toBe(0);
      expect(row.pricing_engine_version).toBe(0);
      expect(row.provider_contract_version).toBe(0);
      expect(row.pricing_snapshot).toBeNull();
      expect(row.expected_provider_payable).toBeNull();
    }
  );
});

describe("order item pricing snapshot constraints (SQL)", () => {
  beforeEach(async () => {
    if (!reachable) return;
    await insertPricingOrder();
  });

  it.skipIf(!reachable)("menerima line pricing1 lengkap", async () => {
    await insertOrderItem({
      id: itemId,
      variantId,
      pricingContractVersion: 1,
      sourceUnitPrice: "75000.00",
      markdownAmount: "0.00",
      goodsDiscountAmount: "0.00",
      netLineAmount: "150000.00",
    });
    const row = (
      await pool.query(
        "SELECT pricing_contract_version, net_line_amount::text AS net_line FROM order_item WHERE id = $1",
        [itemId]
      )
    ).rows[0];
    expect(row.pricing_contract_version).toBe(1);
    expect(row.net_line).toBe("150000.00");
  });

  it.skipIf(!reachable)("menolak line pricing1 tanpa money line lengkap", async () => {
    await expectSqlRejected(
      () =>
        insertOrderItem({
          id: itemId,
          variantId,
          pricingContractVersion: 1,
          sourceUnitPrice: null,
          markdownAmount: "0.00",
          goodsDiscountAmount: "0.00",
          netLineAmount: "150000.00",
        }),
      "23514"
    );
    await expectSqlRejected(
      () =>
        insertOrderItem({
          id: `${itemId}-net`,
          variantId,
          pricingContractVersion: 1,
          sourceUnitPrice: "75000.00",
          markdownAmount: "0.00",
          goodsDiscountAmount: "0.00",
          netLineAmount: null,
        }),
      "23514"
    );
  });

  it.skipIf(!reachable)("menolak line legacy tanpa memaksa kolom kontrak baru", async () => {
    await insertOrderItem({
      id: itemId,
      variantId,
      pricingContractVersion: 0,
      sourceUnitPrice: null,
      markdownAmount: null,
      goodsDiscountAmount: null,
      netLineAmount: null,
    });
    const row = (
      await pool.query(
        "SELECT pricing_contract_version FROM order_item WHERE id = $1",
        [itemId]
      )
    ).rows[0];
    expect(row.pricing_contract_version).toBe(0);
  });

  it.skipIf(!reachable)("menolak dua line untuk variant yang sama pada satu order", async () => {
    await insertOrderItem({
      id: itemId,
      variantId,
      pricingContractVersion: 0,
      sourceUnitPrice: null,
      markdownAmount: null,
      goodsDiscountAmount: null,
      netLineAmount: null,
    });
    await expectSqlRejected(
      () =>
        insertOrderItem({
          id: `${itemId}-duplicate`,
          variantId,
          pricingContractVersion: 0,
          sourceUnitPrice: null,
          markdownAmount: null,
          goodsDiscountAmount: null,
          netLineAmount: null,
        }),
      "23505"
    );
  });
});

describe("pricing v1 header invariants (SQL review)", () => {
  it.skipIf(!reachable)(
    "menolak order pricing1 tanpa pricing_currency eksplisit",
    async () => {
      await expectSqlRejected(
        () => pool.query(insertPricingOrderSql, pricingOrderValuesWith([[12, null]])),
        "23514"
      );
    }
  );

  it.skipIf(!reachable)("menolak kombinasi versi legacy selain 0/0/0", async () => {
    await expectSqlRejected(
      () =>
        pool.query(
          insertPricingOrderSql,
          pricingOrderValuesWith([
            [23, 0], // pricing_contract_version
            [24, 1], // pricing_engine_version
            [25, 2], // provider_contract_version
          ])
        ),
      "23514"
    );
  });

  it.skipIf(!reachable)(
    "menolak kombinasi versi kontrak baru selain 1/1/2 dan 1/1/3",
    async () => {
      await expectSqlRejected(
        () => pool.query(insertPricingOrderSql, pricingOrderValuesWith([[24, 2]])),
        "23514"
      );
      // Provider3 kini kombinasi SAH (PPN provider); versi 4 tetap unknown.
      await expectSqlRejected(
        () => pool.query(insertPricingOrderSql, pricingOrderValuesWith([[25, 4]])),
        "23514"
      );
    }
  );

  it.skipIf(!reachable)("menolak service fee nonzero pada kontrak baru", async () => {
    await expectSqlRejected(
      () =>
        pool.query(
          insertPricingOrderSql,
          pricingOrderValuesWith([
            [8, "1000.00"], // service_fee
            [11, "197500.00"], // total
          ])
        ),
      "23514"
    );
  });

  it.skipIf(!reachable)(
    "menolak money header dipakai ulang bernilai NaN pada kontrak baru",
    async () => {
      for (const index of [6, 7, 8, 10]) {
        // discount, shipping_cost, service_fee, ppn_amount
        await expectSqlRejected(
          () => pool.query(insertPricingOrderSql, pricingOrderValuesWith([[index, "NaN"]])),
          "23514"
        );
      }
    }
  );

  it.skipIf(!reachable)(
    "menolak money header dipakai ulang berpecahan pada kontrak baru",
    async () => {
      for (const [index, value] of [
        [6, "0.50"],
        [7, "30000.50"],
        [10, "16500.50"],
      ] as ReadonlyArray<[number, string]>) {
        await expectSqlRejected(
          () => pool.query(insertPricingOrderSql, pricingOrderValuesWith([[index, value]])),
          "23514"
        );
      }
    }
  );

  it.skipIf(!reachable)(
    "menolak money header dipakai ulang negatif pada kontrak baru",
    async () => {
      for (const index of [5, 6, 7, 8, 10, 11]) {
        // subtotal, discount, shipping_cost, service_fee, ppn_amount, total
        await expectSqlRejected(
          () => pool.query(insertPricingOrderSql, pricingOrderValuesWith([[index, "-1.00"]])),
          "23514"
        );
      }
    }
  );

  it.skipIf(!reachable)(
    "menolak quote/billed provider bukan Rupiah utuh pada kontrak baru",
    async () => {
      await expectSqlRejected(
        () => pool.query(insertPricingOrderSql, pricingOrderValuesWith([[21, "27000.50"]])),
        "23514"
      );
      await expectSqlRejected(
        () => pool.query(insertPricingOrderSql, pricingOrderValuesWith([[22, "30000.50"]])),
        "23514"
      );
      await expectSqlRejected(
        () => pool.query(insertPricingOrderSql, pricingOrderValuesWith([[21, "NaN"]])),
        "23514"
      );
    }
  );

  it.skipIf(!reachable)(
    "menolak PPN rate di luar 0..100 atau NaN pada kontrak baru",
    async () => {
      await expectSqlRejected(
        () => pool.query(insertPricingOrderSql, pricingOrderValuesWith([[9, "111.000000"]])),
        "23514"
      );
      await expectSqlRejected(
        () => pool.query(insertPricingOrderSql, pricingOrderValuesWith([[9, "NaN"]])),
        "23514"
      );
    }
  );
});

describe("order item pricing v1 invariants (SQL review)", () => {
  beforeEach(async () => {
    if (!reachable) return;
    await insertPricingOrder();
  });

  const negativeLines = [
    { field: "source_unit_price", sourceUnitPrice: "-75000.00", markdownAmount: "0.00", goodsDiscountAmount: "0.00", netLineAmount: "150000.00" },
    { field: "markdown_amount", sourceUnitPrice: "75000.00", markdownAmount: "-1.00", goodsDiscountAmount: "0.00", netLineAmount: "150000.00" },
    { field: "goods_discount_amount", sourceUnitPrice: "75000.00", markdownAmount: "0.00", goodsDiscountAmount: "-1.00", netLineAmount: "150000.00" },
    { field: "net_line_amount", sourceUnitPrice: "75000.00", markdownAmount: "0.00", goodsDiscountAmount: "0.00", netLineAmount: "-150000.00" },
  ];

  it.skipIf(!reachable)("menolak money line negatif pada kontrak baru", async () => {
    for (const [offset, line] of negativeLines.entries()) {
      await expectSqlRejected(
        () =>
          insertOrderItem({
            id: `${itemId}-negative-${offset}`,
            variantId,
            pricingContractVersion: 1,
            sourceUnitPrice: line.sourceUnitPrice,
            markdownAmount: line.markdownAmount,
            goodsDiscountAmount: line.goodsDiscountAmount,
            netLineAmount: line.netLineAmount,
          }),
        "23514"
      );
    }
  });

  it.skipIf(!reachable)("menolak money line NaN pada kontrak baru", async () => {
    await expectSqlRejected(
      () =>
        insertOrderItem({
          id: `${itemId}-nan-source`,
          variantId,
          pricingContractVersion: 1,
          sourceUnitPrice: "NaN",
          markdownAmount: "0.00",
          goodsDiscountAmount: "0.00",
          netLineAmount: "150000.00",
        }),
      "23514"
    );
    await expectSqlRejected(
      () =>
        insertOrderItem({
          id: `${itemId}-nan-net`,
          variantId,
          pricingContractVersion: 1,
          sourceUnitPrice: "75000.00",
          markdownAmount: "0.00",
          goodsDiscountAmount: "0.00",
          netLineAmount: "NaN",
        }),
      "23514"
    );
  });

  it.skipIf(!reachable)("menolak money line berpecahan pada kontrak baru", async () => {
    await expectSqlRejected(
      () =>
        insertOrderItem({
          id: `${itemId}-fraction`,
          variantId,
          pricingContractVersion: 1,
          sourceUnitPrice: "75000.00",
          markdownAmount: "0.00",
          goodsDiscountAmount: "0.00",
          netLineAmount: "150000.50",
        }),
      "23514"
    );
  });

  it.skipIf(!reachable)("menolak quantity di luar 1..99 pada line kontrak baru", async () => {
    await expectSqlRejected(
      () =>
        insertOrderItem({
          id: `${itemId}-qty`,
          variantId,
          pricingContractVersion: 1,
          sourceUnitPrice: "75000.00",
          markdownAmount: "0.00",
          goodsDiscountAmount: "0.00",
          netLineAmount: "150000.00",
          quantity: 100,
        }),
      "23514"
    );
  });

  it.skipIf(!reachable)(
    "masih menerima line legacy dengan money null dan cents (semantik numeric legacy)",
    async () => {
      await insertOrderItem({
        id: `${itemId}-legacy-accepted`,
        variantId,
        pricingContractVersion: 0,
        sourceUnitPrice: null,
        markdownAmount: null,
        goodsDiscountAmount: null,
        netLineAmount: null,
        price: "75000.55",
      });
      const row = (
        await pool.query(
          "SELECT price::text AS price FROM order_item WHERE id = $1",
          [`${itemId}-legacy-accepted`]
        )
      ).rows[0];
      expect(row.price).toBe("75000.55");
    }
  );
});

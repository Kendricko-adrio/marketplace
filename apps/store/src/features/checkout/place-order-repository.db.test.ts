import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Pool, type PoolClient } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@marketplace/db/src/schema";
import { loadBranch, loadCart, loadCartItems, loadAddress, holdBranchStock, loadHoldStockSnapshot, loadFreshVariants, saveCheckoutAddress } from "./place-order-repository";
import { placeOrderLegacy, type PlaceOrderLegacyInput } from "./place-order-legacy-service";
import { InsufficientStockError } from "./place-order-errors";

const provider = vi.hoisted(() => ({
  create: vi.fn<(input: { orderId: string }) => Promise<{ status: string }>>(async () => ({ status: "confirmed" })),
  // Spec TX-02: the durable payment claim requires a CONFIRMED Sales Order, so
  // this fixture confirms the persisted create operation like the real
  // lifecycle does after its independent GET.
  confirm: async (orderId: string) => { void orderId; },
}));
vi.mock("@/lib/jubelio-sales-lifecycle", async (original) => ({
  ...await original<typeof import("@/lib/jubelio-sales-lifecycle")>(),
  dispatchJubelioSalesCreate: async (input: { orderId: string }) => {
    await provider.confirm(input.orderId);
    return provider.create(input);
  },
}));

const url = process.env.DATABASE_URL;
const enabled = !!url && /^marketplace_discounts_test_[A-Za-z0-9_]+$/.test(new URL(url).pathname.slice(1));
if (url && !enabled) throw new Error("Place-order repository tests refuse non-disposable databases");
const pool = new Pool({ connectionString: url, max: 2 });
afterAll(async () => { await pool.end(); });
let connection: PoolClient;
const database = () => drizzle(connection, { schema });

const anchor = new Date("2040-01-01T00:00:00Z");
const destination = { recipientName: "Customer", phone: "081234567890", fullAddress: "Destination", postalCode: "01234", areaId: "01010101", canonical: { provinceId: "01", province: "Province", cityId: "0101", city: "City", districtId: "010101", district: "District", areaId: "01010101", area: "Area", postalCode: "01234" } };
const newAddressBody = { fulfillmentMethod: "delivery" as const, contactPhone: "081234567890", contactEmail: "test@example.invalid", itemIds: ["item"], courierId: 1, serviceId: 2, approvedPricing: {}, originFingerprint: "a".repeat(64), saveAddress: true, saveRequestId: "a1200000-0000-4000-8000-000000000023", newAddress: { recipientName: "Customer", phone: "081234567890", fullAddress: "Destination", provinceId: "01", cityId: "0101", districtId: "010101", areaId: "01010101", postalCode: "01234", isDefault: true } };
const step = <T>(query: () => PromiseLike<T>) => Promise.resolve(query());

describe.skipIf(!enabled)("place-order persistence boundary (PostgreSQL)", () => {
  beforeAll(async () => { await pool.query("SELECT 1"); });
  beforeEach(async () => {
    connection = await pool.connect();
    await connection.query("BEGIN");
    await connection.query("INSERT INTO client(id,name,email) VALUES ('place-read-owner','Owner','place-read-owner@example.test'),('place-read-other','Other','place-read-other@example.test')");
    await connection.query("INSERT INTO branch(id,name,code,city,address,jubelio_location_id) VALUES ('place-read-branch','Branch','PLACE-READ','Test','Test',99123)");
    await connection.query("INSERT INTO product(id,name,slug,base_price) VALUES ('place-read-product','Shoes','place-read-product',1000)");
    await connection.query("INSERT INTO product_variant(id,product_id,sku,price,jubelio_item_id,color,size) VALUES ('place-read-variant','place-read-product','PLACE-READ',1000,99123,'Black','40')");
    await connection.query("INSERT INTO branch_stock(branch_id,product_variant_id,stock,available_stock,provider_stock_synced_at) VALUES ('place-read-branch','place-read-variant',3,3,$1)", [anchor]);
    await connection.query("INSERT INTO address(id,user_id,first_name,last_name,phone,full_address,city,district,postal_code) VALUES ('place-read-address','place-read-owner','Owner','','0800000000','Address','City','District','01234')");
    await connection.query("INSERT INTO cart(id,user_id) VALUES ('place-read-cart','place-read-owner'),('place-read-other-cart','place-read-other')");
    await connection.query("INSERT INTO cart_item(id,cart_id,variant_id,branch_id,quantity) VALUES ('place-read-item','place-read-cart','place-read-variant','place-read-branch',2),('place-read-other-item','place-read-other-cart','place-read-variant','place-read-branch',3)");
  });
  afterEach(async () => { await connection.query("ROLLBACK"); connection.release(); });
  it("loads only the actor's cart and preserves a missing-cart result", async () => {
    expect(await loadCart("place-read-owner", database())).toMatchObject([{ id: "place-read-cart", userId: "place-read-owner" }]);
    expect(await loadCart("missing-owner", database())).toEqual([]);
  });
  it("projects source pricing, provider linkage and cart observation without leaking another cart", async () => {
    const items = await loadCartItems("place-read-cart", database());
    expect(items).toEqual([{
      cartItemId: "place-read-item", cartItemUpdatedAt: expect.any(Date), quantity: 2,
      variantId: "place-read-variant", variantColor: "Black", variantSize: "40", variantPrice: "1000.00",
      parcelDimensions: null, jubelioItemId: 99123, productId: "place-read-product", productName: "Shoes", branchId: "place-read-branch",
    }]);
    expect(await loadCartItems("missing-cart", database())).toEqual([]);
  });
  it("enforces address ownership in the locked read", async () => {
    expect(await loadAddress(database(), "place-read-address", "place-read-owner")).toMatchObject([{ id: "place-read-address" }]);
    expect(await loadAddress(database(), "place-read-address", "place-read-other")).toEqual([]);
  });
  it("holds only the observed sellable stock, refusing a second oversized hold and a stale observation", async () => {
    expect(await holdBranchStock(database(), "place-read-branch", "place-read-variant", 2, anchor)).toEqual([{ branchId: "place-read-branch" }]);
    expect(await holdBranchStock(database(), "place-read-branch", "place-read-variant", 2, anchor)).toEqual([]);
    expect(await holdBranchStock(database(), "place-read-branch", "place-read-variant", 1, new Date("2039-01-01T00:00:00Z"))).toEqual([]);
    expect((await connection.query("SELECT pending_remote_stock FROM branch_stock WHERE branch_id='place-read-branch'")).rows).toEqual([{ pending_remote_stock: 2 }]);
    expect(await loadHoldStockSnapshot(database(), "place-read-branch", "place-read-variant")).toEqual([{ availableStock: 3, providerStockSyncedAt: anchor }]);
  });
  it("locks source variants in sorted order rather than caller selection order", async () => {
    await connection.query("INSERT INTO product_variant(id,product_id,sku,price) VALUES ('place-read-a','place-read-product','PLACE-READ-A',1000)");
    expect((await loadFreshVariants(database(), ["place-read-variant", "place-read-a"])).map((row) => row.id)).toEqual(["place-read-a", "place-read-variant"]);
  });
  it("deduplicates a stable address save and refuses reusing it for a different destination", async () => {
    const input = { tx: database(), step, clientId: "place-read-owner", isDelivery: true, deliveryBody: newAddressBody, verifiedNewAddress: destination };
    const first = await saveCheckoutAddress(input);
    expect(first).toMatch(/^checkout:[a-f0-9]{64}$/);
    expect(await saveCheckoutAddress(input)).toBe(first);
    expect((await connection.query("SELECT count(*)::int AS count FROM address WHERE user_id='place-read-owner' AND is_default=true")).rows).toEqual([{ count: 1 }]);
    await expect(saveCheckoutAddress({ ...input, verifiedNewAddress: { ...destination, fullAddress: "Different" } })).rejects.toThrow("Checkout address save request reused with a different destination");
  });
  it("retains branch config and missing-branch semantics", async () => {
    expect(await loadBranch("place-read-branch", database())).toMatchObject([{ id: "place-read-branch", status: "aktif", jubelioLocationId: 99123, operatingHours: {} }]);
    expect(await loadBranch("missing-branch", database())).toEqual([]);
  });
});

// Fixture committed agar dua koneksi sungguhan melihat unit terakhir yang sama.
// Hanya namespace place-write-* di DB disposable milik run ini yang disentuh.
describe.skipIf(!enabled)("place-order legacy atomicity and concurrency (PostgreSQL)", () => {
  beforeAll(async () => {
    await pool.query("INSERT INTO client(id,name,email) VALUES ('place-write-owner','Owner','place-write-owner@example.test')");
    await pool.query("INSERT INTO branch(id,name,code,city,address) VALUES ('place-write-branch','Branch','PLACE-WRITE','Test','Test')");
    await pool.query("INSERT INTO product(id,name,slug,base_price) VALUES ('place-write-product','Shoes','place-write-product',1000)");
    await pool.query("INSERT INTO product_variant(id,product_id,sku,price) VALUES ('place-write-variant','place-write-product','PLACE-WRITE',1000)");
    await pool.query("INSERT INTO cart(id,user_id) VALUES ('place-write-cart','place-write-owner')");
    await pool.query("INSERT INTO branch_stock(branch_id,product_variant_id,stock,available_stock,provider_stock_synced_at) VALUES ('place-write-branch','place-write-variant',3,3,$1)", [anchor]);
  });
  const cleanupOrders = async () => {
    // Spec TX-02: the order-owned payment session references the order with
    // RESTRICT, so it is cleared BEFORE the order rows.
    await pool.query("DELETE FROM order_payment_session WHERE order_id LIKE 'place-write-order-%'");
    await pool.query("DELETE FROM jubelio_sales_operation WHERE order_id LIKE 'place-write-order-%'");
    await pool.query("DELETE FROM order_item WHERE order_id LIKE 'place-write-order-%'");
    await pool.query("DELETE FROM orders WHERE id LIKE 'place-write-order-%'");
  };
  beforeEach(async () => {
    provider.create.mockClear();
    provider.confirm = async (orderId: string) => {
      await pool.query(
        "UPDATE jubelio_sales_operation SET status='confirmed', sales_order_id=99001, confirmed_at=now(), updated_at=now() WHERE order_id=$1 AND type='create'",
        [orderId]
      );
    };
    await cleanupOrders();
    await pool.query("UPDATE branch_stock SET pending_remote_stock=0, available_stock=3 WHERE branch_id='place-write-branch'");
    await pool.query("INSERT INTO cart_item(id,cart_id,variant_id,branch_id,quantity) VALUES ('place-write-item','place-write-cart','place-write-variant','place-write-branch',2) ON CONFLICT DO NOTHING");
  });
  afterAll(async () => {
    await cleanupOrders();
    await pool.query("DELETE FROM cart WHERE id='place-write-cart'");
    await pool.query("DELETE FROM branch_stock WHERE branch_id='place-write-branch'");
    await pool.query("DELETE FROM product WHERE id='place-write-product'");
    await pool.query("DELETE FROM branch WHERE id='place-write-branch'");
    await pool.query("DELETE FROM client WHERE id='place-write-owner'");
  });
  async function input(orderId: string): Promise<PlaceOrderLegacyInput> {
    return {
      actor: { id: "place-write-owner", name: "Customer" }, recovery: {},
      selectedItems: await loadCartItems("place-write-cart"), selectedItemIds: ["place-write-item"], cart: { id: "place-write-cart" },
      branchId: "place-write-branch", branch: await loadBranch("place-write-branch"),
      pricingSnapshot: null, pricing: { subtotal: "2000.00", discount: "0.00", shippingCost: "0.00", taxableBase: "2000.00", serviceFee: "0.00", ppnRatePercent: "11", ppnAmount: "220.00", total: "2220.00" }, offerCandidate: null,
      isDelivery: false, deliverySnapshot: null, deliveryBody: null, verifiedNewAddress: null,
      pickupDate: "2040-01-01", pickupTime: "10:00", phone: "081234567890", email: "test@example.invalid",
      effectiveOf: (item) => item.variantPrice, markdownRevisionOf: () => null,
      orderId, createReference: `reference:${orderId}`, createRequest: { contactId: -1, customerName: "Customer", locationId: 1, note: `reference:${orderId}`, items: [{ itemId: 1, quantity: 2, price: 1000, discAmount: 0, taxAmount: 0, unit: "Buah", taxId: 1 }] },
      paymentStartedAt: anchor, expiresAt: new Date("2040-01-01T00:15:00Z"), ttlMinutes: 15, total: 2220,
      paymentItemDetails: [{ id: "variant", name: "Shoes", price: 1000, quantity: 2 }, { id: "PPN", name: "PPN 11%", price: 220, quantity: 1 }],
      stockCheck: { observedAt: anchor },
      initializeCheckoutPayment: async () => ({ kind: "ready", token: "fixture-token", redirectUrl: "https://payment.invalid" }),
    };
  }
  it("rolls back order, items, hold and intent when the observation changes before hold", async () => {
    const request = await input("place-write-order-rollback");
    request.stockCheck = { observedAt: new Date("2039-01-01T00:00:00Z") };
    const result = await placeOrderLegacy(request);
    expect(result.kind).toBe("legacy-failure");
    if (result.kind !== "legacy-failure") throw new Error("Expected atomic refusal");
    expect(result.error).toBeInstanceOf(InsufficientStockError);
    expect(result.error).toMatchObject({ missingSnapshot: true });
    expect((await pool.query("SELECT count(*)::int AS count FROM orders WHERE id='place-write-order-rollback'")).rows).toEqual([{ count: 0 }]);
    expect((await pool.query("SELECT pending_remote_stock FROM branch_stock WHERE branch_id='place-write-branch'")).rows).toEqual([{ pending_remote_stock: 0 }]);
    expect((await pool.query("SELECT count(*)::int AS count FROM cart_item WHERE id='place-write-item'")).rows).toEqual([{ count: 1 }]);
    expect(provider.create).not.toHaveBeenCalled();
  });
  it("allows only one of two concurrent checkouts to hold the remaining units", async () => {
    const requests = await Promise.all([input("place-write-order-a"), input("place-write-order-b")]);
    const results = await Promise.all(requests.map(placeOrderLegacy));
    expect(results.map((result) => result.kind).sort()).toEqual(["legacy-failure", "legacy-success"]);
    expect((await pool.query("SELECT count(*)::int AS count FROM orders WHERE id LIKE 'place-write-order-%'")).rows).toEqual([{ count: 1 }]);
    expect((await pool.query("SELECT pending_remote_stock FROM branch_stock WHERE branch_id='place-write-branch'")).rows).toEqual([{ pending_remote_stock: 2 }]);
    expect(provider.create).toHaveBeenCalledTimes(1);
  });
});

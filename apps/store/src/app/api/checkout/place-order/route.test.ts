import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PgDialect } from "drizzle-orm/pg-core";
import { getTableName, type SQL } from "drizzle-orm";

// Boundary-only doubles: session, database, and external HTTP. Checkout stock,
// pricing and the route itself are real. No Jubelio/Midtrans writes can escape.
const state = vi.hoisted(() => ({
  quantities: [10, 8], available: [5, 3], pending: [0, 0], providerFails: false, omitLast: false,
}));
vi.mock("@/lib/route-access", () => ({ requireOnboardedApiSession: async () => ({
  ok: true, session: { user: { id: "client", name: "Customer" } },
}) }));
vi.mock("@/db", async () => {
  const schema = await import("@marketplace/db/src/schema");
  const tableName = (table: Parameters<typeof getTableName>[0]) => getTableName(table);
  const indexFor = (where: SQL) => {
    const params = new PgDialect().sqlToQuery(where).params;
    return params.includes("variant-1") || params.includes("item-1") ? 1 : 0;
  };
  const items = () => state.quantities.map((quantity, index) => ({
    cartItemId: `item-${index}`, id: `item-${index}`, quantity,
    variantId: `variant-${index}`, variantColor: null, variantSize: null,
    variantPrice: "1000", parcelDimensions: null, jubelioItemId: 100 + index,
    productId: `product-${index}`, productName: `Product ${index}`, branchId: "branch",
    variant: { id: `variant-${index}`, price: "1000" },
    product: { id: `product-${index}`, name: `Product ${index}`, thumbnail: "image.png" },
    branch: { id: "branch", name: "Branch", city: "Test" },
  }));
  const db = {
    select: (projection?: Record<string, unknown>) => {
      let table = ""; let index = 0;
      const result = () => {
        if (table === "system_config") return [];
        if (table === "cart") return [{ id: "cart", userId: "client" }];
        if (table === "cart_item") return items();
        if (table === "branch") return [{ id: "branch", status: "aktif", jubelioLocationId: 7, operatingHours: { tuesday: { open: "09:00", close: "17:00" } } }];
        if (table === "branch_stock") return [{
          available: state.available[index], pending: state.pending[index], onOrder: 0,
        }];
        throw new Error(`Unexpected database read: ${table}, ${Object.keys(projection ?? {})}`);
      };
      const query = {
        from: (value: Parameters<typeof getTableName>[0]) => { table = tableName(value); return query; },
        where: (where: SQL) => { index = indexFor(where); return query; },
        innerJoin: () => query, leftJoin: () => query, limit: () => query,
        then: (resolve: (rows: unknown[]) => unknown) => Promise.resolve(result()).then(resolve),
      };
      return query;
    },
    update: (table: Parameters<typeof getTableName>[0]) => ({
      set: (values: { quantity?: number; availableStock?: number }) => ({
        where: (where: SQL) => {
          const index = indexFor(where);
          if (tableName(table) === "cart_item" && values.quantity !== undefined) state.quantities[index] = values.quantity;
          if (tableName(table) === "branch_stock" && values.availableStock !== undefined) state.available[index] = values.availableStock;
          const done = Promise.resolve([]);
          return Object.assign(done, { returning: async () => [{ id: `item-${index}`, pending: state.pending[index] }] });
        },
      }),
    }),
    insert: (table: Parameters<typeof getTableName>[0]) => {
      if (tableName(table) !== "cart") throw new Error("Stock refusal must not create an order or intent");
      return { values: () => ({ onConflictDoNothing: async () => undefined }) };
    },
    transaction: async <T>(run: (tx: unknown) => Promise<T>): Promise<T> => run(db),
  };
  return { ...schema, db };
});

const externalRequests: string[] = [];
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-01T00:00:00Z"));
  state.quantities = [10, 8]; state.available = [5, 3]; state.pending = [0, 0]; state.providerFails = false; state.omitLast = false;
  externalRequests.length = 0;
  vi.stubEnv("JUBELIO_EMAIL", "test@example.invalid");
  vi.stubEnv("JUBELIO_PASSWORD", "test-only");
  vi.stubEnv("JUBELIO_SYNC_MAX_RETRIES", "0");
  vi.stubGlobal("fetch", async (input: string | URL | Request) => {
    const url = String(input); externalRequests.push(url);
    if (url.endsWith("/login")) return Response.json({ token: "test-token" });
    if (url.endsWith("/inventory/items/all-stocks/")) {
      if (state.providerFails) throw new Error("Provider unavailable");
      return Response.json({ locations: [{ location_id: 7, location_name: "Branch" }], data: state.available.slice(0, state.omitLast ? 1 : 2).map((available, index) => ({
        item_id: 100 + index, location_stocks: [{ location_id: 7, on_hand: available, on_order: 0, reserved: 0, available }],
      })) });
    }
    throw new Error(`Forbidden external call in stock-refusal test: ${url}`);
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

async function checkout(delivery = false) {
  const { POST } = await import("./route");
  return POST(new NextRequest("http://localhost/api/checkout/place-order", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(delivery ? {
      fulfillmentMethod: "delivery", itemIds: ["item-0", "item-1"],
      contactPhone: "081234567890", contactEmail: "test@example.invalid",
      addressId: "address", courierId: 1, serviceId: 1, approvedPricing: {}, originFingerprint: "a".repeat(64),
    } : { phone: "081234567890", email: "test@example.invalid", pickupDate: "2030-01-01", pickupTime: "10:00", selectedItemIds: ["item-0", "item-1"] }),
  }));
}
async function validateCart() {
  const { POST } = await import("../../cart/validate-checkout/route");
  return POST(new NextRequest("http://localhost/api/cart/validate-checkout", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ selectedItemIds: ["item-0", "item-1"] }),
  }));
}
async function readCart() {
  const { GET } = await import("../../cart/route");
  return (await (await GET(new NextRequest("http://localhost/api/cart"))).json()).data;
}

describe("cart Checkout button stock validation HTTP contract", () => {
  it("blocks entering checkout with 31 units when live sellable stock is 20 and saves quantity 20", async () => {
    state.quantities = [31, 2]; state.available = [20, 5];
    const response = await validateCart();
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ success: false, code: "CHECKOUT_STOCK_ADJUSTED", adjustments: [
      { cartItemId: "item-0", requestedQuantity: 31, availableQuantity: 20 },
    ] });
    const cart = await readCart();
    expect(cart.items.map((item: { quantity: number }) => item.quantity)).toEqual([20, 2]);
    expect(cart.subtotal).toBe(22000);
    expect(externalRequests.some(url => url.endsWith("/inventory/items/all-stocks/"))).toBe(true);
    expect(externalRequests.every(url => url.endsWith("/login") || url.endsWith("/inventory/items/all-stocks/"))).toBe(true);
    // Only a deliberate second Checkout request may enter checkout.
    expect((await validateCart()).status).toBe(200);
  });

  it("reports zero stock without deleting cart items or changing sufficient quantities", async () => {
    state.available = [0, 20];
    const response = await validateCart();
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "CHECKOUT_STOCK_ADJUSTED", adjustments: [
      { cartItemId: "item-0", availableQuantity: 0 },
    ] });
    expect((await readCart()).items.map((item: { quantity: number }) => item.quantity)).toEqual([10, 8]);
  });

  it("blocks the cart Checkout request without adjusting quantities when Jubelio cannot be verified", async () => {
    state.providerFails = true;
    const response = await validateCart();
    expect(response.status).toBe(503);
    expect(await response.json()).not.toHaveProperty("adjustments");
    expect((await readCart()).items.map((item: { quantity: number }) => item.quantity)).toEqual([10, 8]);
  });

  it("never partially adjusts a cart when another selected item has no live observation", async () => {
    state.omitLast = true;
    expect((await validateCart()).status).toBe(503);
    expect((await readCart()).items.map((item: { quantity: number }) => item.quantity)).toEqual([10, 8]);
  });
});

describe("checkout stock adjustment HTTP contract", () => {
  it("rejects delivery checkout, reduces every insufficient quantity, and exposes the saved cart", async () => {
    const response = await checkout(true);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ success: false, code: "CHECKOUT_STOCK_ADJUSTED", adjustments: [
      { cartItemId: "item-0", requestedQuantity: 10, availableQuantity: 5 },
      { cartItemId: "item-1", requestedQuantity: 8, availableQuantity: 3 },
    ] });
    const cart = await readCart();
    expect(cart.items.map((item: { quantity: number }) => item.quantity)).toEqual([5, 3]);
    expect(cart.subtotal).toBe(8000);
    expect(externalRequests.some(url => url.endsWith("/inventory/items/all-stocks/"))).toBe(true);
    expect(externalRequests.every(url => url.endsWith("/login") || url.endsWith("/inventory/items/all-stocks/"))).toBe(true);
  });

  it("keeps a zero-stock item in cart, while reducing other items after subtracting pending holds", async () => {
    state.available = [1, 7]; state.pending = [2, 2];
    const response = await checkout();
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "CHECKOUT_STOCK_ADJUSTED", adjustments: [
      { cartItemId: "item-0", availableQuantity: 0 },
      { cartItemId: "item-1", availableQuantity: 5 },
    ] });
    expect((await readCart()).items.map((item: { quantity: number }) => item.quantity)).toEqual([10, 5]);
  });

  it("does not change quantities when the provider is unreachable", async () => {
    state.providerFails = true;
    const response = await checkout(true);
    expect(response.status).toBe(503);
    expect(await response.json()).not.toHaveProperty("adjustments");
    expect((await readCart()).items.map((item: { quantity: number }) => item.quantity)).toEqual([10, 8]);
  });

  it("does not partially adjust a shortage when another selected observation is missing", async () => {
    state.omitLast = true;
    const response = await checkout(true);
    expect(response.status).toBe(503);
    expect(await response.json()).not.toHaveProperty("adjustments");
    expect((await readCart()).items.map((item: { quantity: number }) => item.quantity)).toEqual([10, 8]);
  });

  it("only reduces insufficient items and leaves a sufficient item unchanged", async () => {
    state.available = [5, 20];
    const response = await checkout();
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.adjustments).toEqual([{ cartItemId: "item-0", productName: "Product 0", requestedQuantity: 10, availableQuantity: 5 }]);
    expect((await readCart()).items.map((item: { quantity: number }) => item.quantity)).toEqual([5, 8]);
  });
});

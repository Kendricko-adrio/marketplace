import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { jubelioMockServer, resetMockState } from "./server";

let baseUrl = "";

beforeAll(async () => {
  await new Promise<void>((resolve) => jubelioMockServer.listen(0, "127.0.0.1", resolve));
  const address = jubelioMockServer.address();
  if (!address || typeof address === "string") throw new Error("mock server did not start");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    jubelioMockServer.close((error) => (error ? reject(error) : resolve()));
  });
});

async function ensureStock(onHand: number): Promise<void> {
  await fetch(`${baseUrl}/__control/stocks/ensure`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ locationId: 61, itemId: 10384, onHand }),
  });
}

async function adjust(quantity: number): Promise<Response> {
  return fetch(`${baseUrl}/inventory/adjustments/`, {
    method: "POST",
    headers: { authorization: "mock-token", "content-type": "application/json" },
    body: JSON.stringify({
      item_adj_id: 0,
      item_adj_no: "[auto]",
      transaction_date: "2026-08-17T10:00:00.000Z",
      note: `test:${quantity}`,
      location_id: 61,
      is_opening_balance: false,
      items: [{ item_id: 10384, qty_in_base: quantity }],
    }),
  });
}

async function observedStock(): Promise<number> {
  const response = await fetch(`${baseUrl}/inventory/items/all-stocks/`, {
    method: "POST",
    headers: { authorization: "mock-token", "content-type": "application/json" },
    body: JSON.stringify({ ids: [10384] }),
  });
  const body = (await response.json()) as {
    data: Array<{ location_stocks: Array<{ on_hand: number }> }>;
  };
  return body.data[0].location_stocks[0].on_hand;
}

describe("local Midtrans status boundary", () => {
  it("returns a configured authoritative settlement for E2E webhooks", async () => {
    resetMockState();
    const configured = await fetch(`${baseUrl}/__control/midtrans-status`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        orderId: "order-late-1",
        transactionStatus: "settlement",
        grossAmount: "100000.00",
      }),
    });
    expect(configured.status).toBe(200);

    const status = await fetch(`${baseUrl}/v2/order-late-1/status`, {
      headers: { authorization: "Basic test" },
    });
    expect(status.status).toBe(200);
    await expect(status.json()).resolves.toMatchObject({
      order_id: "order-late-1",
      transaction_status: "settlement",
      gross_amount: "100000.00",
    });
  });

  it("echoes payment_type and transaction_id like the real GET status", async () => {
    resetMockState();
    const configured = await fetch(`${baseUrl}/__control/midtrans-status`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        orderId: "order-gopay-1",
        transactionStatus: "settlement",
        grossAmount: "100000.00",
        paymentType: "gopay",
        transactionId: "57d5293c-e65f-4a29-95e4-5959c3fa335b",
      }),
    });
    expect(configured.status).toBe(200);

    const status = await fetch(`${baseUrl}/v2/order-gopay-1/status`, {
      headers: { authorization: "Basic test" },
    });
    await expect(status.json()).resolves.toMatchObject({
      payment_type: "gopay",
      transaction_id: "57d5293c-e65f-4a29-95e4-5959c3fa335b",
    });
  });
});

describe("Jubelio-compatible stock adjustment API", () => {
  it("returns the Jubelio plus/minus adjustment account mapping", async () => {
    resetMockState();
    const response = await fetch(`${baseUrl}/systemsetting/account-mapping`, {
      headers: { authorization: "mock-token" },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      adjp_acct_id: 75,
      adjm_acct_id: 72,
      adjp_account_name: "7-7004 - Penyesuaian Persediaan Barang",
      adjm_account_name: "8-8004 - Penyesuaian Persediaan Barang",
    });
  });

  it("returns adjustment metadata for requested item IDs in one batch", async () => {
    resetMockState();
    await ensureStock(10);

    const response = await fetch(`${baseUrl}/inventory/items/to-adjust/`, {
      method: "POST",
      headers: { authorization: "mock-token", "content-type": "application/json" },
      body: JSON.stringify({ ids: [10384], location_id: 61 }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([
      {
        item_id: 10384,
        item_name: "Item 10384",
        item_full_name: "10384 - Item 10384",
        unit: "Buah",
        account_id: 4,
        account_code: "1-1200",
        account_name: "1-1200 - Persediaan Barang",
        cost: 100_000,
        end_qty: 10,
        resulting_qty: 10,
      },
    ]);
  });

  it("reduces and restores stateful on-hand stock", async () => {
    resetMockState();
    await ensureStock(10);

    await expect(adjust(-2).then((response) => response.json())).resolves.toEqual({
      status: "ok",
      id: 1,
    });
    expect(await observedStock()).toBe(8);

    await expect(adjust(2).then((response) => response.json())).resolves.toEqual({
      status: "ok",
      id: 2,
    });
    expect(await observedStock()).toBe(10);
  });

  it("returns P9005 when an adjustment would make stock negative", async () => {
    resetMockState();
    await ensureStock(1);
    const response = await adjust(-2);
    const body = (await response.json()) as { code: string };

    expect(response.status).toBe(500);
    expect(body.code).toBe("P9005");
  });
});

describe("Jubelio sales-order mock seam (SO/invoice/payment candidate)", () => {
  it("serves the generic customer contact by name query like the canary preflight", async () => {
    resetMockState();
    const response = await fetch(`${baseUrl}/contacts/customers/?q=Umum`, {
      headers: { authorization: "mock-token" },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: [
        {
          contact_id: -1,
          contact_name: "Pelanggan Umum",
          contact_type: 0,
          primary_contact: "Pelanggan Umum",
        },
      ],
    });
  });

  it("snapshots on_hand/on_order/reserved/available like the canary T0 read", async () => {
    resetMockState();
    await ensureStock(2);

    const response = await fetch(`${baseUrl}/inventory/?q=10384`, {
      headers: { authorization: "mock-token" },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      channels: [],
      locations: [{ location_id: "61", location_name: "Mock location 61" }],
      data: [
        {
          item_id: "10384",
          item_code: "MOCK-10384",
          item_name: "Item 10384",
          item_group_id: "1038",
          is_bundle: false,
          location_stocks: [
            {
              item_id: "10384",
              location_id: "61",
              on_hand: 2,
              on_order: 0,
              reserved: 0,
              available: 2,
            },
          ],
          total_stocks: { on_hand: 2, on_order: 0, reserved: 0, available: 2 },
        },
      ],
      totalCount: 1,
    });
  });

  it("sells item metadata with the canary unit/price/tax shape", async () => {
    resetMockState();
    await ensureStock(2);

    const response = await fetch(`${baseUrl}/inventory/items/to-sell/61?q=10384`, {
      headers: { authorization: "mock-token" },
    });

    expect(response.status).toBe(200);
    // Verified runtime canary: this endpoint returns {data, totalCount}, not a
    // top-level array as the OpenAPI schema claims.
    await expect(response.json()).resolves.toEqual({
      data: [
        {
          item_group_id: 1038,
          item_id: 10384,
          item_name: "Item 10384",
          item_code: "MOCK-10384",
          sell_price: 1_300_000,
          sell_unit: "Buah",
          sell_tax_id: 1,
          rate: 0,
          tax_name: "PPN 0%",
          account_code: "4-4000",
          account_name: "4-4000 - Penjualan",
        },
      ],
      totalCount: 1,
    });
  });
});

async function snapshot(): Promise<{
  on_hand: number;
  on_order: number;
  reserved: number;
  available: number;
}> {
  const response = await fetch(`${baseUrl}/inventory/?q=10384`, {
    headers: { authorization: "mock-token" },
  });
  const body = (await response.json()) as {
    data: Array<{ location_stocks: Array<{ on_hand: number; on_order: number; reserved: number; available: number }> }>;
  };
  const { on_hand, on_order, reserved, available } =
    body.data[0].location_stocks[0];
  return { on_hand, on_order, reserved, available };
}

function salesOrderBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    salesorder_id: 0,
    salesorder_no: "[auto]",
    contact_id: -1,
    customer_name: "Pelanggan Umum",
    transaction_date: "2026-09-23T16:48:13.000Z",
    sub_total: 1_300_000,
    total_disc: 0,
    total_tax: 0,
    grand_total: 1_300_000,
    location_id: 61,
    source: 1,
    add_fee: 0,
    add_disc: 0,
    service_fee: 0,
    note: "OKCIR_SANDBOX_SO_CANARY_20260923T164813Z",
    items: [
      {
        salesorder_detail_id: 0,
        item_id: 10384,
        tax_id: 1,
        price: 1_300_000,
        unit: "Buah",
        qty_in_base: 1,
        disc: 0,
        disc_amount: 0,
        tax_amount: 0,
        amount: 1_300_000,
        location_id: 61,
      },
    ],
    ...overrides,
  };
}

async function createSalesOrder(
  overrides: Record<string, unknown> = {},
  options: { signal?: AbortSignal } = {},
): Promise<Response> {
  return fetch(`${baseUrl}/sales/orders/`, {
    method: "POST",
    headers: { authorization: "mock-token", "content-type": "application/json" },
    body: JSON.stringify(salesOrderBody(overrides)),
    signal: options.signal,
  });
}

async function setScenario(name: string): Promise<void> {
  await fetch(`${baseUrl}/__control/scenario`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ scenario: name }),
  });
}

async function getOrder(id: number): Promise<Response> {
  return fetch(`${baseUrl}/sales/orders/${id}`, {
    headers: { authorization: "mock-token" },
  });
}

describe("Jubelio sales-order lifecycle (canary-modeled candidate)", () => {

  it("moves on_order/available on create and restores both on pre-invoice cancel like the canary", async () => {
    resetMockState();
    await ensureStock(2);

    // T0 (canary): 2/0/0/2
    expect(await snapshot()).toEqual({ on_hand: 2, on_order: 0, reserved: 0, available: 2 });

    // Canary create: HTTP 200 {id: 68378}
    const created = await createSalesOrder();
    expect(created.status).toBe(200);
    await expect(created.json()).resolves.toEqual({ id: 68378 });

    // T1 (canary): 2/1/0/1, SO GET confirms one item, generic contact, invoice null
    expect(await snapshot()).toEqual({ on_hand: 2, on_order: 1, reserved: 0, available: 1 });
    const order = await getOrder(68378);
    expect(order.status).toBe(200);
    await expect(order.json()).resolves.toMatchObject({
      salesorder_id: 68378,
      salesorder_no: "SO-000068378",
      contact_id: -1,
      customer_name: "Pelanggan Umum",
      location_id: 61,
      grand_total: 1_300_000,
      invoice_id: null,
      invoice_no: null,
      is_canceled: false,
    });

    // Canary cancel: HTTP 200 {status:"ok"}
    const canceled = await fetch(`${baseUrl}/sales/orders/cancel/`, {
      method: "POST",
      headers: { authorization: "mock-token", "content-type": "application/json" },
      body: JSON.stringify({ ids: [68378] }),
    });
    expect(canceled.status).toBe(200);
    await expect(canceled.json()).resolves.toEqual({ status: "ok" });

    // T2 (canary): is_canceled true, invoice ID null, stock restored 2/0/0/2
    await expect((await getOrder(68378)).json()).resolves.toMatchObject({
      salesorder_id: 68378,
      is_canceled: true,
      invoice_id: null,
    });
    expect(await snapshot()).toEqual({ on_hand: 2, on_order: 0, reserved: 0, available: 2 });
  });

  it("fails closed on invalid SO create references and amounts", async () => {
    resetMockState();
    await ensureStock(2);

    // Unknown contact id
    const unknownContact = await createSalesOrder({ contact_id: 12345, customer_name: "Ghost" });
    expect(unknownContact.status).toBe(404);
    await expect(unknownContact.json()).resolves.toMatchObject({ code: "E000001" });

    // Non-numeric grand_total (schema-invalid type)
    const inconsistent = await createSalesOrder({ grand_total: "999" });
    expect(inconsistent.status).toBe(400);
    await expect(inconsistent.json()).resolves.toMatchObject({ code: "E000003" });

    // Unknown item reference
    const unknownItem = await createSalesOrder({
      items: [
        { salesorder_detail_id: 0, item_id: 99999, tax_id: 1, price: 1_300_000, unit: "Buah", qty_in_base: 1, disc: 0, disc_amount: 0, tax_amount: 0, amount: 1_300_000, location_id: 61 },
      ],
    });
    expect(unknownItem.status).toBe(404);
    await expect(unknownItem.json()).resolves.toMatchObject({ code: "E000001" });

    // Quantity beyond available stock is rejected, not silently oversold
    const oversell = await createSalesOrder({
      items: [
        { salesorder_detail_id: 0, item_id: 10384, tax_id: 1, price: 1_300_000, unit: "Buah", qty_in_base: 3, disc: 0, disc_amount: 0, tax_amount: 0, amount: 3_900_000, location_id: 61 },
      ],
      sub_total: 3_900_000,
      grand_total: 3_900_000,
    });
    expect(oversell.status).toBe(500);
    await expect(oversell.json()).resolves.toMatchObject({ code: "23100" });
    // Nothing was written by any rejected request
    expect(await snapshot()).toEqual({ on_hand: 2, on_order: 0, reserved: 0, available: 2 });
  });

  it("rejects malformed, unknown and repeated cancel attempts", async () => {
    resetMockState();
    await ensureStock(2);
    const created = await createSalesOrder();
    expect(((await created.json()) as { id: number }).id).toBe(68378);

    // Malformed ids
    const malformed = await fetch(`${baseUrl}/sales/orders/cancel/`, {
      method: "POST",
      headers: { authorization: "mock-token", "content-type": "application/json" },
      body: JSON.stringify({ ids: [] }),
    });
    expect(malformed.status).toBe(400);
    await expect(malformed.json()).resolves.toMatchObject({ code: "E000003" });

    // Unknown SO reference
    const unknown = await fetch(`${baseUrl}/sales/orders/cancel/`, {
      method: "POST",
      headers: { authorization: "mock-token", "content-type": "application/json" },
      body: JSON.stringify({ ids: [12345] }),
    });
    expect(unknown.status).toBe(404);
    await expect(unknown.json()).resolves.toMatchObject({ code: "E000001" });

    // Successful first cancel, then a repeated cancel conflicts
    const first = await fetch(`${baseUrl}/sales/orders/cancel/`, {
      method: "POST",
      headers: { authorization: "mock-token", "content-type": "application/json" },
      body: JSON.stringify({ ids: [68378] }),
    });
    expect(first.status).toBe(200);
    const duplicate = await fetch(`${baseUrl}/sales/orders/cancel/`, {
      method: "POST",
      headers: { authorization: "mock-token", "content-type": "application/json" },
      body: JSON.stringify({ ids: [68378] }),
    });
    expect(duplicate.status).toBe(409);

    // Stock restored exactly once by the single accepted write
    expect(await snapshot()).toEqual({ on_hand: 2, on_order: 0, reserved: 0, available: 2 });
  });

  it("accepts schema-valid amounts without deriving remote totals", async () => {
    resetMockState();
    await ensureStock(2);

    // Schema-valid numbers whose relationships the mock does not derive:
    // grand_total/sub_total/item amount relationships under tax and fees are
    // unverified remote behavior, so they are stored exactly as sent.
    const response = await createSalesOrder({
      grand_total: 1_400_000,
      add_fee: 100_000,
      items: [
        {
          salesorder_detail_id: 0,
          item_id: 10384,
          tax_id: 1,
          price: 1_300_000,
          unit: "Buah",
          qty_in_base: 1,
          disc: 5,
          disc_amount: 10_000,
          tax_amount: 5_000,
          amount: 1_350_000,
          location_id: 61,
        },
      ],
    });

    expect(response.status).toBe(200);
    const created = (await response.json()) as { id: number };
    const order = (await (await getOrder(created.id)).json()) as {
      grand_total: number;
      items: Array<{ amount: number }>;
    };
    expect(order.grand_total).toBe(1_400_000);
    expect(order.items[0].amount).toBe(1_350_000);
    expect(await snapshot()).toEqual({ on_hand: 2, on_order: 1, reserved: 0, available: 1 });
  });

  it("aggregates duplicate item lines so combined demand cannot oversell", async () => {
    resetMockState();
    await ensureStock(2);

    // Two lines of the same item, 2 each, with only 2 available: the combined
    // demand of 4 exceeds stock and must be rejected as one unit.
    const duplicateLine = { salesorder_detail_id: 0, item_id: 10384, tax_id: 1, price: 1_300_000, unit: "Buah", qty_in_base: 2, disc: 0, disc_amount: 0, tax_amount: 0, amount: 2_600_000, location_id: 61 };
    const response = await createSalesOrder({
      sub_total: 5_200_000,
      grand_total: 5_200_000,
      items: [duplicateLine, { ...duplicateLine, salesorder_detail_id: 1 }],
    });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ code: "23100" });
    expect(await snapshot()).toEqual({ on_hand: 2, on_order: 0, reserved: 0, available: 2 });
  });

  it("rejects duplicate SO ids in one cancel request without restoring holds", async () => {
    resetMockState();
    await ensureStock(2);
    const created = await createSalesOrder();
    expect(((await created.json()) as { id: number }).id).toBe(68378);
    expect(await snapshot()).toEqual({ on_hand: 2, on_order: 1, reserved: 0, available: 1 });

    const response = await fetch(`${baseUrl}/sales/orders/cancel/`, {
      method: "POST",
      headers: { authorization: "mock-token", "content-type": "application/json" },
      body: JSON.stringify({ ids: [68378, 68378] }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "E000003" });
    // The rejected request must not have restored the hold at all.
    expect(await snapshot()).toEqual({ on_hand: 2, on_order: 1, reserved: 0, available: 1 });
    await expect((await getOrder(68378)).json()).resolves.toMatchObject({ is_canceled: false });

    // A well-formed single-id cancel afterwards still works.
    const retry = await fetch(`${baseUrl}/sales/orders/cancel/`, {
      method: "POST",
      headers: { authorization: "mock-token", "content-type": "application/json" },
      body: JSON.stringify({ ids: [68378] }),
    });
    expect(retry.status).toBe(200);
    expect(await snapshot()).toEqual({ on_hand: 2, on_order: 0, reserved: 0, available: 2 });
  });

  it("rejects cross-location item lines and invalid source values", async () => {
    resetMockState();
    await ensureStock(2); // location 61
    await fetch(`${baseUrl}/__control/stocks/ensure`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ locationId: 62, itemId: 10384, onHand: 5 }),
    });

    // Item line points at a different location than the SO header: fulfillment
    // happens at the header location, so the mismatch is rejected.
    const crossLocation = await createSalesOrder({
      items: [
        {
          salesorder_detail_id: 0,
          item_id: 10384,
          tax_id: 1,
          price: 1_300_000,
          unit: "Buah",
          qty_in_base: 1,
          disc: 0,
          disc_amount: 0,
          tax_amount: 0,
          amount: 1_300_000,
          location_id: 62,
        },
      ],
    });
    expect(crossLocation.status).toBe(400);
    await expect(crossLocation.json()).resolves.toMatchObject({ code: "E000003" });

    // Only source 1 (Internal) is accepted in this rollout; other values are unverified.
    const invalidSource = await createSalesOrder({ source: 2 });
    expect(invalidSource.status).toBe(400);
    await expect(invalidSource.json()).resolves.toMatchObject({ code: "E000003" });
    const missingSource = await createSalesOrder({ source: undefined });
    expect(missingSource.status).toBe(400);

    // Neither rejected request wrote anything.
    expect(await snapshot()).toEqual({ on_hand: 2, on_order: 0, reserved: 0, available: 2 });
  });

  it("leaves a create that timed out after applying visible only by known SO id", async () => {
    resetMockState();
    await ensureStock(2);
    await setScenario("timeout-after-apply");

    // The client gives up; the mock still applied the write.
    await expect(
      createSalesOrder({}, { signal: AbortSignal.timeout(150) }),
    ).rejects.toThrow();

    // No documented discovery path exists for the returned SO id: there is no
    // GET /sales/orders/ list in the Jubelio contract, so the ambiguous create
    // outcome remains manual_review for the gateway. The applied state is only
    // readable via the documented GET /sales/orders/{id} once the id is known
    // (the mock's deterministic counter stands in for operator investigation).
    expect(await (await getOrder(68378)).json()).toMatchObject({
      salesorder_id: 68378,
      is_canceled: false,
      invoice_id: null,
    });
    expect(await snapshot()).toEqual({ on_hand: 2, on_order: 1, reserved: 0, available: 1 });
  });

  it("offers no by-note reconciliation for a create whose success lacked the id", async () => {
    resetMockState();
    await ensureStock(2);
    await setScenario("malformed-success-after-apply");

    const ambiguous = await createSalesOrder();
    expect(ambiguous.status).toBe(200);
    // Success body without id: the client cannot learn the SO id from it.
    await expect(ambiguous.json()).resolves.toEqual({ status: "ok" });

    // An undocumented GET /sales/orders/ list must NOT exist to fake a
    // reconciliation: this ambiguous outcome stays manual_review.
    const byNote = await fetch(
      `${baseUrl}/sales/orders/?q=${encodeURIComponent("OKCIR_SANDBOX_SO_CANARY_20260923T164813Z")}`,
      { headers: { authorization: "mock-token" } },
    );
    expect(byNote.status).toBe(404);
    expect(await snapshot()).toEqual({ on_hand: 2, on_order: 1, reserved: 0, available: 1 });
  });

  it("reconciles a cancel that timed out after applying via SO GET", async () => {
    resetMockState();
    await ensureStock(2);
    await createSalesOrder();
    await setScenario("timeout-after-apply");

    await expect(
      fetch(`${baseUrl}/sales/orders/cancel/`, {
        method: "POST",
        headers: { authorization: "mock-token", "content-type": "application/json" },
        body: JSON.stringify({ ids: [68378] }),
        signal: AbortSignal.timeout(150),
      }),
    ).rejects.toThrow();

    await expect((await getOrder(68378)).json()).resolves.toMatchObject({
      salesorder_id: 68378,
      is_canceled: true,
    });
    expect(await snapshot()).toEqual({ on_hand: 2, on_order: 0, reserved: 0, available: 2 });
  });

  it("reconciles a cancel whose success response was ambiguous", async () => {
    resetMockState();
    await ensureStock(2);
    await createSalesOrder();
    await setScenario("malformed-success-after-apply");

    const ambiguous = await fetch(`${baseUrl}/sales/orders/cancel/`, {
      method: "POST",
      headers: { authorization: "mock-token", "content-type": "application/json" },
      body: JSON.stringify({ ids: [68378] }),
    });
    expect(ambiguous.status).toBe(200);
    await expect(ambiguous.json()).resolves.toEqual({});

    await expect((await getOrder(68378)).json()).resolves.toMatchObject({
      salesorder_id: 68378,
      is_canceled: true,
    });
    expect(await snapshot()).toEqual({ on_hand: 2, on_order: 0, reserved: 0, available: 2 });
  });
});

async function createInvoice(
  body: Record<string, unknown>,
  options: { signal?: AbortSignal } = {},
): Promise<Response> {
  return fetch(`${baseUrl}/sales/packlists/create-invoice`, {
    method: "POST",
    headers: { authorization: "mock-token", "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: options.signal,
  });
}

async function getInvoice(id: number): Promise<Response> {
  return fetch(`${baseUrl}/sales/invoices/${id}`, {
    headers: { authorization: "mock-token" },
  });
}

describe("Jubelio invoice seam (create-invoice candidate, hypothetical stock)", () => {
  // HYPOTHETICAL, unverified against live Jubelio: every test below that
  // reconciles through SO GET invoice_id/invoice_no AFTER create-invoice, or
  // asserts the duplicate-invoice / cancel-after-invoice 409s, exercises the
  // mock's INVENTED rollout contract. The canary only ever observed
  // invoice_id: null pre-invoice. Green here is not proof of remote behavior:
  // a gateway must treat missing SO linkage and these 409s as manual_review
  // signals until sandbox evidence exists (plan step 2).
  it("converts one SO into one invoice and links it on the SO GET", async () => {
    resetMockState();
    await ensureStock(2);
    const created = await createSalesOrder();
    expect(((await created.json()) as { id: number }).id).toBe(68378);

    // Documented createInvoiceResponse: {status, id} where id is the invoice number ID.
    const invoiced = await createInvoice({ salesorder_id: 68378 });
    expect(invoiced.status).toBe(200);
    await expect(invoiced.json()).resolves.toEqual({ status: "ok", id: 222 });

    // SO GET now carries the invoice link (canary SO GET carried invoice ID null
    // pre-invoice). HYPOTHETICAL: post-invoice SO GET linkage is unverified live
    // behavior; absence must route the gateway to manual_review, not failure.
    await expect((await getOrder(68378)).json()).resolves.toMatchObject({
      salesorder_id: 68378,
      invoice_id: 222,
      invoice_no: "INV-000000222",
      is_canceled: false,
    });

    const invoice = await (await getInvoice(222)).json();
    expect(invoice).toMatchObject({
      invoice_id: 222,
      invoice_no: "INV-000000222",
      salesorder_id: 68378,
      contact_id: -1,
      location_id: 61,
      grand_total: "1300000",
      payment_amount: 0,
    });
    const invoiceItems = (invoice as { items: Array<Record<string, unknown>> }).items;
    expect(invoiceItems).toHaveLength(1);
    expect(invoiceItems[0]).toMatchObject({
      invoice_detail_id: 0,
      item_id: 10384,
      qty_in_base: 1,
      price: 1_300_000,
      amount: 1_300_000,
      location_id: 61,
    });

    // HYPOTHETICAL placeholder: the mock leaves the stock series untouched on
    // invoicing — there is no live evidence of the invoice stock effect, so
    // this must not be read as a verified remote transition.
    expect(await snapshot()).toEqual({ on_hand: 2, on_order: 1, reserved: 0, available: 1 });
  });

  it("rejects invalid, canceled and repeated invoice requests without writing", async () => {
    resetMockState();
    await ensureStock(2);
    const created = await createSalesOrder();
    expect(((await created.json()) as { id: number }).id).toBe(68378);

    // Malformed body
    const malformed = await createInvoice({});
    expect(malformed.status).toBe(400);
    await expect(malformed.json()).resolves.toMatchObject({ code: "E000003" });

    // Unknown SO reference
    const unknown = await createInvoice({ salesorder_id: 12345 });
    expect(unknown.status).toBe(404);
    await expect(unknown.json()).resolves.toMatchObject({ code: "E000001" });

    // Cancel the SO first, then invoicing must be refused.
    const canceled = await fetch(`${baseUrl}/sales/orders/cancel/`, {
      method: "POST",
      headers: { authorization: "mock-token", "content-type": "application/json" },
      body: JSON.stringify({ ids: [68378] }),
    });
    expect(canceled.status).toBe(200);
    const onCanceled = await createInvoice({ salesorder_id: 68378 });
    expect(onCanceled.status).toBe(409);
    await expect(onCanceled.json()).resolves.toMatchObject({ statusCode: "409" });

    // Back to a fresh open SO: first invoice succeeds, second is rejected.
    resetMockState();
    await ensureStock(2);
    await createSalesOrder();
    const first = await createInvoice({ salesorder_id: 68378 });
    expect(((await first.json()) as { id: number }).id).toBe(222);
    const duplicate = await createInvoice({ salesorder_id: 68378 });
    expect(duplicate.status).toBe(409);
    await expect(duplicate.json()).resolves.toMatchObject({ statusCode: "409" });
    // Exactly one invoice exists; the SO still points at the first one.
    await expect((await getOrder(68378)).json()).resolves.toMatchObject({
      invoice_id: 222,
      invoice_no: "INV-000000222",
    });
    expect(await snapshot()).toEqual({ on_hand: 2, on_order: 1, reserved: 0, available: 1 });
  });

  it("refuses to cancel a sales order after an invoice exists", async () => {
    resetMockState();
    await ensureStock(2);
    await createSalesOrder();
    await createInvoice({ salesorder_id: 68378 });

    const late = await fetch(`${baseUrl}/sales/orders/cancel/`, {
      method: "POST",
      headers: { authorization: "mock-token", "content-type": "application/json" },
      body: JSON.stringify({ ids: [68378] }),
    });
    expect(late.status).toBe(409);

    // No stock was released and the invoice link survives.
    expect(await snapshot()).toEqual({ on_hand: 2, on_order: 1, reserved: 0, available: 1 });
    await expect((await getOrder(68378)).json()).resolves.toMatchObject({
      is_canceled: false,
      invoice_id: 222,
    });
  });

  it("reconciles an invoice write that timed out after applying via SO GET", async () => {
    resetMockState();
    await ensureStock(2);
    await createSalesOrder();
    await setScenario("timeout-after-apply");

    // The client gives up; the invoice was still created and linked.
    await expect(
      createInvoice({ salesorder_id: 68378 }, { signal: AbortSignal.timeout(150) }),
    ).rejects.toThrow();

    // Reconciliation by the persisted SO id — never a retry of the POST.
    // HYPOTHETICAL: read via post-invoice SO GET linkage, which is unverified
    // live behavior (see describe-level marker).
    await expect((await getOrder(68378)).json()).resolves.toMatchObject({
      salesorder_id: 68378,
      invoice_id: 222,
      invoice_no: "INV-000000222",
    });
    await expect((await getInvoice(222)).json()).resolves.toMatchObject({
      invoice_id: 222,
      salesorder_id: 68378,
    });
  });

  it("reconciles an invoice write whose success response lacked the id", async () => {
    resetMockState();
    await ensureStock(2);
    await createSalesOrder();
    await setScenario("malformed-success-after-apply");

    const ambiguous = await createInvoice({ salesorder_id: 68378 });
    expect(ambiguous.status).toBe(200);
    await expect(ambiguous.json()).resolves.toEqual({ status: "ok" });

    const order = (await (await getOrder(68378)).json()) as { invoice_id: number | null };
    expect(order.invoice_id).toBe(222);
    await expect((await getInvoice(222)).json()).resolves.toMatchObject({
      invoice_id: 222,
      salesorder_id: 68378,
    });
  });
});

describe("Jubelio payment seam (single-payment candidate)", () => {
  // HYPOTHETICAL, unverified against live Jubelio: tests below reconcile
  // through invoice GET payment_amount and SO GET linkage, and assert the
  // duplicate-payment 409 — all invented/unverified rollout behavior. The mock
  // is a candidate model; green here must not be read as live-API proof.
  async function createPayment(
    body: Record<string, unknown>,
    options: { signal?: AbortSignal } = {},
  ): Promise<Response> {
    return fetch(`${baseUrl}/sales/payments/`, {
      method: "POST",
      headers: { authorization: "mock-token", "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: options.signal,
    });
  }

  async function getPayment(id: number): Promise<Response> {
    return fetch(`${baseUrl}/sales/payments/${id}`, {
      headers: { authorization: "mock-token" },
    });
  }

  function paymentBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      payment_id: 0,
      payment_no: "[auto]",
      payment_type: 0,
      contact_id: -1,
      account_id: 1,
      amount: 1_300_000,
      note: "Bayar Faktur INV-000000222",
      transaction_date: "2026-09-23T17:00:00.000Z",
      items: [{ payment_detail_id: 0, invoice_id: 222, payment_amount: 1_300_000 }],
      ...overrides,
    };
  }

  it("records one invoice payment, links it on GET and reflects it on the invoice", async () => {
    resetMockState();
    await ensureStock(2);
    await createSalesOrder();
    await createInvoice({ salesorder_id: 68378 });

    // Documented saveOK response: {status, id}.
    const paid = await createPayment(paymentBody());
    expect(paid.status).toBe(200);
    await expect(paid.json()).resolves.toEqual({ status: "ok", id: 17 });

    // Documented getSalesPaymentResponse subset.
    const payment = (await (await getPayment(17)).json()) as {
      payment_id: number;
      payment_no: string;
      amount: string;
      invoices: Array<{ payment_detail_id: number; payment_id: number; invoice_id: number; payment_amount: number }>;
    };
    expect(payment.payment_id).toBe(17);
    expect(payment.payment_no).toBe("PAY-000000017");
    expect(payment.amount).toBe("1300000");
    expect(payment.invoices).toEqual([
      {
        payment_detail_id: 0,
        payment_id: 17,
        trx_date: "2026-09-23T17:00:00.000Z",
        invoice_id: 222,
        payment_amount: 1_300_000,
      },
    ]);

    // The invoice GET now reflects the settled amount.
    await expect((await getInvoice(222)).json()).resolves.toMatchObject({
      invoice_id: 222,
      payment_amount: 1_300_000,
    });
  });

  it("rejects malformed, misassociated, overpaying and duplicate payments without writing", async () => {
    resetMockState();
    await ensureStock(2);
    await createSalesOrder();
    await createInvoice({ salesorder_id: 68378 });

    // Malformed: creation-only header fields
    const editAttempt = await createPayment(paymentBody({ payment_id: 9 }));
    expect(editAttempt.status).toBe(400);
    await expect(editAttempt.json()).resolves.toMatchObject({ code: "E000003" });

    // Malformed: non-finite/negative amount
    const negative = await createPayment(paymentBody({ amount: -5 }));
    expect(negative.status).toBe(400);
    await expect(negative.json()).resolves.toMatchObject({ code: "E000003" });

    // Unknown invoice reference
    const unknownInvoice = await createPayment(
      paymentBody({ items: [{ payment_detail_id: 0, invoice_id: 999, payment_amount: 1_300_000 }] }),
    );
    expect(unknownInvoice.status).toBe(404);
    await expect(unknownInvoice.json()).resolves.toMatchObject({ code: "E000001" });

    // Unknown contact reference (fail closed on invalid IDs)
    const unknownContact = await createPayment(paymentBody({ contact_id: 12345 }));
    expect(unknownContact.status).toBe(404);
    await expect(unknownContact.json()).resolves.toMatchObject({ code: "E000001" });

    // Contact mismatch: payment must target the invoiced contact (-1), not
    // another known contact.
    const seeded = await fetch(`${baseUrl}/__control/contacts/ensure`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contact_id: 5, contact_name: "Toko Lain" }),
    });
    expect(seeded.status).toBe(200);
    const wrongContact = await createPayment(paymentBody({ contact_id: 5 }));
    expect(wrongContact.status).toBe(400);
    await expect(wrongContact.json()).resolves.toMatchObject({ code: "E000003" });

    // Overpay: documented 23108 — payment exceeds invoice value
    const overpay = await createPayment(
      paymentBody({
        amount: 1_400_000,
        items: [{ payment_detail_id: 0, invoice_id: 222, payment_amount: 1_400_000 }],
      }),
    );
    expect(overpay.status).toBe(500);
    await expect(overpay.json()).resolves.toMatchObject({ code: "23108" });

    // Duplicate: a second payment write for the same invoice conflicts.
    const first = await createPayment(paymentBody());
    expect(((await first.json()) as { id: number }).id).toBe(17);
    const duplicate = await createPayment(paymentBody());
    expect(duplicate.status).toBe(409);
    await expect(duplicate.json()).resolves.toMatchObject({ statusCode: "409" });

    // Exactly one payment recorded; invoice amount unchanged by rejections.
    await expect((await getInvoice(222)).json()).resolves.toMatchObject({
      payment_amount: 1_300_000,
    });
  });

  it("rejects repeated invoice_id lines in one payment request before any write", async () => {
    resetMockState();
    await ensureStock(2);
    await createSalesOrder();
    await createInvoice({ salesorder_id: 68378 });

    // Two detail lines targeting the SAME invoice (800,000 each against a
    // 1,300,000 grand_total): each line alone would pass the per-line overpay
    // guard, so together they must be rejected as one unit BEFORE any write —
    // otherwise the single request mints payment_amount 1,600,000 > grand_total.
    const repeated = await createPayment(
      paymentBody({
        amount: 1_600_000,
        items: [
          { payment_detail_id: 0, invoice_id: 222, payment_amount: 800_000 },
          { payment_detail_id: 0, invoice_id: 222, payment_amount: 800_000 },
        ],
      }),
    );
    expect(repeated.status).toBe(400);
    await expect(repeated.json()).resolves.toMatchObject({ code: "E000003" });

    // Nothing was written: the invoice is untouched and no payment exists.
    await expect((await getInvoice(222)).json()).resolves.toMatchObject({
      invoice_id: 222,
      payment_amount: 0,
    });
    expect((await getPayment(17)).status).toBe(404);
  });

  it("rejects a payment whose header amount differs from the sum of detail amounts", async () => {
    resetMockState();
    await ensureStock(2);
    await createSalesOrder();
    await createInvoice({ salesorder_id: 68378 });

    // CONSERVATIVE MOCK INVARIANT, remote rule unverified: the live Jubelio
    // saveSalesPayment behavior for a header/detail amount mismatch has never
    // been observed. The mock refuses to store a settlement record whose
    // header and details disagree, so the seam cannot produce paid-looking
    // proof that is internally inconsistent.
    const mismatched = await createPayment(
      paymentBody({
        amount: 0,
        items: [{ payment_detail_id: 0, invoice_id: 222, payment_amount: 1_300_000 }],
      }),
    );
    expect(mismatched.status).toBe(400);
    await expect(mismatched.json()).resolves.toMatchObject({ code: "E000003" });

    // The rejected request wrote nothing.
    await expect((await getInvoice(222)).json()).resolves.toMatchObject({
      invoice_id: 222,
      payment_amount: 0,
    });
    expect((await getPayment(17)).status).toBe(404);
  });

  it("reconciles a payment that timed out after applying via documented GETs", async () => {
    resetMockState();
    await ensureStock(2);
    await createSalesOrder();
    await createInvoice({ salesorder_id: 68378 });
    await setScenario("timeout-after-apply");

    // The client gives up; the payment was still recorded.
    await expect(
      createPayment(paymentBody(), { signal: AbortSignal.timeout(150) }),
    ).rejects.toThrow();

    // No retry: reconcile through the invoice GET (payment_amount) and the
    // payment GET by the known deterministic id (operator-investigation stand-in).
    await expect((await getInvoice(222)).json()).resolves.toMatchObject({
      invoice_id: 222,
      payment_amount: 1_300_000,
    });
    await expect((await getPayment(17)).json()).resolves.toMatchObject({
      payment_id: 17,
      amount: "1300000",
    });
  });

  it("reconciles a payment whose success response lacked the id via invoice GET", async () => {
    resetMockState();
    await ensureStock(2);
    await createSalesOrder();
    await createInvoice({ salesorder_id: 68378 });
    await setScenario("malformed-success-after-apply");

    const ambiguous = await createPayment(paymentBody());
    expect(ambiguous.status).toBe(200);
    await expect(ambiguous.json()).resolves.toEqual({ status: "ok" });

    // The invoice's payment_amount proves the write landed; a second POST for
    // the same invoice is refused (manual_review, not an automatic retry).
    // HYPOTHETICAL: whether live invoice GET payment_amount reflects a payment,
    // and whether a live repeat POST 409s, are both unverified.
    await expect((await getInvoice(222)).json()).resolves.toMatchObject({
      invoice_id: 222,
      payment_amount: 1_300_000,
    });
    const retry = await createPayment(paymentBody());
    expect(retry.status).toBe(409);
  });
});

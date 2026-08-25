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

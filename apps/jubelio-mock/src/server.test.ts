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

describe("Jubelio-compatible stock adjustment API", () => {
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

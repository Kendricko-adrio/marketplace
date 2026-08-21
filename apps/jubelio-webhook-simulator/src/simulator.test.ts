import { describe, expect, it, vi } from "vitest";
import {
  createWebhookSignature,
  simulateJubelioWebhook,
  type SimulatorConfig,
} from "./simulator.js";

const config: SimulatorConfig = {
  apiBaseUrl: "https://api2.jubelio.com",
  email: "demo@example.com",
  password: "secret",
  webhookUrl: "http://localhost:3000/api/webhooks/jubelio",
  webhookSecret: "webhook-secret",
  action: "update-qty",
  dryRun: false,
  pageSize: 1,
  randomInt: () => 0,
};

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("simulateJubelioWebhook", () => {
  it("fetches a random real record and posts a correctly signed webhook", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response({ token: "live-token" }))
      .mockResolvedValueOnce(response({ data: [], totalCount: 1 }))
      .mockResolvedValueOnce(response({
        data: [{
          item_group_id: 42,
          item_name: "Demo product",
          item_category_id: 7,
          sell_price: 1000,
          thumbnail: "https://cdn.example/image.jpg",
          variants: [{ item_id: 9001, item_code: "SKU-9001", variation_values: [], sell_price: 1000, barcode: null, available_qty: 3, end_qty: 3 }],
        }],
        totalCount: 1,
      }))
      .mockResolvedValueOnce(response({
        locations: [{ location_id: 11, location_name: "Outlet", location_code: "OUTLET" }],
        data: [{ item_id: 9001, item_code: "SKU-9001", item_group_id: 42, location_stocks: [{ location_id: 11, on_hand: 3, available: 3 }] }],
      }))
      .mockResolvedValueOnce(response({ success: true }));

    const result = await simulateJubelioWebhook(config, fetchImpl);

    expect(result.payload).toEqual({
      action: "update-qty",
      item_group_id: 42,
      item_group_name: "Demo product",
      item_ids: [9001],
      location_id: 11,
    });
    const webhookRequest = fetchImpl.mock.calls[4];
    const rawBody = String(webhookRequest[1]?.body);
    expect(webhookRequest[0]).toBe(config.webhookUrl);
    expect(webhookRequest[1]?.headers).toMatchObject({
      "content-type": "application/json",
      "webhook-signature": createWebhookSignature(rawBody, config.webhookSecret),
    });
    expect(result.webhookStatus).toBe(200);
  });

  it("does not hit the webhook in dry-run mode", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response({ token: "live-token" }))
      .mockResolvedValueOnce(response({
        data: [{
          item_group_id: 42,
          item_name: "Demo product",
          item_category_id: 7,
          sell_price: 1000,
          thumbnail: "",
          variants: [{ item_id: 9001, item_code: "SKU-9001", variation_values: [], sell_price: 1000, barcode: null, available_qty: 3, end_qty: 3 }],
        }],
        totalCount: 1,
      }));

    const result = await simulateJubelioWebhook({ ...config, action: "update-product", dryRun: true }, fetchImpl);

    expect(result.webhookStatus).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

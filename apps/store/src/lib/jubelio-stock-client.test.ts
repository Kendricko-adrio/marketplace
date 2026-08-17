import { describe, expect, it } from "vitest";
import {
  buildStockAdjustmentPayload,
  createJubelioStockGateway,
  resolveJubelioStockRuntime,
} from "./jubelio-stock-client";
import type { Logger } from "./logger";

describe("resolveJubelioStockRuntime", () => {
  it("forces the mock API outside production even when the live URL is configured", () => {
    expect(
      resolveJubelioStockRuntime({
        NODE_ENV: "development",
        JUBELIO_API_BASE_URL: "https://api2.jubelio.com",
        JUBELIO_MOCK_API_BASE_URL: "http://127.0.0.1:3002",
        JUBELIO_STOCK_WRITES_ENABLED: "true",
      })
    ).toEqual({ mode: "mock", baseUrl: "http://127.0.0.1:3002" });
  });

  it("forces the mock API in staging even though Next.js runs with NODE_ENV=production", () => {
    expect(
      resolveJubelioStockRuntime({
        APP_ENV: "staging",
        NODE_ENV: "production",
        JUBELIO_API_BASE_URL: "https://api2.jubelio.com",
        JUBELIO_MOCK_API_BASE_URL: "http://jubelio-mock:3002",
        JUBELIO_STOCK_WRITES_ENABLED: "true",
      })
    ).toEqual({ mode: "mock", baseUrl: "http://jubelio-mock:3002" });
  });

  it("rejects production writes unless the explicit write switch is enabled", () => {
    expect(() =>
      resolveJubelioStockRuntime({
        APP_ENV: "production",
        NODE_ENV: "production",
        JUBELIO_API_BASE_URL: "https://api2.jubelio.com",
      })
    ).toThrow("JUBELIO_STOCK_WRITES_ENABLED=true");
  });

  it("accepts the official Jubelio host for explicitly enabled production writes", () => {
    expect(
      resolveJubelioStockRuntime({
        APP_ENV: "production",
        NODE_ENV: "production",
        JUBELIO_API_BASE_URL: "https://api2.jubelio.com/",
        JUBELIO_STOCK_WRITES_ENABLED: "true",
      })
    ).toEqual({ mode: "live", baseUrl: "https://api2.jubelio.com" });
  });
});

describe("buildStockAdjustmentPayload", () => {
  it("builds a Jubelio reserve adjustment with a negative quantity and amount", () => {
    expect(
      buildStockAdjustmentPayload({
        kind: "reserve",
        orderId: "order-abc-123",
        operationId: "operation-1",
        locationId: 61,
        transactionDate: new Date("2026-08-17T10:00:00.000Z"),
        items: [
          {
            itemId: 10384,
            quantity: 2,
            description: "Example shoe",
            unit: "Buah",
            cost: 100_000,
            accountId: 75,
            binId: 147,
          },
        ],
      })
    ).toEqual({
      item_adj_id: 0,
      item_adj_no: "[auto]",
      transaction_date: "2026-08-17T10:00:00.000Z",
      note: "OKCIR_RESERVE:order-abc-123:operation-1",
      location_id: 61,
      is_opening_balance: false,
      items: [
        {
          item_adj_detail_id: 0,
          original_item_adj_detail_id: 0,
          item_id: 10384,
          description: "Example shoe",
          serial_no: null,
          batch_no: null,
          qty_in_base: -2,
          unit: "Buah",
          cost: 100_000,
          amount: -200_000,
          location_id: 61,
          account_id: 75,
          expired_date: null,
          bin_id: 147,
        },
      ],
    });
  });

  it("builds a compensating release adjustment with positive values", () => {
    const payload = buildStockAdjustmentPayload({
      kind: "release",
      orderId: "order-abc-123",
      operationId: "operation-2",
      locationId: 61,
      transactionDate: new Date("2026-08-17T10:15:00.000Z"),
      items: [
        {
          itemId: 10384,
          quantity: 2,
          description: "Example shoe",
          unit: "Buah",
          cost: 100_000,
          accountId: 75,
          binId: 147,
        },
      ],
    });

    expect(payload.note).toBe("OKCIR_RELEASE:order-abc-123:operation-2");
    expect(payload.items[0].qty_in_base).toBe(2);
    expect(payload.items[0].amount).toBe(200_000);
  });
});

describe("Jubelio HTTP logging", () => {
  it("logs request input and response output while redacting credentials", async () => {
    const events: Array<{ level: string; message: string; context?: Record<string, unknown> }> = [];
    const makeLog = (bound: Record<string, unknown> = {}): Logger => ({
      requestId: "request-jubelio-1",
      debug: (message, context) => events.push({ level: "debug", message, context: { ...bound, ...context } }),
      info: (message, context) => events.push({ level: "info", message, context: { ...bound, ...context } }),
      warn: (message, context) => events.push({ level: "warn", message, context: { ...bound, ...context } }),
      error: (message, context) => events.push({ level: "error", message, context: { ...bound, ...context } }),
      child: (context) => makeLog({ ...bound, ...context }),
    });
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.endsWith("/login")) {
        return new Response(JSON.stringify({ token: "secret-token" }), { status: 200 });
      }
      return new Response(
        JSON.stringify({
          data: [{ item_id: 10384, location_stocks: [{ location_id: 61, on_hand: 8 }] }],
        }),
        { status: 200 }
      );
    };
    const gateway = createJubelioStockGateway({
      env: {
        NODE_ENV: "development",
        JUBELIO_MOCK_API_BASE_URL: "http://jubelio.test",
        JUBELIO_EMAIL: "user@example.com",
        JUBELIO_PASSWORD: "super-secret",
      },
      fetchImpl,
      logger: makeLog(),
    });

    await expect(gateway.getStocks(61, [10384])).resolves.toEqual([
      { itemId: 10384, onHand: 8 },
    ]);

    expect(events.some((event) => event.message === "Jubelio HTTP request started")).toBe(true);
    expect(events.some((event) => event.message === "Jubelio HTTP response received" && event.context?.status === 200)).toBe(true);
    expect(JSON.stringify(events)).not.toContain("super-secret");
    expect(JSON.stringify(events)).not.toContain("secret-token");
  });
});

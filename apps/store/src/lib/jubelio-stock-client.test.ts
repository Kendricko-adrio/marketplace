import { describe, expect, it } from "vitest";
import {
  buildStockAdjustmentPayload,
  createJubelioStockGateway,
  resolveJubelioStockRuntime,
} from "./jubelio-stock-client";
import type { Logger } from "./logger";
import { JubelioRequestQueueError } from "./jubelio-request-scheduler";

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

  it("builds a prioritized late-settlement re-acquisition with a unique note", () => {
    const payload = buildStockAdjustmentPayload({
      kind: "reacquire",
      orderId: "order-abc-123",
      operationId: "operation-3",
      locationId: 61,
      transactionDate: new Date("2026-08-17T10:16:00.000Z"),
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

    expect(payload.note).toBe("OKCIR_REACQUIRE:order-abc-123:operation-3");
    expect(payload.items[0].qty_in_base).toBe(-2);
    expect(payload.items[0].amount).toBe(-200_000);
  });
});

describe("Jubelio adjustment metadata lookup", () => {
  it("loads all requested item metadata in one non-mutating batch without pagination", async () => {
    const requests: Array<{ path: string; method: string; body?: unknown }> = [];
    const scheduledPriorities: number[] = [];
    let rejectReleaseAdjustment = false;
    let releasePriorityCalls = 0;
    let adjustmentPayload: Record<string, unknown> | undefined;
    let reserveSnapshot:
      | {
          description: string;
          unit: string;
          cost: number;
          binId: number;
          reserveAccountId: number;
          releaseAccountId: number;
        }
      | undefined;
    const fetchImpl: typeof fetch = async (input, init = {}) => {
      const url = new URL(String(input));
      const method = init.method ?? "GET";
      const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
      requests.push({ path: url.pathname, method, body });

      if (url.pathname === "/__control/stocks/ensure") {
        return Response.json({ status: "ok" });
      }
      if (url.pathname === "/login") {
        return Response.json({ token: "mock-token" });
      }
      if (url.pathname === "/wms/default-bin/61") {
        return Response.json({ bin_id: 147 });
      }
      if (url.pathname === "/systemsetting/account-mapping") {
        return Response.json({
          adjp_acct_id: 901,
          adjp_account_name: "Reserve adjustment",
          adjm_acct_id: 902,
          adjm_account_name: "Release adjustment",
        });
      }
      if (url.pathname === "/inventory/items/to-adjust/") {
        return Response.json([
          {
            item_id: 10384,
            item_name: "Example shoe",
            item_full_name: "SKU-10384 - Example shoe",
            unit: "Buah",
            cost: 125_000,
            end_qty: 8,
            resulting_qty: 8,
          },
        ]);
      }
      if (url.pathname === "/inventory/adjustments/") {
        adjustmentPayload = body as Record<string, unknown>;
        return Response.json({ status: "ok", id: 987 });
      }
      if (url.pathname === "/inventory/items/all-stocks/") {
        return Response.json({
          data: [
            {
              item_id: 10384,
              location_stocks: [{ location_id: 61, on_hand: 7 }],
            },
          ],
        });
      }
      throw new Error(`Unexpected request: ${method} ${url.pathname}${url.search}`);
    };
    const gateway = createJubelioStockGateway({
      env: {
        NODE_ENV: "development",
        JUBELIO_MOCK_API_BASE_URL: "http://jubelio.test",
      },
      fetchImpl,
      scheduler: {
        schedule: (task, options) => {
          const priority = options?.priority ?? 0;
          scheduledPriorities.push(priority);
          if (priority === 10) {
            releasePriorityCalls++;
            if (rejectReleaseAdjustment && releasePriorityCalls === 2) {
              return Promise.reject(
                new JubelioRequestQueueError("QUEUE_TIMEOUT")
              );
            }
          }
          return task();
        },
        activeCount: 0,
        queuedCount: 0,
      },
    });

    await expect(
      gateway.applyAdjustment({
        kind: "reserve",
        orderId: "order-1",
        operationId: "operation-1",
        locationId: 61,
        items: [
          {
            itemId: 10384,
            quantity: 1,
            description: "Fallback description",
            observedStock: 8,
          },
        ],
        onPrepared: async (items) => {
          reserveSnapshot = items[0].snapshot;
        },
      })
    ).resolves.toEqual({
      adjustmentId: 987,
      stocks: [{ itemId: 10384, onHand: 7 }],
    });

    const metadataRequests = requests.filter(
      (request) => request.path === "/inventory/items/to-adjust/"
    );
    expect(metadataRequests).toEqual([
      {
        path: "/inventory/items/to-adjust/",
        method: "POST",
        body: { ids: [10384], location_id: 61 },
      },
    ]);
    expect(
      requests.some((request) => request.path.startsWith("/inventory/items/to-stock/"))
    ).toBe(false);
    expect(requests.filter((request) => request.path === "/login")).toHaveLength(1);
    expect(adjustmentPayload).toMatchObject({
      items: [
        {
          item_id: 10384,
          description: "SKU-10384 - Example shoe",
          unit: "Buah",
          cost: 125_000,
          account_id: 901,
        },
      ],
    });
    expect(reserveSnapshot).toEqual({
      description: "SKU-10384 - Example shoe",
      unit: "Buah",
      cost: 125_000,
      binId: 147,
      reserveAccountId: 901,
      releaseAccountId: 902,
    });

    await gateway.applyAdjustment({
      kind: "release",
      orderId: "order-1",
      operationId: "operation-2",
      locationId: 61,
      items: [
        {
          itemId: 10384,
          quantity: 1,
          description: "Fallback description",
          observedStock: 7,
          snapshot: reserveSnapshot!,
        },
      ],
    });

    expect(
      requests.filter((request) => request.path === "/systemsetting/account-mapping")
    ).toHaveLength(1);
    expect(
      requests.filter((request) => request.path === "/wms/default-bin/61")
    ).toHaveLength(1);
    expect(
      requests.filter((request) => request.path === "/inventory/items/to-adjust/")
    ).toHaveLength(1);
    expect(adjustmentPayload).toMatchObject({
      items: [{ item_id: 10384, qty_in_base: 1, account_id: 902 }],
    });
    expect(scheduledPriorities).toContain(10);

    await gateway.applyAdjustment({
      kind: "reacquire",
      orderId: "order-1",
      operationId: "operation-late",
      locationId: 61,
      items: [
        {
          itemId: 10384,
          quantity: 1,
          description: "Fallback description",
          observedStock: 7,
          snapshot: reserveSnapshot!,
        },
      ],
    });
    expect(adjustmentPayload).toMatchObject({
      note: "OKCIR_REACQUIRE:order-1:operation-late",
      items: [{ item_id: 10384, qty_in_base: -1, account_id: 901 }],
    });
    expect(scheduledPriorities).toContain(20);
    expect(
      requests.filter((request) => request.path === "/inventory/items/to-adjust/")
    ).toHaveLength(1);

    rejectReleaseAdjustment = true;
    releasePriorityCalls = 0;
    await expect(
      gateway.applyAdjustment({
        kind: "release",
        orderId: "order-1",
        operationId: "operation-3",
        locationId: 61,
        items: [
          {
            itemId: 10384,
            quantity: 1,
            description: "Fallback description",
            observedStock: 7,
          },
        ],
      })
    ).rejects.toMatchObject({
      options: {
        ambiguous: false,
        retryable: true,
        code: "QUEUE_TIMEOUT",
      },
    });
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

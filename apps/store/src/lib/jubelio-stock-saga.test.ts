import { describe, expect, it } from "vitest";
import { JubelioStockGatewayError, type JubelioStockGateway } from "./jubelio-stock-client";
import {
  createReserveOperationValues,
  decideLateSettlementStockAction,
  mergePreparedAdjustmentSnapshots,
  runStockAdjustment,
} from "./jubelio-stock-saga";
import type { Logger } from "./logger";

const operation = {
  kind: "reserve" as const,
  orderId: "order-1",
  operationId: "operation-1",
  locationId: 61,
  items: [
    {
      itemId: 10384,
      quantity: 2,
      description: "Example shoe",
      observedStock: 10,
    },
  ],
};

describe("createReserveOperationValues", () => {
  it("uses the order and operation IDs as the reserve adjustment note", () => {
    expect(
      createReserveOperationValues({
        operationId: "operation-1",
        orderId: "order-1",
        locationId: 61,
        items: [],
      }).note
    ).toBe("order-1:operation-1");
  });
});

describe("decideLateSettlementStockAction", () => {
  it("commits the original deduction when compensation has not started", () => {
    expect(decideLateSettlementStockAction("applied", null)).toBe(
      "commit_reserve"
    );
    expect(decideLateSettlementStockAction("applied", "pending")).toBe(
      "commit_reserve"
    );
  });

  it("re-acquires stock after compensation was confirmed", () => {
    expect(decideLateSettlementStockAction("applied", "applied")).toBe(
      "reacquire"
    );
  });

  it("requires manual review when either remote write is unresolved", () => {
    expect(decideLateSettlementStockAction("reconciling", null)).toBe(
      "manual_review"
    );
    expect(decideLateSettlementStockAction("applied", "in_flight")).toBe(
      "manual_review"
    );
    expect(decideLateSettlementStockAction("applied", "manual_review")).toBe(
      "manual_review"
    );
  });
});

describe("mergePreparedAdjustmentSnapshots", () => {
  it("durably associates each provider snapshot with its operation item", () => {
    const payload = {
      locationId: 61,
      items: [
        {
          variantId: "variant-1",
          itemId: 10384,
          quantity: 2,
          description: "Fallback",
        },
      ],
    };
    const snapshot = {
      description: "SKU-10384 - Example shoe",
      unit: "Buah",
      cost: 125_000,
      binId: 147,
      reserveAccountId: 901,
      releaseAccountId: 902,
    };

    expect(
      mergePreparedAdjustmentSnapshots(payload, [
        { itemId: 10384, snapshot },
      ])
    ).toEqual({
      locationId: 61,
      items: [
        {
          variantId: "variant-1",
          itemId: 10384,
          quantity: 2,
          description: "Fallback",
          snapshot,
        },
      ],
    });
  });
});

describe("runStockAdjustment", () => {
  it("logs the remote adjustment outcome with operation context", async () => {
    const events: Array<{ level: string; message: string; context?: Record<string, unknown> }> = [];
    const makeLog = (bound: Record<string, unknown> = {}): Logger => ({
      requestId: "request-1",
      debug: (message, context) => events.push({ level: "debug", message, context: { ...bound, ...context } }),
      info: (message, context) => events.push({ level: "info", message, context: { ...bound, ...context } }),
      warn: (message, context) => events.push({ level: "warn", message, context: { ...bound, ...context } }),
      error: (message, context) => events.push({ level: "error", message, context: { ...bound, ...context } }),
      child: (context) => makeLog({ ...bound, ...context }),
    });
    const log = makeLog();
    const gateway: JubelioStockGateway = {
      applyAdjustment: async () => ({
        adjustmentId: 9001,
        stocks: [{ itemId: 10384, onHand: 8 }],
      }),
      findAdjustmentByNote: async () => null,
      getStocks: async () => [],
    };

    await runStockAdjustment(operation, gateway, log);

    expect(events).toEqual([
      {
        level: "info",
        message: "Jubelio stock adjustment requested",
        context: {
          kind: "reserve",
          orderId: "order-1",
          operationId: "operation-1",
          locationId: 61,
          itemCount: 1,
        },
      },
      {
        level: "info",
        message: "Jubelio stock adjustment applied",
        context: {
          kind: "reserve",
          orderId: "order-1",
          operationId: "operation-1",
          locationId: 61,
          itemCount: 1,
          adjustmentId: 9001,
        },
      },
    ]);
  });

  it("returns the confirmed remote stock after Jubelio applies the adjustment", async () => {
    const gateway: JubelioStockGateway = {
      applyAdjustment: async () => ({
        adjustmentId: 9001,
        stocks: [{ itemId: 10384, onHand: 8 }],
      }),
      findAdjustmentByNote: async () => null,
      getStocks: async () => [],
    };

    await expect(runStockAdjustment(operation, gateway)).resolves.toEqual({
      status: "applied",
      adjustmentId: 9001,
      stocks: [{ itemId: 10384, onHand: 8 }],
    });
  });

  it("returns rejected when Jubelio definitively reports insufficient stock", async () => {
    const gateway: JubelioStockGateway = {
      applyAdjustment: async () => {
        throw new JubelioStockGatewayError("stock would become negative", {
          code: "P9005",
          httpStatus: 500,
          ambiguous: false,
          retryable: false,
        });
      },
      findAdjustmentByNote: async () => null,
      getStocks: async () => [],
    };

    await expect(runStockAdjustment(operation, gateway)).resolves.toEqual({
      status: "rejected",
      code: "P9005",
      message: "stock would become negative",
    });
  });

  it("returns backpressure when provider work expired before it was sent", async () => {
    const gateway: JubelioStockGateway = {
      applyAdjustment: async () => {
        throw new JubelioStockGatewayError("request queue wait timed out", {
          code: "QUEUE_TIMEOUT",
          ambiguous: false,
          retryable: true,
        });
      },
      findAdjustmentByNote: async () => null,
      getStocks: async () => [],
    };

    await expect(runStockAdjustment(operation, gateway)).resolves.toEqual({
      status: "backpressure",
      code: "QUEUE_TIMEOUT",
      message: "request queue wait timed out",
    });
  });

  it("keeps the operation reconciling when a timeout may have applied remotely", async () => {
    const gateway: JubelioStockGateway = {
      applyAdjustment: async () => {
        throw new JubelioStockGatewayError("request timed out", {
          ambiguous: true,
          retryable: true,
        });
      },
      findAdjustmentByNote: async () => null,
      getStocks: async () => [],
    };

    await expect(runStockAdjustment(operation, gateway)).resolves.toEqual({
      status: "reconciling",
      message: "request timed out",
    });
  });
});

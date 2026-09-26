import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import crypto from "node:crypto";

// =========================================================
// Ticket #06 — HTTP boundary test for the store's internal order-complete
// endpoint (the ONLY lawful runtime writer of the committed `completed`
// order status, called by the admin app after pickup verification).
//
// The mirror trigger is scheduled via `after()`: it fires ONLY from this
// committed `completed` transition (never from a code-verification success
// or the admin HTTP status alone), and a mirror failure can NEVER affect the
// already-committed completion or the response the admin received — the
// sweep's GET-only reconciliation covers any mirror gap. DB, email, and the
// Jubelio gateway are mocked: no real Jubelio/Midtrans traffic is possible.
// =========================================================

const afterCallbacks: Array<() => Promise<unknown> | unknown> = [];

vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return {
    ...actual,
    after: (callback: () => unknown) => {
      afterCallbacks.push(callback as () => unknown);
    },
  };
});

const mirrorMock = vi.hoisted(() => ({
  reconcileJubelioChannelStatusForOrder: vi.fn(),
}));

vi.mock("@/lib/jubelio-channel-mirror", () => ({
  reconcileJubelioChannelStatusForOrder:
    mirrorMock.reconcileJubelioChannelStatusForOrder,
}));

const emailMock = vi.hoisted(() => ({
  sendEmail: vi.fn(async () => undefined),
}));

vi.mock("@/lib/email", () => emailMock);

vi.mock("@/lib/email-templates-order", () => ({
  orderCompletedEmailHTML: vi.fn(() => "<html/>"),
  orderCompletedEmailText: vi.fn(() => "text"),
}));

const orderId = "oc-route-order-1";
const readyOrder = {
  id: orderId,
  status: "ready_for_pickup",
  paymentStatus: "paid",
  total: "1000",
  subtotal: "1000",
  serviceFee: "0",
  ppnRate: "11",
  ppnAmount: "0",
  pickupDate: null,
  pickupTime: null,
  contactEmail: "client@example.com",
};

let selectOrdersResult: Array<Record<string, unknown>> = [readyOrder];
const updateSets: Array<Record<string, unknown>> = [];

vi.mock("@/db", () => {
  const ORDERS = "orders-table";
  const ITEMS = "items-table";
  return {
    orders: ORDERS,
    orderItems: ITEMS,
    db: {
      select: () => ({
        from: (table: unknown) => ({
          where: () => ({
            limit: async () => (table === ORDERS ? selectOrdersResult : []),
          }),
        }),
      }),
      update: () => ({
        set: (values: Record<string, unknown>) => {
          updateSets.push(values);
          return {
            where: async () => undefined,
          };
        },
      }),
    },
  };
});

function completeRequest(orderIdInput: string, secret?: string): NextRequest {
  return new NextRequest("http://localhost:3000/api/internal/order-complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderId: orderIdInput, secret }),
  });
}

async function runAfterCallbacks(): Promise<void> {
  for (const callback of afterCallbacks.splice(0)) {
    await callback();
  }
}

describe("order-complete route (ticket #06: committed-completed mirror trigger seam)", () => {
  beforeEach(() => {
    afterCallbacks.length = 0;
    selectOrdersResult = [readyOrder];
    updateSets.length = 0;
    mirrorMock.reconcileJubelioChannelStatusForOrder.mockReset();
    mirrorMock.reconcileJubelioChannelStatusForOrder.mockResolvedValue({
      status: "confirmed",
      intent: { id: "intent-1" },
    });
    emailMock.sendEmail.mockReset();
    emailMock.sendEmail.mockResolvedValue(undefined);
    process.env.BETTER_AUTH_SECRET = "test-completion-secret";
  });

  function expectedSecret(id: string): string {
    // Independent HMAC construction (mirrors the documented contract), not a
    // call into the route's helper.
    return crypto
      .createHmac("sha256", "test-completion-secret")
      .update(id)
      .digest("hex");
  }

  it("schedules the channel mirror reconciliation with the completed order id ONLY after the completion is committed", async () => {
    const { POST } = await import("./route");
    const response = await POST(completeRequest(orderId, expectedSecret(orderId)));
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);

    // The trigger is scheduled, not awaited: the store->admin response (and
    // the pickup flow) never waits on the mirror.
    expect(mirrorMock.reconcileJubelioChannelStatusForOrder).not.toHaveBeenCalled();

    await runAfterCallbacks();

    expect(
      mirrorMock.reconcileJubelioChannelStatusForOrder
    ).toHaveBeenCalledTimes(1);
    expect(mirrorMock.reconcileJubelioChannelStatusForOrder).toHaveBeenCalledWith(
      expect.anything(),
      { orderId, logger: expect.objectContaining({ child: expect.any(Function) }) }
    );
    // The committed transition happened BEFORE the mirror trigger ran.
    expect(updateSets).toEqual([expect.objectContaining({ status: "completed" })]);
  });

  it("a mirror failure NEVER fails the completion response (noninterference)", async () => {
    mirrorMock.reconcileJubelioChannelStatusForOrder.mockRejectedValue(
      new Error("Jubelio gateway unavailable")
    );
    const { POST } = await import("./route");
    const response = await POST(completeRequest(orderId, expectedSecret(orderId)));
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    // The committed completion is untouched and both after-callbacks run.
    await runAfterCallbacks();
    expect(mirrorMock.reconcileJubelioChannelStatusForOrder).toHaveBeenCalledTimes(1);
    expect(emailMock.sendEmail).toHaveBeenCalledTimes(1);
  });

  it("does NOT trigger the mirror when the order is not ready_for_pickup (no committed completed transition)", async () => {
    selectOrdersResult = [{ ...readyOrder, status: "processing" }];
    const { POST } = await import("./route");
    const response = await POST(completeRequest(orderId, expectedSecret(orderId)));
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.success).toBe(false);
    await runAfterCallbacks();
    expect(mirrorMock.reconcileJubelioChannelStatusForOrder).not.toHaveBeenCalled();
  });

  it("does NOT trigger the mirror for an unauthorized or failed completion", async () => {
    const { POST } = await import("./route");
    const unauthorized = await POST(completeRequest(orderId, "wrong-secret"));
    expect(unauthorized.status).toBe(403);

    selectOrdersResult = []; // order not found at the store
    const missing = await POST(
      completeRequest("oc-route-order-2", expectedSecret("oc-route-order-2"))
    );
    expect(missing.status).toBe(404);

    await runAfterCallbacks();
    expect(mirrorMock.reconcileJubelioChannelStatusForOrder).not.toHaveBeenCalled();
    expect(updateSets).toHaveLength(0);
  });
});
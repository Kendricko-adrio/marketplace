import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// =========================================================
// HTTP cron boundary test for the Sales-Order sweep (ticket #03 slice: the
// cron now also runs the bounded channel-status mirror reconciliation).
// The DB, Midtrans and the provider are mocked: this test proves the HTTP
// contract only — the auth gate, the 200 envelope including the new
// `channelMirrorReview` field, and that a mirror failure NEVER fails the
// sweep (mirror errors are logged, the sweep still returns 200). No real
// Jubelio/Midtrans traffic is possible from here.
// =========================================================

const h = vi.hoisted(() => ({ env: {} as Record<string, string | undefined> }));

vi.mock("@/db", () => {
  const ORDERS = "orders-table";
  const OPS = "ops-table";
  const makeDb = () => ({
    select: () => ({
      from: (table: unknown) => ({
        where: () => ({
          limit: async () => (table === ORDERS ? [] : []),
          orderBy: () => ({ limit: async () => [] }),
        }),
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => ({ returning: async () => [] }),
      }),
    }),
    insert: () => ({
      values: () => ({
        onConflictDoNothing: () => ({ returning: async () => [] }),
      }),
    }),
    transaction: async () => {
      throw new Error("no transactions in this test");
    },
  });
  return { db: makeDb(), orders: ORDERS, jubelioSalesOperations: OPS };
});

vi.mock("@/lib/midtrans", () => ({
  getMidtransTransactionStatus: vi.fn(),
  expireMidtransTransaction: vi.fn(),
}));

vi.mock("@/lib/order-finalize", () => ({
  claimAndFailOrder: vi.fn(),
  claimPaidOrder: vi.fn(),
}));

const mirrorMock = vi.hoisted(() => ({
  reconcileChannelStatusMirrorForSweep: vi.fn(),
}));
vi.mock("@/lib/jubelio-channel-mirror", () => ({
  reconcileChannelStatusMirrorForSweep: mirrorMock.reconcileChannelStatusMirrorForSweep,
}));

const settlementMock = vi.hoisted(() => ({
  reconcileJubelioSalesOperations: vi.fn(async () => ({
    scanned: 0,
    confirmed: 0,
    released: 0,
    marked: 0,
    pending: 0,
  })),
  reconcileSettlements: vi.fn(async () => ({
    scanned: 0,
    fulfilled: 0,
    review: 0,
    pending: 0,
  })),
}));
vi.mock("@/lib/jubelio-sales-settlement", () => ({
  settleJubelioSalesOrder: vi.fn(),
  reconcileJubelioSalesOperations: settlementMock.reconcileJubelioSalesOperations,
  reconcileSettlements: settlementMock.reconcileSettlements,
}));

vi.mock("@/lib/jubelio-sales-lifecycle", () => ({
  reconcileConfirmedSalesOrderHolds: vi.fn(async () => 0),
}));


function cronRequest(secret?: string): NextRequest {
  return new NextRequest("http://localhost:3000/api/cron/sweep-reservations", {
    method: "POST",
    headers: secret ? { "x-cron-secret": secret } : {},
  });
}

describe("sweep cron HTTP boundary (channel mirror included)", () => {
  beforeEach(() => {
    h.env.CRON_SECRET = process.env.CRON_SECRET;
    process.env.CRON_SECRET = "test-cron-secret";
    vi.mocked(console.log, true);
  });

  it("refuses the sweep without or with a wrong cron secret (503 / 401)", async () => {
    const { POST } = await import("./route");
    const previous = process.env.CRON_SECRET;
    delete process.env.CRON_SECRET;
    try {
      const missing = await POST(cronRequest(undefined));
      expect(missing.status).toBe(503);
    } finally {
      process.env.CRON_SECRET = previous;
    }
    const wrong = await POST(cronRequest("incorrect-secret"));
    expect(wrong.status).toBe(401);
    const data = await wrong.json();
    expect(data.success).toBe(false);
  });

  it("returns 200 with a channelMirrorReview summary; a mirror failure never fails the sweep", async () => {
    const { POST } = await import("./route");
    const response = await POST(cronRequest("test-cron-secret"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    // The bounded channel mirror step ran and is observable in the response.
    expect(body.channelMirrorReview).toBeDefined();
    expect(body.channelMirrorReview).toMatchObject({
      possiblySentScanned: expect.any(Number),
      skippedFresh: expect.any(Number),
      recovered: expect.any(Number),
      investigated: expect.any(Number),
      stillUnknown: expect.any(Number),
      missedOrdersScanned: expect.any(Number),
      missedDispatched: expect.any(Number),
      failed: expect.any(Number),
    });
    // In this environment the live Jubelio gateway is disabled by default
    // (no real traffic is possible), so a failed mirror step must be
    // recorded, not fatal: the sweep still succeeds.
    expect(body.jubelioSalesReview).toBeDefined();
    expect(body.settlementReview).toBeDefined();
  });

  it("(D) runs the LOW-PRIORITY mirror step AFTER the settlement steps and surfaces missedFailed", async () => {
    mirrorMock.reconcileChannelStatusMirrorForSweep.mockResolvedValueOnce({
      possiblySentScanned: 3,
      skippedFresh: 1,
      recovered: 1,
      investigated: 1,
      stillUnknown: 0,
      pendingTerminalScanned: 1,
      pendingTerminalAborted: 1,
      pendingTerminalSkipped: 0,
      missedOrdersScanned: 2,
      missedDispatched: 2,
      missedFailed: 1,
      // Ticket #04: the bounded paid-but-blocked Menunggu Verifikasi window.
      verifikasiOrdersScanned: 4,
      verifikasiDispatched: 3,
      verifikasiFailed: 1,
      // Ticket #05: the bounded failed_payment Gagal Bayar window.
      gagalBayarOrdersScanned: 5,
      gagalBayarDispatched: 2,
      gagalBayarFailed: 1,
    });
    const { POST } = await import("./route");
    const response = await POST(cronRequest("test-cron-secret"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.channelMirrorReview).toMatchObject({
      recovered: 1,
      investigated: 1,
      pendingTerminalAborted: 1, // scheduled pending-terminal disposition surfaced
      missedDispatched: 2,
      missedFailed: 1, // surfaced in the HTTP summary
      verifikasiDispatched: 3, // ticket #04 paid-but-blocked window surfaced
      verifikasiFailed: 1,
      gagalBayarDispatched: 2, // ticket #05 failed_payment window surfaced
      gagalBayarFailed: 1,
    });
    // Ordering: the low-priority mirror runs AFTER both critical settlement
    // steps (durable ops reconcile and settlement resume), so the 55s cron
    // budget is spent on settlement/expiry before the best-effort mirror.
    const settlementOrder = vi
      .mocked(settlementMock.reconcileSettlements)
      .mock.invocationCallOrder[0];
    const mirrorOrder =
      mirrorMock.reconcileChannelStatusMirrorForSweep.mock.invocationCallOrder[0];
    expect(settlementOrder).toBeLessThan(mirrorOrder);
    const opsOrder = settlementMock.reconcileJubelioSalesOperations.mock
      .invocationCallOrder[0];
    expect(opsOrder).toBeLessThan(mirrorOrder);
  });

  it("(D) a thrown mirror step is isolated: the sweep still returns 200 with failed=1", async () => {
    mirrorMock.reconcileChannelStatusMirrorForSweep.mockRejectedValueOnce(
      new Error("mirror exploded")
    );
    const { POST } = await import("./route");
    const response = await POST(cronRequest("test-cron-secret"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.channelMirrorReview.failed).toBe(1);
  });
});
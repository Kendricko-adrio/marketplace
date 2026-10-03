import { describe, expect, it, vi, beforeEach } from "vitest";

// =========================================================
// Settlement orchestration tests (plan feature 3). The DB and the external
// pipeline are mocked; what is under test is the ORDER of the durable gates:
//   - paid-but-ambiguous → stays paid, blocked, manual_review
//   - never Path 2, never an automatic retry or refund
//   - a paid-but-blocked order can never be fulfilled
// =========================================================

const h = vi.hoisted(() => {
  return {
    orderRows: [] as Array<Record<string, unknown>>,
    cancelOpRows: [] as Array<Record<string, unknown>>,
  };
});

vi.mock("@/db", () => {
  const ORDERS = "orders-table";
  const OPS = "ops-table";
  const makeDb = () => ({
    select: () => ({
      from: (table: unknown) => {
        return {
          where: () => ({
            limit: async () => (table === ORDERS ? h.orderRows : h.cancelOpRows),
            orderBy: () => ({
              limit: async () => (table === ORDERS ? h.orderRows : h.cancelOpRows),
            }),
          }),
        };
      },
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
  });
  return {
    db: makeDb(),
    orders: ORDERS,
    jubelioSalesOperations: OPS,
  };
});

vi.mock("./jubelio-sales-lifecycle", () => ({
  ensureJubelioInvoice: vi.fn(),
  ensureJubelioPayment: vi.fn(),
  getDefaultJubelioSalesGateway: () => ({}),
  releaseConfirmedSalesOrderHold: vi.fn(),
}));

vi.mock("./order-finalize", () => ({
  blockOrderFulfillment: vi.fn(),
  fulfillPaidOrder: vi.fn(),
}));

const channelMirror = vi.hoisted(() => ({
  reconcileJubelioChannelStatusForOrder: vi.fn(),
}));
vi.mock("./jubelio-channel-mirror", () => ({
  reconcileJubelioChannelStatusForOrder: channelMirror.reconcileJubelioChannelStatusForOrder,
}));

import { settleJubelioSalesOrder } from "./jubelio-sales-settlement";
import {
  ensureJubelioInvoice,
  ensureJubelioPayment,
} from "./jubelio-sales-lifecycle";
import { blockOrderFulfillment, fulfillPaidOrder } from "./order-finalize";

const paidOrder = {
  id: "order-1",
  branchId: "branch-1",
  contactEmail: "c@example.test",
  total: "1100",
  subtotal: "1000",
  serviceFee: "0",
  ppnRate: "11",
  ppnAmount: "100",
  pickupDate: null,
  pickupTime: null,
  status: "processing",
  paymentStatus: "paid",
};

beforeEach(() => {
  vi.clearAllMocks();
  h.orderRows = [];
  h.cancelOpRows = [];
});

describe("money helpers", () => {
  it("stay tolerant but fail closed", async () => {
    const actual = await vi.importActual<typeof import("./jubelio-sales-lifecycle")>(
      "./jubelio-sales-lifecycle"
    );
    expect(actual.toIntegerMoney("275000.00")).toBe(275000);
    expect(actual.toIntegerMoney(1000.4)).toBe(1000);
    expect(actual.moneyEquals(1000, 1000.0000001)).toBe(true);
    expect(actual.moneyEquals(1000, 1000.01)).toBe(false);
    expect(actual.moneyEquals(NaN, 1000)).toBe(false);
  });
});

describe("settleJubelioSalesOrder", () => {
  it("skips orders that are not paid", async () => {
    h.orderRows = [{ ...paidOrder, paymentStatus: "pending" }];
    const result = await settleJubelioSalesOrder("order-1");
    expect(result.status).toBe("skipped");
    expect(ensureJubelioInvoice).not.toHaveBeenCalled();
  });

  it("routes to manual review when a cancel operation is active", async () => {
    h.orderRows = [paidOrder];
    h.cancelOpRows = [{ status: "confirmed" }];
    const result = await settleJubelioSalesOrder("order-1");
    expect(result.status).toBe("manual_review");
    expect(blockOrderFulfillment).toHaveBeenCalledWith(
      "order-1",
      expect.stringContaining("cancel")
    );
    expect(ensureJubelioInvoice).not.toHaveBeenCalled();
  });

  it("stops before payment when the invoice step is not confirmed", async () => {
    h.orderRows = [paidOrder];
    vi.mocked(ensureJubelioInvoice).mockResolvedValue({
      status: "manual_review",
      message: "Invoice grand total mismatch",
    });
    const result = await settleJubelioSalesOrder("order-1");
    expect(result.status).toBe("manual_review");
    expect(ensureJubelioPayment).not.toHaveBeenCalled();
    expect(blockOrderFulfillment).toHaveBeenCalledWith(
      "order-1",
      expect.stringContaining("invoice")
    );
    expect(fulfillPaidOrder).not.toHaveBeenCalled();
  });

  it("fulfills only after BOTH invoice and payment are confirmed", async () => {
    h.orderRows = [paidOrder];
    vi.mocked(ensureJubelioInvoice).mockResolvedValue({ status: "confirmed" });
    vi.mocked(ensureJubelioPayment).mockResolvedValue({ status: "confirmed" });
    vi.mocked(fulfillPaidOrder).mockResolvedValue({
      claimed: true,
      pickupCode: "ABC234",
    });
    const result = await settleJubelioSalesOrder("order-1");
    expect(result).toEqual({ status: "fulfilled", pickupCode: "ABC234" });
    const invoiceCall = vi.mocked(ensureJubelioInvoice).mock.invocationCallOrder[0];
    const paymentCall = vi.mocked(ensureJubelioPayment).mock.invocationCallOrder[0];
    expect(invoiceCall).toBeLessThan(paymentCall);
  });

  it("best-effort reconciles the Siap Proses mirror AFTER pickup was granted and never lets a mirror failure block or unfulfill pickup", async () => {
    h.orderRows = [paidOrder];
    vi.mocked(ensureJubelioInvoice).mockResolvedValue({ status: "confirmed" });
    vi.mocked(ensureJubelioPayment).mockResolvedValue({ status: "confirmed" });
    vi.mocked(fulfillPaidOrder).mockResolvedValue({
      claimed: true,
      pickupCode: "ABC234",
    });
    channelMirror.reconcileJubelioChannelStatusForOrder.mockResolvedValueOnce({
      status: "confirmed",
    });
    let result = await settleJubelioSalesOrder("order-1");
    expect(result).toEqual({ status: "fulfilled", pickupCode: "ABC234" });
    expect(channelMirror.reconcileJubelioChannelStatusForOrder).toHaveBeenCalledTimes(1);
    expect(channelMirror.reconcileJubelioChannelStatusForOrder).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orderId: "order-1" })
    );

    // A mirror crash must NOT unfulfill pickup or fail the settlement.
    channelMirror.reconcileJubelioChannelStatusForOrder.mockReset();
    channelMirror.reconcileJubelioChannelStatusForOrder.mockRejectedValueOnce(
      new Error("mirror exploded")
    );
    result = await settleJubelioSalesOrder("order-1");
    expect(result).toEqual({ status: "fulfilled", pickupCode: "ABC234" });

    // The mirror trigger only fires when pickup was actually claimed: a
    // pre-fulfillment failure never touches the mirror.
    channelMirror.reconcileJubelioChannelStatusForOrder.mockClear();
    vi.mocked(fulfillPaidOrder).mockResolvedValue({ claimed: false });
    await settleJubelioSalesOrder("order-1");
    expect(channelMirror.reconcileJubelioChannelStatusForOrder).not.toHaveBeenCalled();
  });

  it("blocks fulfillment when the payment step reports manual review", async () => {
    h.orderRows = [paidOrder];
    vi.mocked(ensureJubelioInvoice).mockResolvedValue({ status: "confirmed" });
    vi.mocked(ensureJubelioPayment).mockResolvedValue({
      status: "manual_review",
      message: "payment id missing",
    });
    const result = await settleJubelioSalesOrder("order-1");
    expect(result.status).toBe("manual_review");
    expect(fulfillPaidOrder).not.toHaveBeenCalled();
    expect(blockOrderFulfillment).toHaveBeenCalledWith(
      "order-1",
      expect.stringContaining("payment is unverified")
    );
  });
});
describe("settleJubelioSalesOrder — ticket #04 Menunggu Verifikasi mirror trigger", () => {
  it("best-effort reconciles the Menunggu Verifikasi mirror after a committed settlement manual review and never changes the manual_review outcome", async () => {
    h.orderRows = [paidOrder];
    vi.mocked(ensureJubelioInvoice).mockResolvedValue({
      status: "manual_review",
      message: "Invoice grand total mismatch",
    });
    channelMirror.reconcileJubelioChannelStatusForOrder.mockResolvedValueOnce({
      status: "confirmed",
    });

    const result = await settleJubelioSalesOrder("order-1");

    // The manual-review outcome, the block and the ledger gates are unchanged.
    expect(result.status).toBe("manual_review");
    expect(blockOrderFulfillment).toHaveBeenCalledWith(
      "order-1",
      expect.stringContaining("invoice")
    );
    // The mirror trigger fires AFTER the committed block.
    const blockCall = vi.mocked(blockOrderFulfillment).mock.invocationCallOrder[0];
    const mirrorCall =
      channelMirror.reconcileJubelioChannelStatusForOrder.mock.invocationCallOrder[0];
    expect(blockCall).toBeLessThan(mirrorCall);
    expect(channelMirror.reconcileJubelioChannelStatusForOrder).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orderId: "order-1" })
    );
  });

  it("a Menunggu Verifikasi mirror failure after a settlement manual review never fails the settlement", async () => {
    h.orderRows = [paidOrder];
    vi.mocked(ensureJubelioInvoice).mockResolvedValue({ status: "confirmed" });
    vi.mocked(ensureJubelioPayment).mockResolvedValue({
      status: "manual_review",
      message: "payment association ambiguous",
    });
    channelMirror.reconcileJubelioChannelStatusForOrder.mockRejectedValueOnce(
      new Error("mirror exploded")
    );

    const result = await settleJubelioSalesOrder("order-1");

    expect(result.status).toBe("manual_review");
    expect(fulfillPaidOrder).not.toHaveBeenCalled();
    expect(blockOrderFulfillment).toHaveBeenCalledWith(
      "order-1",
      expect.stringContaining("payment is unverified")
    );
  });

  it("does NOT trigger the mirror when the settlement step is merely pending/in flight (no committed block)", async () => {
    h.orderRows = [paidOrder];
    // A short in-flight settlement step: no committed block, so no mirror
    // trigger.
    vi.mocked(ensureJubelioInvoice).mockResolvedValue({ status: "in_flight" });

    const result = await settleJubelioSalesOrder("order-1");

    expect(result.status).toBe("pending");
    expect(blockOrderFulfillment).not.toHaveBeenCalled();
    expect(channelMirror.reconcileJubelioChannelStatusForOrder).not.toHaveBeenCalled();
  });
});

describe("settleJubelioSalesOrder — ticket #04 delivery fulfillment gate", () => {
  it("keeps a verified-paid DELIVERY order in processing with no pickup code and no pickup fulfillment", async () => {
    // The paid delivery order: settlement verified, but delivery NEVER
    // becomes ready_for_pickup — no pickup code, no pickup email, no pickup
    // fulfillment claim. The fulfillment gate for delivery completes the
    // order as `processing` only.
    h.orderRows = [
      {
        ...paidOrder,
        pickupDate: null,
        pickupTime: null,
        fulfillmentMethod: "delivery",
      },
    ];
    vi.mocked(ensureJubelioInvoice).mockResolvedValue({ status: "confirmed" });
    vi.mocked(ensureJubelioPayment).mockResolvedValue({ status: "confirmed" });

    const result = await settleJubelioSalesOrder("order-1");

    expect(result.status).toBe("fulfilled");
    expect((result as { pickupCode?: string | null }).pickupCode).toBe(null);
    // The pickup fulfillment claim must NOT run for a delivery order.
    expect(fulfillPaidOrder).not.toHaveBeenCalled();
    // The Siap-Proses mirror trigger is pickup-specific — never delivery.
    expect(channelMirror.reconcileJubelioChannelStatusForOrder).not.toHaveBeenCalled();
  });

  it("still blocks a paid DELIVERY order whose invoice conversion is ambiguous (paid-but-blocked, no code)", async () => {
    h.orderRows = [
      {
        ...paidOrder,
        pickupDate: null,
        pickupTime: null,
        fulfillmentMethod: "delivery",
      },
    ];
    vi.mocked(ensureJubelioInvoice).mockResolvedValue({
      status: "manual_review",
      message: "invoice conversion timed out after apply",
    });

    const result = await settleJubelioSalesOrder("order-1");

    expect(result.status).toBe("manual_review");
    expect(ensureJubelioPayment).not.toHaveBeenCalled();
    expect(fulfillPaidOrder).not.toHaveBeenCalled();
    expect(blockOrderFulfillment).toHaveBeenCalledWith(
      "order-1",
      expect.stringContaining("invoice")
    );
  });
});

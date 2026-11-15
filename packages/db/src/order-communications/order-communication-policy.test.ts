import { describe, expect, it } from "vitest";
import {
  isOrderEmailApplicable,
  nextOrderEmailAttempt,
} from "./order-communication-policy";
import type {
  OrderCommunicationStage,
  OrderCommunicationState,
  OrderEmailKind,
} from "./order-communication-contract";

function deliveryStage(
  overrides: Partial<OrderCommunicationStage> = {}
): OrderCommunicationStage {
  return {
    fulfillmentMethod: "delivery",
    orderStatus: "processing",
    paymentStatus: "paid",
    ready: true,
    inTransit: false,
    delivered: false,
    closedManually: false,
    ...overrides,
  };
}

function pickupStage(
  overrides: Partial<OrderCommunicationStage> = {}
): OrderCommunicationStage {
  return {
    fulfillmentMethod: "pickup",
    orderStatus: "ready_for_pickup",
    paymentStatus: "paid",
    ready: true,
    inTransit: false,
    delivered: false,
    closedManually: false,
    ...overrides,
  };
}

function state(
  stage: OrderCommunicationStage,
  version = 1
): OrderCommunicationState {
  return {
    orderId: "order-fixture",
    orderCommunicationVersion: version,
    stage,
    events: [],
    emailJobs: [],
  };
}

function applicable(kind: OrderEmailKind, stage: OrderCommunicationStage) {
  return isOrderEmailApplicable({ kind, state: state(stage) });
}

describe("order email applicability (spec §5.3)", () => {
  it("delivery: ready hanya pada tahap siap diproses", () => {
    expect(applicable("delivery_ready", deliveryStage())).toBe(true);
    expect(applicable("delivery_in_transit", deliveryStage())).toBe(false);
    expect(applicable("delivery_delivered", deliveryStage())).toBe(false);
  });

  it("delivery: in_transit menggantikan ready dan hilang setelah delivered", () => {
    const inTransit = deliveryStage({ inTransit: true });
    expect(applicable("delivery_in_transit", inTransit)).toBe(true);
    expect(applicable("delivery_ready", inTransit)).toBe(false);
    const delivered = deliveryStage({ inTransit: true, delivered: true });
    expect(applicable("delivery_in_transit", delivered)).toBe(false);
    expect(applicable("delivery_delivered", delivered)).toBe(true);
  });

  it("penutupan manual menghentikan ready/in_transit tanpa menciptakan delivered", () => {
    const closed = deliveryStage({
      orderStatus: "completed",
      closedManually: true,
    });
    expect(applicable("delivery_ready", closed)).toBe(false);
    expect(applicable("delivery_in_transit", closed)).toBe(false);
    expect(applicable("delivery_delivered", closed)).toBe(false);
  });

  it("bukti DELIVERED valid setelah penutupan manual tetap menghasilkan email sudah sampai", () => {
    const late = deliveryStage({
      orderStatus: "completed",
      closedManually: true,
      delivered: true,
    });
    expect(applicable("delivery_delivered", late)).toBe(true);
  });

  it("delivery: gate finansial belum terverifikasi tidak pernah mengirim email", () => {
    const notReady = deliveryStage({ ready: false });
    expect(applicable("delivery_ready", notReady)).toBe(false);
  });

  it("pickup: ready lalu completed, dan ready tertunda hilang setelah selesai", () => {
    expect(applicable("pickup_ready", pickupStage())).toBe(true);
    const completed = pickupStage({ orderStatus: "completed" });
    expect(applicable("pickup_completed", completed)).toBe(true);
    expect(applicable("pickup_ready", completed)).toBe(false);
  });

  it("delivery tidak pernah mendapat email pickup dan sebaliknya", () => {
    expect(applicable("pickup_ready", deliveryStage())).toBe(false);
    expect(applicable("delivery_ready", pickupStage())).toBe(false);
    expect(applicable("pickup_completed", deliveryStage({ orderStatus: "completed" }))).toBe(false);
    expect(applicable("delivery_delivered", pickupStage({ delivered: true }))).toBe(false);
  });

  it("payment_failed tidak dikirim setelah order menjadi paid", () => {
    const failed = pickupStage({
      orderStatus: "failed_payment",
      paymentStatus: "failed",
      ready: false,
    });
    expect(applicable("payment_failed", failed)).toBe(true);
    const latePaid = pickupStage({
      orderStatus: "processing",
      paymentStatus: "paid",
    });
    expect(applicable("payment_failed", latePaid)).toBe(false);
  });

  it("order versi komunikasi 0 tidak pernah mendapat efek email baru", () => {
    expect(
      isOrderEmailApplicable({
        kind: "delivery_ready",
        state: state(deliveryStage(), 0),
      })
    ).toBe(false);
  });
});

describe("order email retry policy (spec §5.2)", () => {
  const now = new Date("2040-01-01T00:00:00Z");
  const fiveMinutes = 5 * 60_000;

  it("kegagalan sementara menjadwalkan retry lima menit setelah attempt", () => {
    const decision = nextOrderEmailAttempt({
      attemptCount: 1,
      outcome: "temporary",
      now,
    });
    expect(decision.status).toBe("retry");
    expect(decision.nextAttemptAt?.toISOString()).toBe(
      new Date(now.getTime() + fiveMinutes).toISOString()
    );
  });

  it("hasil tidak pasti memakai batas retry yang sama", () => {
    const decision = nextOrderEmailAttempt({
      attemptCount: 1,
      outcome: "uncertain",
      now,
    });
    expect(decision.status).toBe("retry");
  });

  it("percobaan keempat menjadi failed tanpa jadwal berikutnya", () => {
    expect(
      nextOrderEmailAttempt({ attemptCount: 4, outcome: "temporary", now })
    ).toEqual({ status: "failed", nextAttemptAt: null });
    expect(
      nextOrderEmailAttempt({ attemptCount: 3, outcome: "uncertain", now })
        .status
    ).toBe("retry");
  });

  it("kegagalan definitif tidak pernah diulang otomatis", () => {
    expect(
      nextOrderEmailAttempt({ attemptCount: 1, outcome: "permanent", now })
    ).toEqual({ status: "failed", nextAttemptAt: null });
  });
});

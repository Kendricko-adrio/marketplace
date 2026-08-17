import { db } from "@/db";
import {
  branchStocks,
  jubelioStockOperations,
  orders,
  type JubelioStockOperationPayload,
} from "@/db";
import { and, eq, inArray, lte, sql } from "drizzle-orm";
import {
  createJubelioStockGateway,
  JubelioStockGatewayError,
  type JubelioAdjustmentRequest,
  type JubelioStockGateway,
} from "./jubelio-stock-client";
import { createLogger, serializeError, type Logger } from "./logger";

export type StockAdjustmentOutcome =
  | {
      status: "applied";
      adjustmentId: number;
      stocks: Array<{ itemId: number; onHand: number }>;
    }
  | { status: "rejected"; code?: string; message: string }
  | { status: "reconciling"; message: string };

export async function runStockAdjustment(
  operation: JubelioAdjustmentRequest,
  gateway: JubelioStockGateway,
  logger: Logger = createLogger({ module: "jubelio-stock" })
): Promise<StockAdjustmentOutcome> {
  const log = logger.child({
    orderId: operation.orderId,
    operationId: operation.operationId,
    kind: operation.kind,
    locationId: operation.locationId,
    itemCount: operation.items.length,
  });
  log.info("Jubelio stock adjustment requested");
  try {
    const result = await gateway.applyAdjustment(operation);
    log.info("Jubelio stock adjustment applied", {
      adjustmentId: result.adjustmentId,
    });
    return { status: "applied", ...result };
  } catch (error) {
    if (error instanceof JubelioStockGatewayError) {
      if (error.options.ambiguous) {
        log.warn("Jubelio stock adjustment needs reconciliation", {
          code: error.options.code,
          httpStatus: error.options.httpStatus,
          error: serializeError(error),
        });
        return { status: "reconciling", message: error.message };
      }
      log.warn("Jubelio stock adjustment rejected", {
        code: error.options.code,
        httpStatus: error.options.httpStatus,
        error: serializeError(error),
      });
      return {
        status: "rejected",
        code: error.options.code,
        message: error.message,
      };
    }
    log.warn("Jubelio stock adjustment failed unexpectedly", {
      error: serializeError(error),
    });
    return {
      status: "reconciling",
      message: error instanceof Error ? error.message : "Unexpected Jubelio error",
    };
  }
}

function retryAt(attemptCount: number): Date {
  const seconds = Math.min(30 * 2 ** Math.max(0, attemptCount - 1), 15 * 60);
  return new Date(Date.now() + seconds * 1000);
}

export async function enqueueJubelioRelease(
  orderId: string,
  logger?: Logger
): Promise<void> {
  const reserveRows = await db
    .select()
    .from(jubelioStockOperations)
    .where(
      and(
        eq(jubelioStockOperations.orderId, orderId),
        eq(jubelioStockOperations.type, "reserve")
      )
    )
    .limit(1);
  if (reserveRows.length === 0) {
    logger?.debug("Jubelio release skipped — reserve operation not found", { orderId });
    return;
  }
  const id = crypto.randomUUID();
  await db
    .insert(jubelioStockOperations)
    .values({
      id,
      orderId,
      type: "release",
      status: "pending",
      note: `OKCIR_RELEASE:${orderId}:${id}`,
      payload: reserveRows[0].payload,
    })
    .onConflictDoNothing();
  logger?.info("Jubelio release operation enqueued", { orderId, operationId: id });
}

export async function releaseJubelioStockForOrder(
  orderId: string,
  gateway?: JubelioStockGateway,
  logger?: Logger
): Promise<StockAdjustmentOutcome | { status: "skipped" }> {
  await enqueueJubelioRelease(orderId, logger);
  const rows = await db
    .select({ id: jubelioStockOperations.id })
    .from(jubelioStockOperations)
    .where(
      and(
        eq(jubelioStockOperations.orderId, orderId),
        eq(jubelioStockOperations.type, "release")
      )
    )
    .limit(1);
  if (rows.length === 0) {
    logger?.debug("Jubelio stock release skipped", { orderId });
    return { status: "skipped" };
  }
  return applyJubelioStockOperation(rows[0].id, gateway, logger);
}

async function markApplied(
  operation: typeof jubelioStockOperations.$inferSelect,
  adjustmentId: number,
  stocks: Array<{ itemId: number; onHand: number }>
): Promise<boolean> {
  const stockByItem = new Map(stocks.map((stock) => [stock.itemId, stock.onHand]));
  const didApply = await db.transaction(async (tx) => {
    const claimed = await tx
      .update(jubelioStockOperations)
      .set({
        status: "applied",
        remoteAdjustmentId: adjustmentId,
        lastError: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(jubelioStockOperations.id, operation.id),
          inArray(jubelioStockOperations.status, ["in_flight", "reconciling"])
        )
      )
      .returning({ id: jubelioStockOperations.id });
    if (claimed.length === 0) return false;

    // The local branch id is not the Jubelio location id. Update each stock row
    // through the payload variant id; an order only has one branch, resolved by
    // the order relation below.
    const orderRows = await tx
      .select({ branchId: orders.branchId, status: orders.status })
      .from(orders)
      .where(eq(orders.id, operation.orderId))
      .limit(1);
    const branchId = orderRows[0]?.branchId;
    if (!branchId) throw new Error(`Order ${operation.orderId} has no branch`);

    for (const item of operation.payload.items) {
      const onHand = stockByItem.get(item.itemId)!;
      if (operation.type === "reserve") {
        const updated = await tx
          .update(branchStocks)
          .set({
            stock: onHand,
            pendingRemoteStock: sql`GREATEST(0, ${branchStocks.pendingRemoteStock} - ${item.quantity})`,
            reservedStock: sql`${branchStocks.reservedStock} + ${item.quantity}`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(branchStocks.branchId, branchId),
              eq(branchStocks.productVariantId, item.variantId)
            )
          )
          .returning({ branchId: branchStocks.branchId });
        if (updated.length === 0) {
          throw new Error(`Missing branch stock for variant ${item.variantId}`);
        }
      } else {
        const updated = await tx
          .update(branchStocks)
          .set({
            stock: onHand,
            reservedStock: sql`GREATEST(0, ${branchStocks.reservedStock} - ${item.quantity})`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(branchStocks.branchId, branchId),
              eq(branchStocks.productVariantId, item.variantId)
            )
          )
          .returning({ branchId: branchStocks.branchId });
        if (updated.length === 0) {
          throw new Error(`Missing branch stock for variant ${item.variantId}`);
        }
      }
    }
    return true;
  });

  if (!didApply) return false;

  if (operation.type === "reserve") {
    const orderRows = await db
      .select({ status: orders.status })
      .from(orders)
      .where(eq(orders.id, operation.orderId))
      .limit(1);
    if (orderRows[0]?.status === "failed_payment") {
      await enqueueJubelioRelease(operation.orderId);
    }
  }
  return true;
}

async function markReserveRejected(
  operation: typeof jubelioStockOperations.$inferSelect,
  message: string
): Promise<void> {
  await db.transaction(async (tx) => {
    const orderRows = await tx
      .select({ branchId: orders.branchId })
      .from(orders)
      .where(eq(orders.id, operation.orderId))
      .limit(1);
    const branchId = orderRows[0]?.branchId;
    if (branchId) {
      for (const item of operation.payload.items) {
        await tx
          .update(branchStocks)
          .set({
            pendingRemoteStock: sql`GREATEST(0, ${branchStocks.pendingRemoteStock} - ${item.quantity})`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(branchStocks.branchId, branchId),
              eq(branchStocks.productVariantId, item.variantId)
            )
          );
      }
    }
    await tx
      .update(jubelioStockOperations)
      .set({ status: "failed", lastError: message, updatedAt: new Date() })
      .where(eq(jubelioStockOperations.id, operation.id));
    await tx
      .update(orders)
      .set({
        status: "failed_payment",
        paymentStatus: "failed",
        paymentFailureReason: message,
        midtransFailureStatus: "stock_reservation_failed",
        updatedAt: new Date(),
      })
      .where(
        and(eq(orders.id, operation.orderId), eq(orders.status, "pending_payment"))
      );
  });
}

export async function applyJubelioStockOperation(
  operationId: string,
  gateway?: JubelioStockGateway,
  logger?: Logger
): Promise<StockAdjustmentOutcome | { status: "skipped" }> {
  const rows = await db
    .select()
    .from(jubelioStockOperations)
    .where(eq(jubelioStockOperations.id, operationId))
    .limit(1);
  if (rows.length === 0) {
    logger?.warn("Jubelio stock operation not found", { operationId });
    return { status: "skipped" };
  }
  const operation = rows[0];
  const log = (logger ?? createLogger({ module: "jubelio-stock" })).child({
    orderId: operation.orderId,
    operationId,
    kind: operation.type,
    attemptCount: operation.attemptCount,
  });
  if (["applied", "committed", "failed", "manual_review"].includes(operation.status)) {
    log.debug("Jubelio stock operation already terminal", { status: operation.status });
    return { status: "skipped" };
  }

  const orderRows = await db
    .select({ branchId: orders.branchId })
    .from(orders)
    .where(eq(orders.id, operation.orderId))
    .limit(1);
  const branchId = orderRows[0]?.branchId;
  if (!branchId) throw new Error(`Order ${operation.orderId} has no branch`);
  const currentStocks = await db
    .select({
      variantId: branchStocks.productVariantId,
      stock: branchStocks.stock,
    })
    .from(branchStocks)
    .where(
      and(
        eq(branchStocks.branchId, branchId),
        inArray(
          branchStocks.productVariantId,
          operation.payload.items.map((item) => item.variantId)
        )
      )
    );
  const currentByVariant = new Map(
    currentStocks.map((stock) => [stock.variantId, stock.stock])
  );

  const claimed = await db
    .update(jubelioStockOperations)
    .set({
      status: "in_flight",
      attemptCount: sql`${jubelioStockOperations.attemptCount} + 1`,
      nextAttemptAt: new Date(Date.now() + 60_000),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(jubelioStockOperations.id, operation.id),
        eq(jubelioStockOperations.status, "pending")
      )
    )
    .returning({ id: jubelioStockOperations.id });
  if (claimed.length === 0) {
    log.debug("Jubelio stock operation claim lost", { status: operation.status });
    return { status: "skipped" };
  }
  log.info("Jubelio stock operation claimed", { itemCount: operation.payload.items.length });

  let outcome: StockAdjustmentOutcome;
  try {
    outcome = await runStockAdjustment(
      {
        kind: operation.type as "reserve" | "release",
        orderId: operation.orderId,
        operationId: operation.id,
        locationId: operation.payload.locationId,
        items: operation.payload.items.map((item) => ({
          itemId: item.itemId,
          quantity: item.quantity,
          description: item.description,
          observedStock: currentByVariant.get(item.variantId) ?? 0,
        })),
      },
      gateway ?? createJubelioStockGateway(),
      log
    );
  } catch (error) {
    // Runtime safety/configuration errors happen before an HTTP adjustment can
    // be sent, so they are definitive failures rather than ambiguous writes.
    outcome = {
      status: "rejected",
      message:
        error instanceof Error ? error.message : "Jubelio gateway is unavailable",
    };
  }

  if (outcome.status === "applied") {
    const applied = await markApplied(operation, outcome.adjustmentId, outcome.stocks);
    log.info("Jubelio stock operation applied locally", {
      adjustmentId: outcome.adjustmentId,
      localStateUpdated: applied,
    });
  } else if (outcome.status === "rejected" && operation.type === "reserve") {
    await markReserveRejected(operation, outcome.message);
    log.warn("Jubelio reserve rejected and local hold released", { message: outcome.message });
  } else {
    await db
      .update(jubelioStockOperations)
      .set({
        status: operation.type === "release" && outcome.status === "rejected"
          ? "manual_review"
          : "reconciling",
        lastError: outcome.message,
        nextAttemptAt: retryAt(operation.attemptCount + 1),
        updatedAt: new Date(),
      })
      .where(eq(jubelioStockOperations.id, operation.id));
    log.warn("Jubelio stock operation deferred", {
      status: outcome.status,
      nextAttemptAt: retryAt(operation.attemptCount + 1).toISOString(),
      message: outcome.message,
    });
  }
  return outcome;
}

export async function failOrderWithAmbiguousReserve(
  orderId: string,
  message: string,
  logger?: Logger
): Promise<void> {
  await db
    .update(orders)
    .set({
      status: "failed_payment",
      paymentStatus: "failed",
      paymentFailureReason: message,
      midtransFailureStatus: "stock_confirmation_pending",
      updatedAt: new Date(),
    })
    .where(and(eq(orders.id, orderId), eq(orders.status, "pending_payment")));
  logger?.warn("order failed closed while Jubelio reserve is ambiguous", { message });
}

export async function reconcileJubelioStockOperations(
  limit = 50,
  gateway: JubelioStockGateway = createJubelioStockGateway(),
  logger: Logger = createLogger({ module: "jubelio-stock-reconcile" })
): Promise<{ scanned: number; applied: number; failed: number; pending: number }> {
  const pendingRows = await db
    .select()
    .from(jubelioStockOperations)
    .where(
      and(
        inArray(jubelioStockOperations.status, [
          "pending",
          "reconciling",
          "in_flight",
        ]),
        lte(jubelioStockOperations.nextAttemptAt, new Date())
      )
    )
    .limit(limit);
  let applied = 0;
  let failed = 0;
  let pending = 0;

  for (const operation of pendingRows) {
    const log = logger.child({
      orderId: operation.orderId,
      operationId: operation.id,
      kind: operation.type,
      status: operation.status,
      attemptCount: operation.attemptCount,
    });
    log.info("Jubelio stock operation reconciliation started");
    if (operation.status === "pending") {
      const outcome = await applyJubelioStockOperation(operation.id, gateway, log);
      if (outcome.status === "applied") applied++;
      else if (outcome.status === "rejected") failed++;
      else pending++;
      continue;
    }

    const adjustmentId = await gateway.findAdjustmentByNote(operation.note);
    if (adjustmentId != null) {
      const stocks = await gateway.getStocks(
        operation.payload.locationId,
        operation.payload.items.map((item) => item.itemId)
      );
      if (await markApplied(operation, adjustmentId, stocks)) applied++;
      log.info("Jubelio stock operation reconciled from remote adjustment", {
        adjustmentId,
      });
      continue;
    }

    if (operation.attemptCount >= 3 && operation.type === "reserve") {
      await markReserveRejected(
        operation,
        "Jubelio stock adjustment could not be confirmed"
      );
      failed++;
    } else if (operation.attemptCount >= 5 && operation.type === "release") {
      await db
        .update(jubelioStockOperations)
        .set({
          status: "manual_review",
          lastError: "Jubelio stock release could not be confirmed",
          updatedAt: new Date(),
        })
        .where(eq(jubelioStockOperations.id, operation.id));
      failed++;
    } else {
      await db
        .update(jubelioStockOperations)
        .set({
          nextAttemptAt: retryAt(operation.attemptCount + 1),
          attemptCount: sql`${jubelioStockOperations.attemptCount} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(jubelioStockOperations.id, operation.id));
      pending++;
    }
  }

  logger.info("Jubelio stock reconciliation completed", {
    scanned: pendingRows.length,
    applied,
    failed,
    pending,
  });
  return { scanned: pendingRows.length, applied, failed, pending };
}

export function createReserveOperationValues(input: {
  operationId: string;
  orderId: string;
  locationId: number;
  items: JubelioStockOperationPayload["items"];
}) {
  return {
    id: input.operationId,
    orderId: input.orderId,
    type: "reserve",
    status: "pending",
    note: `OKCIR_RESERVE:${input.orderId}:${input.operationId}`,
    payload: { locationId: input.locationId, items: input.items },
  } as const;
}

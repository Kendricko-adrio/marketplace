import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db, clients, branches, branchStocks, cartItems, carts, addresses, productVariants, variantPriceCurrent, variantPriceRevisions,
  checkoutAttempts, checkoutRequests, discountRedemptions, jubelioSalesOperations, orderItems, orders } from "@/db";
import { recordJubelioSalesIntent } from "@/lib/jubelio-sales-operations";
import { findRedemptionForOrder, lockRedemptionOwners, releaseReservedRedemption } from "@/lib/discount-lifecycle";
import { insertRedemptionReservation, lockAndEvaluateOfferReservation, writeOrderDiscountAllocations } from "@/lib/discount-reservation";
import { projectMarkdownPrice } from "@marketplace/db/src/markdown-pricing";
import { validatePickupSlot } from "@/lib/pickup-validation";
import { createModuleLogger } from "@/lib/logger";
import { presentCheckoutAttempt, CheckoutAttemptReservationError, type ReserveCheckoutAttemptInput,
  type CheckoutFailureCode, type CheckoutAttemptResult, type CheckoutAttemptSnapshot, type CheckoutPaymentOutcome } from "./checkout-attempt";

const log = createModuleLogger("checkout-attempt-repository");
export type ReadDatabase = Pick<typeof db, "select">;
export type WriteDatabase = Pick<typeof db, "transaction">;
type AttemptTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type CheckoutPaymentClaim =
  | { claimed: false; reason: "not_ready" | "already_dispatched" }
  | { claimed: true; attemptId: string; reference: string; snapshot: CheckoutAttemptSnapshot; paymentStartedAt: Date; expiresAt: Date };

/** All mutators share owner → attempt lock order; no HTTP while these locks are held. */
async function lockCheckoutAttempt(tx: AttemptTx, attemptId: string) {
  await tx.execute(sql`SET LOCAL lock_timeout = '2s'`);
  await tx.execute(sql`SET LOCAL statement_timeout = '5s'`);
  const [identity] = await tx.select({ clientId: checkoutAttempts.clientId }).from(checkoutAttempts)
    .where(eq(checkoutAttempts.id, attemptId)).limit(1);
  if (!identity) return null;
  await tx.select({ id: clients.id }).from(clients).where(eq(clients.id, identity.clientId)).for("update");
  const [attempt] = await tx.select().from(checkoutAttempts).where(eq(checkoutAttempts.id, attemptId)).for("update");
  return attempt ?? null;
}

/** Read-only, owner-scoped recovery. Unpromoted attempts do not need an order. */
export async function readOwnedCheckoutAttempt(
  input: { clientId: string; requestKey: string },
  database?: ReadDatabase,
): Promise<CheckoutAttemptResult | null> {
  try {
    const [row] = await (database ?? db).select({
      id: checkoutAttempts.id,
      requestKey: checkoutAttempts.requestKey,
      state: checkoutAttempts.state,
      orderId: checkoutAttempts.orderId,
      failureCode: checkoutAttempts.failureCode,
      expiresAt: checkoutAttempts.expiresAt,
      paymentStatus: orders.paymentStatus,
      orderStatus: orders.status,
      redirectUrl: orders.snapRedirectUrl,
    }).from(checkoutAttempts)
      .leftJoin(orders, and(eq(orders.id, checkoutAttempts.orderId), eq(orders.userId, checkoutAttempts.clientId)))
      .where(and(eq(checkoutAttempts.clientId, input.clientId), eq(checkoutAttempts.requestKey, input.requestKey))).limit(1);
    if (!row) return null;
    const result = presentCheckoutAttempt(row, new Date());
    log.info(`Checkout attempt ${row.id}: owned status read (${result.state})`);
    return result;
  } catch {
    log.error("Checkout attempt owned status lookup unavailable", new Error("Checkout attempt persistence unavailable"));
    throw new Error("Checkout attempt status unavailable");
  }
}

/** Identity-only lookup used to answer a replay before any new availability check. */
export async function findCheckoutAttemptIdentity(
  input: { clientId: string; requestKey: string },
  database: ReadDatabase = db,
): Promise<{ attemptId: string; fingerprint: string } | null> {
  const [row] = await database.select({ attemptId: checkoutAttempts.id, fingerprint: checkoutAttempts.fingerprint })
    .from(checkoutAttempts)
    .where(and(eq(checkoutAttempts.clientId, input.clientId), eq(checkoutAttempts.requestKey, input.requestKey)))
    .limit(1);
  return row ?? null;
}

/** Progress flags needed to decide the next safe step without loading snapshots. */
export async function readCheckoutAttemptProgress(
  input: { clientId: string; requestKey: string },
  database: ReadDatabase = db,
): Promise<{ state: string; paymentState: string; stockHoldState: string } | null> {
  const [row] = await database.select({ state: checkoutAttempts.state, paymentState: checkoutAttempts.paymentState,
    stockHoldState: checkoutAttempts.stockHoldState }).from(checkoutAttempts)
    .where(and(eq(checkoutAttempts.clientId, input.clientId), eq(checkoutAttempts.requestKey, input.requestKey))).limit(1);
  return row ?? null;
}

/** Full row needed to continue an unresolved placement without re-reserving. */
export async function loadResumableCheckoutAttempt(
  input: { clientId: string; requestKey: string },
  database: ReadDatabase = db,
): Promise<{ attemptId: string; clientId: string; requestKey: string; snapshot: CheckoutAttemptSnapshot;
  paymentStartedAt: Date; expiresAt: Date } | null> {
  const [row] = await database.select({ attemptId: checkoutAttempts.id, clientId: checkoutAttempts.clientId,
    requestKey: checkoutAttempts.requestKey, snapshot: checkoutAttempts.snapshot,
    paymentStartedAt: checkoutAttempts.paymentStartedAt, expiresAt: checkoutAttempts.expiresAt })
    .from(checkoutAttempts)
    .where(and(eq(checkoutAttempts.clientId, input.clientId), eq(checkoutAttempts.requestKey, input.requestKey),
      sql`${checkoutAttempts.state} IN ('preparing','processing')`)).limit(1);
  return row ?? null;
}

/** Durable permission to initialize payment at most once, after verified SO accounting. */
export async function claimCheckoutPayment(
  input: { attemptId: string; now?: Date }, database: WriteDatabase = db,
): Promise<CheckoutPaymentClaim> {
  const now = input.now ?? new Date();
  try {
    const result = await database.transaction(async (tx): Promise<CheckoutPaymentClaim> => {
      const attempt = await lockCheckoutAttempt(tx, input.attemptId);
      if (!attempt || attempt.state !== "preparing" || attempt.stockHoldState !== "mirrored" ||
        attempt.expiresAt.getTime() <= now.getTime()) return { claimed: false, reason: "not_ready" };
      if (attempt.paymentState !== "none" && attempt.paymentState !== "intent") {
        return { claimed: false, reason: "already_dispatched" };
      }
      const [create] = await tx.select().from(jubelioSalesOperations).where(and(
        eq(jubelioSalesOperations.checkoutAttemptId, attempt.id), eq(jubelioSalesOperations.type, "create"),
      )).limit(1);
      if (create?.status !== "confirmed" || create.salesOrderId == null || !create.holdAccountedAt) {
        return { claimed: false, reason: "not_ready" };
      }
      await tx.update(checkoutAttempts).set({ paymentState: "dispatched_unknown",
        paymentDispatchedAt: now, updatedAt: now }).where(eq(checkoutAttempts.id, attempt.id));
      return { claimed: true, attemptId: attempt.id, reference: attempt.reservedOrderId,
        snapshot: attempt.snapshot, paymentStartedAt: attempt.paymentStartedAt, expiresAt: attempt.expiresAt };
    });
    if (result.claimed) log.info(`Checkout attempt ${input.attemptId}: payment dispatch claimed`);
    return result;
  } catch {
    log.error("Checkout payment claim unavailable", new Error("Checkout payment claim persistence unavailable"));
    throw new Error("Checkout payment claim unavailable");
  }
}

/** Persist external evidence, never equate an exception or lost response with rejection. */
export async function recordCheckoutPaymentEvidence(
  input: { attemptId: string; outcome: CheckoutPaymentOutcome }, database: WriteDatabase = db,
): Promise<void> {
  try {
    await database.transaction(async (tx) => {
      const attempt = await lockCheckoutAttempt(tx, input.attemptId);
      if (!attempt) throw new Error("Checkout payment evidence has no attempt");
      const outcome = input.outcome;
      if (attempt.paymentState === "ready" && outcome.kind === "ready" &&
        attempt.paymentToken === outcome.token && attempt.paymentRedirectUrl === outcome.redirectUrl) return;
      if (attempt.paymentState === "manual_review" && outcome.kind === "unknown") return;
      if (attempt.paymentState === "rejected" && outcome.kind === "definitive_rejection") return;
      if (attempt.paymentState !== "dispatched_unknown" || attempt.state !== "preparing") {
        throw new Error("Checkout payment evidence conflict");
      }
      if (outcome.kind === "ready") {
        if (!outcome.token.trim() || !outcome.redirectUrl.trim()) throw new Error("Checkout payment session incomplete");
        await tx.update(checkoutAttempts).set({ paymentState: "ready", paymentToken: outcome.token,
          paymentRedirectUrl: outcome.redirectUrl, state: "processing", updatedAt: new Date() })
          .where(eq(checkoutAttempts.id, attempt.id));
      } else {
        await tx.update(checkoutAttempts).set({
          paymentState: outcome.kind === "unknown" ? "manual_review" : "rejected",
          state: outcome.kind === "unknown" ? "manual_review" : "compensating", updatedAt: new Date(),
        }).where(eq(checkoutAttempts.id, attempt.id));
      }
    });
    log.info(`Checkout attempt ${input.attemptId}: payment evidence recorded (${input.outcome.kind})`);
  } catch (error) {
    log.error("Checkout payment evidence persistence unavailable", new Error("Checkout payment evidence unavailable"));
    if (error instanceof Error && ["Checkout payment evidence conflict", "Checkout payment session incomplete"].includes(error.message)) throw error;
    throw new Error("Checkout payment evidence unavailable");
  }
}

/** Commit reservation, approved snapshot and SO intent together, never an order. */
export async function reserveCheckoutAttempt(
  input: ReserveCheckoutAttemptInput, database: WriteDatabase = db,
): Promise<{ attemptId: string; created: boolean }> {
  const now = input.now ?? new Date();
  const reviewRequired = () => { throw new CheckoutAttemptReservationError("CHECKOUT_REVIEW_REQUIRED"); };
  try {
    const result = await database.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL lock_timeout = '2s'`);
      await tx.execute(sql`SET LOCAL statement_timeout = '5s'`);
      const [client] = await tx.select().from(clients).where(eq(clients.id, input.clientId)).for("update");
      if (!client) return reviewRequired();
      const [existing] = await tx.select().from(checkoutAttempts).where(and(
        eq(checkoutAttempts.clientId, input.clientId), eq(checkoutAttempts.requestKey, input.requestKey),
      )).limit(1);
      if (existing) {
        if (existing.fingerprint !== input.fingerprint) throw new CheckoutAttemptReservationError("REQUEST_KEY_CONFLICT");
        return { attemptId: existing.id, created: false };
      }
      const [legacyReceipt] = await tx.select({ id: checkoutRequests.id }).from(checkoutRequests).where(and(
        eq(checkoutRequests.clientId, input.clientId), eq(checkoutRequests.requestKey, input.requestKey),
      )).limit(1);
      if (legacyReceipt) throw new CheckoutAttemptReservationError("REQUEST_KEY_CONFLICT");
      const [active] = await tx.select({ requestKey: checkoutAttempts.requestKey }).from(checkoutAttempts)
        .where(and(eq(checkoutAttempts.clientId, input.clientId), sql`${checkoutAttempts.state} NOT IN ('rejected','promoted')`)).limit(1);
      if (active) throw new CheckoutAttemptReservationError("CHECKOUT_ATTEMPT_IN_PROGRESS", active.requestKey);
      if (input.expiresAt <= now || input.snapshot.order.branchId !== input.branchId || input.snapshot.items.length === 0 ||
        input.snapshot.items.length !== input.snapshot.cart.length ||
        new Set(input.snapshot.items.map((item) => item.variantId)).size !== input.snapshot.items.length) return reviewRequired();
      const pricing = input.snapshot.order.pricingSnapshot;
      if (input.offerCandidate) {
        if (!pricing || pricing.pricingContractVersion !== 1) return reviewRequired();
        const decision = await lockAndEvaluateOfferReservation(tx, { clientId: input.clientId,
          verifiedEmail: client.emailVerified, candidate: input.offerCandidate, subtotalAfterMarkdown: pricing.subtotal,
          fulfillmentMethod: pricing.fulfillmentMethod, shippingBeforeSubsidy: pricing.shippingBeforeSubsidy });
        if (!decision.ok) return reviewRequired();
      } else if (pricing && (Number(pricing.goodsDiscount) > 0 || Number(pricing.shippingSubsidy) > 0)) return reviewRequired();
      const lines = [...input.snapshot.items].sort((a, b) => a.variantId.localeCompare(b.variantId));
      const variants = await tx.select().from(productVariants).where(inArray(productVariants.id, lines.map((line) => line.variantId)))
        .orderBy(asc(productVariants.id)).for("update");
      const markdowns = await tx.select({ variantId: variantPriceCurrent.variantId, revisionId: variantPriceRevisions.id,
        targetUnitPrice: variantPriceRevisions.targetUnitPrice }).from(variantPriceCurrent)
        .innerJoin(variantPriceRevisions, and(eq(variantPriceRevisions.id, variantPriceCurrent.revisionId),
          eq(variantPriceRevisions.variantId, variantPriceCurrent.variantId)))
        .where(inArray(variantPriceCurrent.variantId, lines.map((line) => line.variantId)))
        .orderBy(asc(variantPriceCurrent.variantId)).for("update");
      const [branch] = await tx.select().from(branches).where(eq(branches.id, input.branchId)).for("share");
      if (!branch || branch.status !== "aktif" || branch.jubelioLocationId !== input.snapshot.createRequest.locationId) return reviewRequired();
      const order = input.snapshot.order;
      if (order.fulfillmentMethod !== "delivery") {
        if (!order.pickupDate || !order.pickupTime) return reviewRequired();
        const pickupDay = new Date(new Date(order.pickupDate).getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
        if (!validatePickupSlot(branch.operatingHours, pickupDay, order.pickupTime, now).ok) return reviewRequired();
      } else {
        const origin = order.deliverySnapshot?.origin;
        if (!origin || branch.id !== origin.branchId || branch.name !== origin.name || branch.shippingPhone !== origin.phone ||
          branch.shippingAddress !== origin.address || branch.shippingPostalCode !== origin.zipcode || branch.shippingAreaId !== origin.areaId) return reviewRequired();
        if (order.addressId && !input.snapshot.addressToSave) {
          const [address] = await tx.select().from(addresses).where(and(eq(addresses.id, order.addressId), eq(addresses.userId, client.id))).for("share");
          const approved = order.deliverySnapshot?.address;
          if (!address || !approved || address.firstName !== approved.recipientName || address.phone !== approved.phone ||
            address.fullAddress !== approved.fullAddress || address.areaId !== approved.areaId || address.postalCode !== approved.postalCode) return reviewRequired();
        }
      }
      const selectedCart = await tx.select({ item: cartItems, ownerId: carts.userId }).from(cartItems)
        .innerJoin(carts, eq(carts.id, cartItems.cartId))
        .where(inArray(cartItems.id, input.snapshot.cart.map((item) => item.itemId)))
        .orderBy(asc(cartItems.id)).for("update");
      for (const line of lines) {
        const variant = variants.find((row) => row.id === line.variantId);
        const cart = input.snapshot.cart.find((row) => row.variantId === line.variantId);
        const selected = selectedCart.find((row) => row.item.id === cart?.itemId);
        const remote = input.snapshot.createRequest.items.find((row) => row.itemId === variant?.jubelioItemId);
        if (!variant || !cart || !selected || selected.ownerId !== client.id || selected.item.cartId !== cart.cartId ||
          selected.item.variantId !== line.variantId || selected.item.branchId !== input.branchId || cart.branchId !== input.branchId ||
          line.quantity !== cart.quantity || selected.item.quantity !== line.quantity ||
          selected.item.updatedAt.getTime() !== new Date(cart.updatedAt).getTime() ||
          !remote || remote.quantity !== line.quantity || remote.price !== Number(variant.price)) return reviewRequired();
        const markdown = markdowns.find((row) => row.variantId === line.variantId);
        const effective = projectMarkdownPrice({ sourceUnitPrice: variant.price,
          storedTargetUnitPrice: markdown?.targetUnitPrice ?? null, markdownRevisionId: markdown?.revisionId ?? null });
        if (Number(effective.effectiveUnitPrice) !== Number(line.price) || effective.markdownRevisionId !== (line.markdownRevisionId ?? null)) return reviewRequired();
      }
      await tx.insert(checkoutAttempts).values({ id: input.attemptId, clientId: client.id, branchId: input.branchId,
        requestKey: input.requestKey, fingerprint: input.fingerprint, reservedOrderId: input.reservedOrderId,
        snapshot: input.snapshot, paymentStartedAt: input.paymentStartedAt, expiresAt: input.expiresAt, createdAt: now, updatedAt: now });
      if (input.offerCandidate && pricing) {
        await insertRedemptionReservation(tx, { owner: { kind: "attempt", attemptId: input.attemptId }, clientId: client.id,
          candidate: input.offerCandidate, deadline: input.expiresAt, pricing });
      }
      for (const line of lines) {
        const [held] = await tx.update(branchStocks).set({ pendingRemoteStock: sql`${branchStocks.pendingRemoteStock} + ${line.quantity}`, updatedAt: now })
          .where(and(eq(branchStocks.branchId, input.branchId), eq(branchStocks.productVariantId, line.variantId),
            eq(branchStocks.providerStockSyncedAt, input.stockObservedAt),
            sql`COALESCE(${branchStocks.availableStock}, 0) - ${branchStocks.pendingRemoteStock} >= ${line.quantity}`))
          .returning({ branchId: branchStocks.branchId });
        if (!held) return reviewRequired();
      }
      await recordJubelioSalesIntent(tx as unknown as Parameters<typeof recordJubelioSalesIntent>[0], { owner: { kind: "attempt", attemptId: input.attemptId }, type: "create",
        reference: input.snapshot.createRequest.note, payload: { type: "create", create: input.snapshot.createRequest } });
      return { attemptId: input.attemptId, created: true };
    });
    log.info(`Checkout attempt ${result.attemptId}: reservation retained (new ${result.created})`);
    return result;
  } catch (error) {
    // Same-key concurrency may surface the owner-key unique index instead of the
    // pre-read; that is a replay, never a different checkout.
    if (error && typeof error === "object" && "cause" in error &&
      (error.cause as { code?: string })?.code === "23505") {
      const [existing] = await db.select({ id: checkoutAttempts.id, fingerprint: checkoutAttempts.fingerprint })
        .from(checkoutAttempts)
        .where(and(eq(checkoutAttempts.clientId, input.clientId), eq(checkoutAttempts.requestKey, input.requestKey))).limit(1);
      if (existing) {
        if (existing.fingerprint !== input.fingerprint) throw new CheckoutAttemptReservationError("REQUEST_KEY_CONFLICT");
        return { attemptId: existing.id, created: false };
      }
    }
    log.error("Checkout attempt reservation failed", new Error("Checkout attempt reservation unavailable"));
    if (error instanceof CheckoutAttemptReservationError) throw error;
    throw new Error("Checkout attempt reservation unavailable");
  }
}

/** Definitive unpaid failure only: release capacity and mark rejected in one commit. */
export async function finalizeRejectedCheckoutAttempt(
  input: { attemptId: string; reason: CheckoutFailureCode }, database: WriteDatabase = db,
): Promise<void> {
  try {
    await database.transaction(async (tx) => {
      const attempt = await lockCheckoutAttempt(tx, input.attemptId);
      if (!attempt) throw new Error("Checkout rejection has no attempt");
      if (attempt.state === "rejected" && attempt.failureCode === input.reason) return;
      const owner = { kind: "attempt" as const, attemptId: attempt.id };
      const redemption = await findRedemptionForOrder(owner, tx);
      if (redemption) await lockRedemptionOwners(tx, redemption);
      const operations = await tx.select().from(jubelioSalesOperations).where(eq(jubelioSalesOperations.checkoutAttemptId, attempt.id));
      const create = operations.find((op) => op.type === "create");
      void operations;
      const rejectedCreate = input.reason === "SALES_ORDER_REJECTED" && attempt.paymentState === "none" &&
        create?.status === "rejected" && create.salesOrderId === null && attempt.stockHoldState === "held";
      if (attempt.orderId || !rejectedCreate) throw new Error("Checkout rejection lacks definitive provider evidence");
      const now = new Date();
      for (const line of [...attempt.snapshot.items].sort((a,b) => a.variantId.localeCompare(b.variantId))) {
        const [released] = await tx.update(branchStocks).set({ pendingRemoteStock: sql`${branchStocks.pendingRemoteStock} - ${line.quantity}`, updatedAt: now })
          .where(and(eq(branchStocks.branchId, attempt.branchId), eq(branchStocks.productVariantId, line.variantId),
            sql`${branchStocks.pendingRemoteStock} >= ${line.quantity}`)).returning({ branchId: branchStocks.branchId });
        if (!released) throw new Error("Checkout stock hold accounting unavailable");
      }
      if (redemption) await releaseReservedRedemption(tx, { owner, identity: redemption,
        source: "sales-order-rejected", reason: "Definitive unpaid checkout failure" });
      await tx.update(jubelioSalesOperations).set({ holdAccountedAt: now, updatedAt: now }).where(eq(jubelioSalesOperations.id, create.id));
      await tx.update(checkoutAttempts).set({ state: "rejected", failureCode: input.reason, stockHoldState: "released", updatedAt: now })
        .where(eq(checkoutAttempts.id, attempt.id));
    });
    log.info(`Checkout attempt ${input.attemptId}: definitive rejection accounted (${input.reason})`);
  } catch (error) {
    log.error("Checkout rejection accounting unavailable", new Error("Checkout attempt release unavailable"));
    if (error instanceof Error && error.message === "Checkout rejection lacks definitive provider evidence") throw error;
    throw new Error("Checkout rejection accounting unavailable");
  }
}

/** Confirmed SO create: pending hold becomes consumed stock, exactly once. */
export async function accountConfirmedAttemptCreateHold(
  attemptId: string, database: WriteDatabase = db,
): Promise<void> {
  try {
    await database.transaction(async (tx) => {
      const attempt = await lockCheckoutAttempt(tx, attemptId);
      if (!attempt) throw new Error("Confirmed SO accounting has no checkout attempt");
      if (attempt.stockHoldState === "mirrored") return;
      if (attempt.state !== "preparing" || attempt.stockHoldState !== "held" || attempt.orderId) {
        throw new Error("Confirmed SO accounting is not applicable to this checkout attempt");
      }
      const [create] = await tx.select().from(jubelioSalesOperations).where(and(
        eq(jubelioSalesOperations.checkoutAttemptId, attempt.id), eq(jubelioSalesOperations.type, "create"),
      )).for("update");
      if (create?.status !== "confirmed" || create.salesOrderId == null || create.holdAccountedAt) {
        throw new Error("Confirmed SO accounting lacks a confirmed operation");
      }
      const now = new Date();
      for (const line of [...attempt.snapshot.items].sort((a,b) => a.variantId.localeCompare(b.variantId))) {
        const [stock] = await tx.update(branchStocks).set({
          pendingRemoteStock: sql`GREATEST(0, ${branchStocks.pendingRemoteStock} - ${line.quantity})`,
          availableStock: sql`GREATEST(COALESCE(${branchStocks.availableStock}, 0) - ${line.quantity}, 0)`, updatedAt: now,
        }).where(and(eq(branchStocks.branchId, attempt.branchId), eq(branchStocks.productVariantId, line.variantId)))
          .returning({ branchId: branchStocks.branchId });
        if (!stock) throw new Error("Confirmed SO accounting is missing a stock row");
      }
      await tx.update(jubelioSalesOperations).set({ holdAccountedAt: now, updatedAt: now })
        .where(eq(jubelioSalesOperations.id, create.id));
      await tx.update(checkoutAttempts).set({ stockHoldState: "mirrored", updatedAt: now }).where(eq(checkoutAttempts.id, attempt.id));
    });
    log.info(`Checkout attempt ${attemptId}: confirmed SO hold accounted`);
  } catch {
    log.error("Confirmed SO attempt accounting unavailable", new Error("Checkout attempt stock accounting unavailable"));
    throw new Error("Checkout attempt stock accounting unavailable");
  }
}

/** Confirmed pre-session SO cancel: restore stock and release promo exactly once. */
export async function accountConfirmedAttemptCancelHold(
  attemptId: string, database: WriteDatabase = db,
): Promise<void> {
  try {
    await database.transaction(async (tx) => {
      const attempt = await lockCheckoutAttempt(tx, attemptId);
      if (!attempt) throw new Error("Confirmed cancel accounting has no checkout attempt");
      if (attempt.state === "rejected" && attempt.failureCode === "PAYMENT_INITIALIZATION_REJECTED") return;
      if (attempt.state !== "compensating" || attempt.paymentState !== "rejected" ||
        attempt.stockHoldState !== "mirrored" || attempt.orderId) throw new Error("Confirmed cancel accounting is not applicable");
      const owner = { kind: "attempt" as const, attemptId: attempt.id };
      const redemption = await findRedemptionForOrder(owner, tx);
      if (redemption) await lockRedemptionOwners(tx, redemption);
      const operations = await tx.select().from(jubelioSalesOperations).where(eq(jubelioSalesOperations.checkoutAttemptId, attempt.id));
      const create = operations.find((operation) => operation.type === "create");
      const cancel = operations.find((operation) => operation.type === "cancel");
      if (create?.status !== "confirmed" || cancel?.status !== "confirmed" || cancel.holdAccountedAt) {
        throw new Error("Confirmed cancel accounting lacks a confirmed cancel operation");
      }
      const now = new Date();
      for (const line of [...attempt.snapshot.items].sort((a,b) => a.variantId.localeCompare(b.variantId))) {
        const [stock] = await tx.update(branchStocks).set({
          availableStock: sql`COALESCE(${branchStocks.availableStock}, 0) + ${line.quantity}`, updatedAt: now,
        }).where(and(eq(branchStocks.branchId, attempt.branchId), eq(branchStocks.productVariantId, line.variantId)))
          .returning({ branchId: branchStocks.branchId });
        if (!stock) throw new Error("Confirmed cancel accounting is missing a stock row");
      }
      if (redemption) await releaseReservedRedemption(tx, { owner, identity: redemption,
        source: "jubelio-cancel", reason: "Confirmed pre-session Sales Order cancel" });
      await tx.update(jubelioSalesOperations).set({ holdAccountedAt: now, updatedAt: now }).where(eq(jubelioSalesOperations.id, cancel.id));
      await tx.update(checkoutAttempts).set({ state: "rejected", failureCode: "PAYMENT_INITIALIZATION_REJECTED",
        stockHoldState: "released", updatedAt: now }).where(eq(checkoutAttempts.id, attempt.id));
    });
    log.info(`Checkout attempt ${attemptId}: confirmed cancel accounted`);
  } catch {
    log.error("Confirmed cancel attempt accounting unavailable", new Error("Checkout attempt cancel accounting unavailable"));
    throw new Error("Checkout attempt cancel accounting unavailable");
  }
}

/** Expired attempt whose SO create was never sent: abort intent, release once. */
export async function finalizeExpiredCheckoutAttempt(
  input: { attemptId: string; now?: Date }, database: WriteDatabase = db,
): Promise<void> {
  const now = input.now ?? new Date();
  try {
    await database.transaction(async (tx) => {
      const attempt = await lockCheckoutAttempt(tx, input.attemptId);
      if (!attempt) return;
      if (attempt.state === "rejected" && attempt.failureCode === "CHECKOUT_EXPIRED") return;
      if (attempt.orderId || attempt.state !== "preparing" || attempt.stockHoldState !== "held" ||
        attempt.paymentState !== "none" || attempt.expiresAt.getTime() > now.getTime()) {
        throw new Error("Checkout expiry is not applicable");
      }
      const owner = { kind: "attempt" as const, attemptId: attempt.id };
      const redemption = await findRedemptionForOrder(owner, tx);
      if (redemption) await lockRedemptionOwners(tx, redemption);
      const [create] = await tx.select().from(jubelioSalesOperations).where(and(
        eq(jubelioSalesOperations.checkoutAttemptId, attempt.id), eq(jubelioSalesOperations.type, "create"),
      )).for("update");
      if (!create || create.status !== "intent" || create.dispatchedAt || create.salesOrderId != null) {
        throw new Error("Checkout expiry lacks a never-sent Sales Order intent");
      }
      for (const line of [...attempt.snapshot.items].sort((a,b) => a.variantId.localeCompare(b.variantId))) {
        const [released] = await tx.update(branchStocks).set({ pendingRemoteStock: sql`${branchStocks.pendingRemoteStock} - ${line.quantity}`, updatedAt: now })
          .where(and(eq(branchStocks.branchId, attempt.branchId), eq(branchStocks.productVariantId, line.variantId),
            sql`${branchStocks.pendingRemoteStock} >= ${line.quantity}`)).returning({ branchId: branchStocks.branchId });
        if (!released) throw new Error("Checkout stock hold accounting unavailable");
      }
      if (redemption) await releaseReservedRedemption(tx, { owner, identity: redemption,
        source: "checkout-expired", reason: "Checkout expired before any provider write" });
      await tx.update(jubelioSalesOperations).set({ status: "aborted", holdAccountedAt: now, updatedAt: now })
        .where(eq(jubelioSalesOperations.id, create.id));
      await tx.update(checkoutAttempts).set({ state: "rejected", failureCode: "CHECKOUT_EXPIRED",
        stockHoldState: "released", updatedAt: now }).where(eq(checkoutAttempts.id, attempt.id));
    });
    log.info(`Checkout attempt ${input.attemptId}: expired never-sent checkout released`);
  } catch {
    log.error("Checkout expiry accounting unavailable", new Error("Checkout attempt expiry unavailable"));
    throw new Error("Checkout attempt expiry unavailable");
  }
}

/** Unknown SO outcome is held for operator reconciliation, never retried. */
export async function markCheckoutAttemptForManualReview(
  input: { attemptId: string }, database: WriteDatabase = db,
): Promise<void> {
  try {
    await database.transaction(async (tx) => {
      const attempt = await lockCheckoutAttempt(tx, input.attemptId);
      if (!attempt || !["preparing", "compensating"].includes(attempt.state) || attempt.orderId) return;
      await tx.update(checkoutAttempts).set({ state: "manual_review", updatedAt: new Date() }).where(eq(checkoutAttempts.id, attempt.id));
    });
    log.warn(`Checkout attempt ${input.attemptId}: held for manual review`);
  } catch {
    log.error("Checkout manual review marker unavailable", new Error("Checkout attempt state unavailable"));
    throw new Error("Checkout attempt state unavailable");
  }
}

/** Local-only commit after external success; replay never creates a second order/session. */
export async function promoteCheckoutAttempt(
  input: { attemptId: string }, database: WriteDatabase = db,
): Promise<{ attemptId: string; orderId: string }> {
  try {
    const result = await database.transaction(async (tx) => {
      const attempt = await lockCheckoutAttempt(tx, input.attemptId);
      if (!attempt) throw new Error("Checkout promotion has no attempt");
      if (attempt.state === "promoted" && attempt.orderId) return { attemptId: attempt.id, orderId: attempt.orderId };
      if (attempt.state !== "processing" || attempt.paymentState !== "ready" || attempt.stockHoldState !== "mirrored" ||
        !attempt.paymentRedirectUrl || !attempt.paymentToken) throw new Error("Checkout promotion is not ready");
      const redemption = await findRedemptionForOrder({ kind: "attempt", attemptId: attempt.id }, tx);
      if (redemption) {
        await lockRedemptionOwners(tx, redemption);
        if (redemption.status !== "reserved") throw new Error("Checkout promotion reservation is not active");
      }
      const operations = await tx.select().from(jubelioSalesOperations).where(eq(jubelioSalesOperations.checkoutAttemptId, attempt.id));
      const create = operations.find((operation) => operation.type === "create");
      if (create?.status !== "confirmed" || create.salesOrderId == null || !create.holdAccountedAt ||
        operations.some((operation) => operation.type === "cancel")) throw new Error("Checkout promotion lacks confirmed Sales Order");
      const now = new Date();
      const { pickupDate, ...draft } = attempt.snapshot.order;
      let addressId = draft.addressId ?? null;
      if (attempt.snapshot.addressToSave) {
        addressId ??= `checkout:${attempt.id}`;
        const [prior] = await tx.select().from(addresses).where(eq(addresses.id, addressId)).limit(1);
        const requested = attempt.snapshot.addressToSave;
        if (prior) {
          if (prior.userId !== attempt.clientId || prior.firstName !== requested.firstName || prior.phone !== requested.phone ||
            prior.fullAddress !== requested.fullAddress || prior.areaId !== requested.areaId || prior.postalCode !== requested.postalCode) {
            throw new Error("Checkout saved address conflicts with the approved snapshot");
          }
        } else {
          if (requested.isDefault) await tx.update(addresses).set({ isDefault: false, updatedAt: now }).where(eq(addresses.userId, attempt.clientId));
          await tx.insert(addresses).values({ ...requested, id: addressId, userId: attempt.clientId, createdAt: now, updatedAt: now });
        }
      } else if (addressId) {
        const [existing] = await tx.select({ id: addresses.id }).from(addresses)
          .where(and(eq(addresses.id, addressId), eq(addresses.userId, attempt.clientId))).limit(1);
        if (!existing) addressId = null; // Equivalent to the existing address FK ON DELETE SET NULL.
      }
      await tx.insert(orders).values({ ...draft, id: attempt.reservedOrderId, userId: attempt.clientId,
        branchId: attempt.branchId, addressId, pickupDate: pickupDate ? new Date(pickupDate) : null,
        status: "pending_payment", paymentStatus: "pending", expiresAt: attempt.expiresAt,
        snapRedirectUrl: attempt.paymentRedirectUrl, jubelioSalesOrderId: create.salesOrderId,
        createdAt: now, updatedAt: now });
      for (const item of attempt.snapshot.items) await tx.insert(orderItems).values({ ...item, orderId: attempt.reservedOrderId });
      // Set the attempt pointer before attaching child composite FKs to that pointer.
      await tx.update(checkoutAttempts).set({ state: "promoted", orderId: attempt.reservedOrderId, updatedAt: now })
        .where(eq(checkoutAttempts.id, attempt.id));
      await tx.update(jubelioSalesOperations).set({ orderId: attempt.reservedOrderId, updatedAt: now })
        .where(eq(jubelioSalesOperations.checkoutAttemptId, attempt.id));
      const [promotedRedemption] = await tx.update(discountRedemptions).set({ orderId: attempt.reservedOrderId, updatedAt: now })
        .where(eq(discountRedemptions.checkoutAttemptId, attempt.id)).returning();
      const pricing = attempt.snapshot.order.pricingSnapshot;
      if (pricing) await writeOrderDiscountAllocations(tx, { orderId: attempt.reservedOrderId,
        orderItemIdByVariant: new Map(attempt.snapshot.items.map((item) => [item.variantId, item.id])), pricing,
        redemption: promotedRedemption ? { id: promotedRedemption.id, benefitId: promotedRedemption.benefitId } : null });
      await tx.insert(checkoutRequests).values({ id: crypto.randomUUID(), clientId: attempt.clientId,
        requestKey: attempt.requestKey, fingerprint: attempt.fingerprint, orderId: attempt.reservedOrderId,
        result: { version: 1, orderId: attempt.reservedOrderId } });
      for (const cart of attempt.snapshot.cart) {
        await tx.delete(cartItems).where(and(eq(cartItems.id, cart.itemId), eq(cartItems.cartId, cart.cartId),
          eq(cartItems.variantId, cart.variantId), eq(cartItems.branchId, cart.branchId), eq(cartItems.quantity, cart.quantity),
          // timestamptz keeps microseconds while JSON keeps milliseconds:
          // compare at millisecond precision, never delete a line changed since review.
          sql`date_trunc('milliseconds', ${cartItems.updatedAt}) = date_trunc('milliseconds', ${cart.updatedAt}::timestamptz)`));
      }
      return { attemptId: attempt.id, orderId: attempt.reservedOrderId };
    });
    log.info(`Checkout attempt ${result.attemptId}: promoted to order ${result.orderId}`);
    return result;
  } catch {
    log.error("Checkout promotion unavailable; retained provider evidence requires recovery", new Error("Checkout promotion persistence unavailable"));
    throw new Error("Checkout promotion unavailable");
  }
}

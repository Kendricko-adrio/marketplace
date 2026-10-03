import { isDeepStrictEqual } from "node:util";
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  jubelioSalesOperations,
  type JubelioSalesOperationPayload,
} from "@marketplace/db/src/schema";

/**
 * Durable Jubelio sales-order operation claim API (plan:
 * jubelio-sales-api-switching, Gate C.1 — the pre-agreed DB-backed operation
 * claim seam).
 *
 * This module is the ONLY sanctioned way to persist and dispatch a Jubelio
 * sales-order create/cancel write:
 *
 * 1. `recordJubelioSalesIntent` persists the intent (with the full request
 *    snapshot and unique `reference`) BEFORE any POST.
 * 2. `claimJubelioSalesOperationForDispatch` grants the single POST
 *    permission through ONE atomic conditional UPDATE
 *    `... WHERE id = ? AND status = 'intent' ... RETURNING` (the
 *    parent-verified Drizzle primitive; real concurrency semantics are proven
 *    by jubelio-sales-operations.db.test.ts against PostgreSQL). The winning
 *    caller owns exactly one POST; every other caller (replay, retry, crash
 *    recovery, duplicate cron) is refused because the operation is no longer
 *    in the claimable `intent` state — a claimed write is POSSIBLY SENT and
 *    must never be re-POSTed.
 * 3. After the gateway attempt, the caller records exactly one outcome:
 *    `confirmed` (independent GET verified, known SO id persisted),
 *    `rejected` (definitive pre-apply failure) or `manual_review`
 *    (ambiguous/unknown outcome). A create with an unknown returned id goes
 *    to `manual_review` with the intent retained — never a blind retry,
 *    never a false failure.
 * 4. `abortJubelioSalesOperation` abandons an operation ONLY while it is
 *    still a never-dispatched `intent`.
 *
 * The gateway (jubelio-sales-client.ts) stays a separate collaborator and is
 * always called OUTSIDE any DB transaction; this module never performs
 * remote I/O itself, makes no invoice/payment assumptions and has NO caller
 * in checkout/webhook/cron/admin paths yet (unwired by design — see the
 * implementation ledger in plan/jubelio-sales-api-switching.md).
 */

// Accept both the complete app DB schema and the focused test schema. These
// operations need only the SQL query builders; no relational query metadata.
export type JubelioSalesOperationsDb = Pick<
  NodePgDatabase,
  "select" | "insert" | "update"
>;

export type JubelioSalesOperationType =
  | "create"
  | "cancel"
  | "invoice"
  | "payment";

const OPERATION_TYPES: ReadonlySet<string> = new Set([
  "create",
  "cancel",
  "invoice",
  "payment",
]);

export type JubelioSalesOperation = typeof jubelioSalesOperations.$inferSelect;

export type ClaimJubelioSalesOperationResult =
  | { claimed: true; operation: JubelioSalesOperation }
  | { claimed: false; reason: "not_found" }
  | {
      claimed: false;
      reason: "not_dispatchable";
      operation: JubelioSalesOperation;
    };

function isSafePositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export async function recordJubelioSalesIntent(
  db: JubelioSalesOperationsDb,
  input: {
    orderId: string;
    type: JubelioSalesOperationType;
    reference: string;
    payload: JubelioSalesOperationPayload;
    /** Required for cancel intents (the known SO id); forbidden for create intents. */
    salesOrderId?: number;
  }
): Promise<{ operation: JubelioSalesOperation; created: boolean }> {
  if (!isNonEmptyString(input.orderId)) {
    throw new Error("Jubelio sales operation intent requires a local order id");
  }
  if (!isNonEmptyString(input.reference)) {
    throw new Error("Jubelio sales operation intent requires a unique reference");
  }
  if (!OPERATION_TYPES.has(input.type)) {
    throw new Error(
      "Jubelio sales operation intent type must be 'create', 'cancel', 'invoice' or 'payment'"
    );
  }
  if (
    !input.payload ||
    !OPERATION_TYPES.has(input.payload.type) ||
    input.payload.type !== input.type
  ) {
    throw new Error(
      "Jubelio sales operation intent payload kind must match the operation type"
    );
  }
  if (input.type === "cancel") {
    if (!isSafePositiveInteger(input.salesOrderId)) {
      throw new Error(
        "Jubelio sales cancel intent requires the known sales order id"
      );
    }
  } else if (input.type === "invoice") {
    if (
      input.payload.type !== "invoice" ||
      !isSafePositiveInteger(input.salesOrderId)
    ) {
      throw new Error(
        "Jubelio sales invoice intent requires the known sales order id"
      );
    }
  } else if (input.type === "payment") {
    if (
      input.payload.type !== "payment" ||
      !isSafePositiveInteger(input.payload.payment.invoiceId)
    ) {
      throw new Error(
        "Jubelio sales payment intent requires the verified invoice id"
      );
    }
  } else if (input.salesOrderId != null) {
    throw new Error(
      "Jubelio sales create intent must not carry a sales order id before the confirmed GET"
    );
  }

  const id = crypto.randomUUID();
  const inserted = await db
    .insert(jubelioSalesOperations)
    .values({
      id,
      orderId: input.orderId,
      type: input.type,
      status: "intent",
      reference: input.reference,
      payload: input.payload,
      salesOrderId: input.salesOrderId ?? null,
      // A payment intent always carries its verified invoice id; the CHECK
      // `..._payment_requires_invoice_id` enforces the same invariant in SQL.
      invoiceId:
        input.type === "payment" && input.payload.type === "payment"
          ? input.payload.payment.invoiceId
          : null,
    })
    // One operation per (order, type): a replayed intent record must never
    // create a second write path for the same order.
    .onConflictDoNothing({
      target: [jubelioSalesOperations.orderId, jubelioSalesOperations.type],
    })
    .returning();

  if (inserted.length > 0) {
    return { operation: inserted[0], created: true };
  }

  // Conflict: an operation already exists for this (order, type). Return the
  // existing row so the caller can reconcile against its actual state
  // (including a possibly-sent claim) instead of creating a second intent.
  const existing = await db
    .select()
    .from(jubelioSalesOperations)
    .where(
      and(
        eq(jubelioSalesOperations.orderId, input.orderId),
        eq(jubelioSalesOperations.type, input.type)
      )
    )
    .limit(1);
  if (existing.length === 0) {
    // Between conflict and read the row was removed — no second insert; the
    // caller must retry the whole intent step.
    throw new Error(
      `Jubelio sales operation intent conflict for order ${input.orderId} could not be resolved`
    );
  }
  if (
    existing[0].reference !== input.reference ||
    !isDeepStrictEqual(existing[0].payload, input.payload) ||
    // A confirmed create gains its remote id only AFTER the GET. Replaying
    // its original id-less intent must not reject that legitimate outcome.
    (input.type !== "create" && existing[0].salesOrderId !== (input.salesOrderId ?? null))
  ) {
    throw new Error(
      `Jubelio sales operation intent for order ${input.orderId} does not match the persisted operation`
    );
  }
  return { operation: existing[0], created: false };
}

/**
 * Atomic at-most-once dispatch claim. Exactly one SQL conditional UPDATE;
 * concurrent callers race at the database row lock and at most one receives
 * `claimed: true`. Once claimed, the operation is in `dispatched_unknown`:
 * the POST may already have been applied remotely, so no state ever returns
 * to `intent` and replay can never re-POST the write.
 */
export async function claimJubelioSalesOperationForDispatch(
  db: JubelioSalesOperationsDb,
  operationId: string
): Promise<ClaimJubelioSalesOperationResult> {
  const claimed = await db
    .update(jubelioSalesOperations)
    .set({
      status: "dispatched_unknown",
      dispatchedAt: new Date(),
      attemptCount: sql`${jubelioSalesOperations.attemptCount} + 1`,
      lastError: null,
      updatedAt: new Date(),
    })
    // The single dispatch gate: only a never-dispatched intent may be claimed.
    .where(
      and(
        eq(jubelioSalesOperations.id, operationId),
        eq(jubelioSalesOperations.status, "intent")
      )
    )
    .returning();

  if (claimed.length > 0) {
    return { claimed: true, operation: claimed[0] };
  }

  const existing = await db
    .select()
    .from(jubelioSalesOperations)
    .where(eq(jubelioSalesOperations.id, operationId))
    .limit(1);
  if (existing.length === 0) {
    return { claimed: false, reason: "not_found" };
  }
  return {
    claimed: false,
    reason: "not_dispatchable",
    operation: existing[0],
  };
}

/**
 * Marks an operation confirmed AFTER an independent GET verified the remote
 * write, persisting the known remote ids. Guarded to `dispatched_unknown`:
 * if the claim was lost or the row moved on, the caller receives `null` and
 * must reconcile instead of asserting success.
 *
 * Per-type invariants: create/cancel require the sales order id; invoice
 * requires the invoice id; payment requires the payment id (its invoice id
 * was already persisted at intent time).
 */
export async function markJubelioSalesOperationConfirmed(
  db: JubelioSalesOperationsDb,
  operationId: string,
  input: {
    salesOrderId?: number;
    invoiceId?: number;
    paymentId?: number;
    /** Create GET's informational marker result, persisted with confirmation. */
    channelStatusMatches?: boolean;
    /**
     * Ticket 07 — the GET-only SYSTEM recovery may flip a KNOWN
     * `manual_review` invoice/payment operation after the provider
     * verification (the verified caller passes this; the flag is never
     * exposed to any admin UI and never applies to create/cancel types).
     */
    readOnlyRecovery?: boolean;
  }
): Promise<JubelioSalesOperation | null> {
  const existing = await db
    .select()
    .from(jubelioSalesOperations)
    .where(eq(jubelioSalesOperations.id, operationId))
    .limit(1);
  const operation = existing[0];
  if (!operation) return null;
  if (
    (operation.type === "create" || operation.type === "cancel") &&
    !isSafePositiveInteger(input.salesOrderId)
  ) {
    throw new Error(
      "Jubelio sales operation confirmation requires a positive sales order id"
    );
  }
  if (operation.type === "invoice" && !isSafePositiveInteger(input.invoiceId)) {
    throw new Error(
      "Jubelio sales invoice confirmation requires a positive invoice id"
    );
  }
  if (operation.type === "payment" && !isSafePositiveInteger(input.paymentId)) {
    throw new Error(
      "Jubelio sales payment confirmation requires a positive payment id"
    );
  }
  const updated = await db
    .update(jubelioSalesOperations)
    .set({
      status: "confirmed",
      salesOrderId: input.salesOrderId ?? operation.salesOrderId,
      invoiceId: input.invoiceId ?? operation.invoiceId,
      paymentId: input.paymentId ?? operation.paymentId,
      ...(operation.type === "create" && input.channelStatusMatches === false
        ? {
            channelStatusMismatchReason: "CREATE_MARKER_MISMATCH",
            channelStatusMismatchAt: new Date(),
          }
        : {}),
      confirmedAt: new Date(),
      lastError: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(jubelioSalesOperations.id, operationId),
        recoveryEligible(operation, input.readOnlyRecovery === true)
          ? inArray(jubelioSalesOperations.status, ["dispatched_unknown", "manual_review"])
          : eq(jubelioSalesOperations.status, "dispatched_unknown")
      )
    )
    .returning();
  return updated[0] ?? null;
}

/** Only a KNOWN manual-review invoice/payment operation may recover by GET. */
function recoveryEligible(
  operation: { type: string; status: string },
  readOnlyRecovery: boolean
): boolean {
  return (
    readOnlyRecovery &&
    (operation.type === "invoice" || operation.type === "payment") &&
    operation.status === "manual_review"
  );
}

/**
 * Records a definitive local rejection while an intent has NEVER been
 * claimed. A claimed operation may already have been POSTed; without an
 * owner token a second caller cannot safely assert a provider rejection.
 * Route all post-claim failures to manual review until a claim-owned outcome
 * transition is implemented and verified. No transition back to `intent`.
 */
export async function markJubelioSalesOperationRejected(
  db: JubelioSalesOperationsDb,
  operationId: string,
  input: { message: string; salesOrderId?: number }
): Promise<JubelioSalesOperation | null> {
  const updated = await db
    .update(jubelioSalesOperations)
    .set({
      status: "rejected",
      lastError: input.message,
      updatedAt: new Date(),
      ...(input.salesOrderId != null
        ? { salesOrderId: input.salesOrderId }
        : {}),
    })
    .where(
      and(
        eq(jubelioSalesOperations.id, operationId),
        eq(jubelioSalesOperations.status, "intent")
      )
    )
    .returning();
  return updated[0] ?? null;
}

/**
 * Records a DEFINITIVE provider rejection observed by the dispatch owner
 * after its claim: the gateway answered with a pre-apply rejection (HTTP
 * 4xx / invalid input / local backpressure), so the write was provably never
 * applied. Guarded to `dispatched_unknown` — only the single claim winner can
 * be in this state, and ambiguous outcomes must instead go to manual review.
 */
export async function markJubelioSalesOperationRejectedAfterClaim(
  db: JubelioSalesOperationsDb,
  operationId: string,
  input: { message: string }
): Promise<JubelioSalesOperation | null> {
  const updated = await db
    .update(jubelioSalesOperations)
    .set({
      status: "rejected",
      lastError: input.message,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(jubelioSalesOperations.id, operationId),
        eq(jubelioSalesOperations.status, "dispatched_unknown")
      )
    )
    .returning();
  return updated[0] ?? null;
}

/**
 * Routes an ambiguous or unknown outcome (timeout, malformed success,
 * confirmation GET failure) to operator review. The intent and any known SO
 * id are retained for reconciliation; the write is never automatically
 * repeated. Only a claimed operation can enter this state; a never-claimed
 * intent should instead be aborted or explicitly rejected.
 */
export async function markJubelioSalesOperationManualReview(
  db: JubelioSalesOperationsDb,
  operationId: string,
  input: { message: string }
): Promise<JubelioSalesOperation | null> {
  const updated = await db
    .update(jubelioSalesOperations)
    .set({
      status: "manual_review",
      lastError: input.message,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(jubelioSalesOperations.id, operationId),
        eq(jubelioSalesOperations.status, "dispatched_unknown")
      )
    )
    .returning();
  return updated[0] ?? null;
}

/** Bounded scan of possibly-sent claims whose outcome is still unknown. */
export async function listStaleJubelioSalesOperations(
  db: JubelioSalesOperationsDb,
  olderThan: Date,
  limit = 50
): Promise<JubelioSalesOperation[]> {
  if (!Number.isFinite(olderThan.getTime()) || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("Jubelio sales recovery requires a valid cutoff and a limit of 1–100");
  }
  return db.select().from(jubelioSalesOperations)
    .where(and(
      eq(jubelioSalesOperations.status, "dispatched_unknown"),
      lt(jubelioSalesOperations.dispatchedAt, olderThan)
    ))
    .orderBy(jubelioSalesOperations.dispatchedAt)
    .limit(limit);
}

/**
 * Persists the remote invoice id returned by an invoice-conversion POST while
 * the operation is still `dispatched_unknown`. This runs BEFORE verification
 * so a crash leaves a reconcilable `GET /sales/invoices/{id}` handle. Returns
 * null when the claim was lost (the caller must reconcile, not re-POST).
 */
export async function persistJubelioSalesInvoiceId(
  db: JubelioSalesOperationsDb,
  operationId: string,
  invoiceId: number
): Promise<JubelioSalesOperation | null> {
  if (!isSafePositiveInteger(invoiceId)) {
    throw new Error("A persisted Jubelio invoice id must be a positive integer");
  }
  const updated = await db
    .update(jubelioSalesOperations)
    .set({ invoiceId, updatedAt: new Date() })
    .where(
      and(
        eq(jubelioSalesOperations.id, operationId),
        eq(jubelioSalesOperations.type, "invoice"),
        eq(jubelioSalesOperations.status, "dispatched_unknown")
      )
    )
    .returning();
  return updated[0] ?? null;
}

/**
 * Bounded scan of operations in the given statuses (sweep reconciliation and
 * the admin review queue). Ordered by updatedAt so the oldest work surfaces
 * first.
 */
export async function listJubelioSalesOperationsByStatus(
  db: JubelioSalesOperationsDb,
  statuses: JubelioSalesOperation["status"][],
  limit = 50
): Promise<JubelioSalesOperation[]> {
  if (
    statuses.length === 0 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 200
  ) {
    throw new Error(
      "Jubelio sales operation scan requires at least one status and a limit of 1–200"
    );
  }
  return db
    .select()
    .from(jubelioSalesOperations)
    .where(inArray(jubelioSalesOperations.status, statuses))
    .orderBy(jubelioSalesOperations.updatedAt)
    .limit(limit);
}

/**
 * Fail-closed crash recovery at the durable operation seam. A process that
 * dies after claiming a write cannot be assumed to have skipped the POST.
 * Only an aged, STILL-unknown dispatch may be moved to manual review. The
 * status and timestamp are checked by the same conditional UPDATE, so an
 * independently confirmed operation or a fresh in-flight write is never
 * overwritten. This never repeats a provider request or releases a hold.
 *
 * A caller must separately scan for aged operations and surface the review
 * queue to ops before the SO lifecycle may be wired into checkout.
 */
export async function markStaleJubelioSalesOperationForManualReview(
  db: JubelioSalesOperationsDb,
  operationId: string,
  olderThan: Date
): Promise<JubelioSalesOperation | null> {
  if (!isNonEmptyString(operationId) || !Number.isFinite(olderThan.getTime())) {
    throw new Error("Jubelio sales recovery requires an operation id and a valid cutoff");
  }
  const [updated] = await db
    .update(jubelioSalesOperations)
    .set({
      status: "manual_review",
      lastError: sql`coalesce(${jubelioSalesOperations.lastError}, 'Dispatch outcome still unknown after recovery cutoff; inspect Jubelio before any action')`,
      updatedAt: new Date(),
    })
    .where(and(
      eq(jubelioSalesOperations.id, operationId),
      eq(jubelioSalesOperations.status, "dispatched_unknown"),
      lt(jubelioSalesOperations.dispatchedAt, olderThan)
    ))
    .returning();
  return updated ?? null;
}

/**
 * Abandons an operation that was NEVER dispatched (still `intent`), e.g. the
 * local checkout failed before the POST. A possibly-sent write can never be
 * aborted — it must be confirmed or routed to manual review.
 */
export async function abortJubelioSalesOperation(
  db: JubelioSalesOperationsDb,
  operationId: string,
  input: { message: string }
): Promise<JubelioSalesOperation | null> {
  const updated = await db
    .update(jubelioSalesOperations)
    .set({
      status: "aborted",
      lastError: input.message,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(jubelioSalesOperations.id, operationId),
        eq(jubelioSalesOperations.status, "intent")
      )
    )
    .returning();
  return updated[0] ?? null;
}

/** Reads the (order, type) operation row, or null when the order has none. */
export async function getJubelioSalesOperation(
  db: JubelioSalesOperationsDb,
  input: { orderId: string; type: JubelioSalesOperationType }
): Promise<JubelioSalesOperation | null> {
  const rows = await db
    .select()
    .from(jubelioSalesOperations)
    .where(
      and(
        eq(jubelioSalesOperations.orderId, input.orderId),
        eq(jubelioSalesOperations.type, input.type)
      )
    )
    .limit(1);
  return rows[0] ?? null;
}
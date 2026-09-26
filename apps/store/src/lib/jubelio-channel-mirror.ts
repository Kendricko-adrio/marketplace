import { and, asc, desc, eq, exists, gt, inArray, isNotNull, ne, notExists, or, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  jubelioChannelStatusIntents,
  jubelioSalesOperations,
  orders,
  type ChannelStatusMarker,
  type JubelioChannelStatusIntentStatus,
  type JubelioSalesOrderEditRequest,
} from "@marketplace/db/src/schema";
import {
  JubelioSalesGatewayError,
  createJubelioSalesGateway,
  moneyEqualsSafe,
  type JubelioSalesGateway,
  type JubelioSalesOrderEditSnapshot,
} from "./jubelio-sales-client";
import { createLogger, serializeError, type Logger } from "./logger";

/**
 * Durable per-order channel-status mirror reconciliation (tickets #03, #04,
 * #05 and #06 — crash-tolerant stage-aware channel edits; spec decisions 4–8
 * of .scratch/jubelio-pickup-status/spec-draft.md).
 *
 * This module is the approved public per-order seam:
 * `reconcileJubelioChannelStatusForOrder` projects the COMMITTED local order
 * state onto the Jubelio Status Channel:
 *
 * 1. Eligibility for a target is derived ONLY from committed state: local
 *    order `ready_for_pickup` AND a confirmed invoice operation AND a
 *    confirmed payment operation (each verified by its independent GET)
 *    project `Siap Proses` (#03); a paid-but-blocked committed operator
 *    investigation projects `Menunggu Verifikasi` (#04); a committed
 *    `failed_payment` order with a provably safe-to-edit Sales Order
 *    projects `Gagal Bayar` (#05); a committed `completed` order (only
 *    reachable AFTER pickup) with the same verified ledger projects
 *    `Selesai` (#06). A merely `paid` Midtrans status, an in-flight
 *    settlement, or the store->admin HTTP outcome is NOT enough. A committed
 *    `cancelled` order maps to `Dibatalkan` as a FUTURE-FACING MAPPING
 *    CONTRACT ONLY — nothing dispatches it (no lawful runtime writer).
 * 2. An intent (monotonic `target_version`, known SO id, target marker) is
 *    persisted BEFORE any POST; a newer target never dispatches while an
 *    older one is `possibly_sent`; a confirmed LATER forward stage is never
 *    overwritten by an earlier target (no backward marker); a stale PENDING
 *    target is atomically superseded before the next version is recorded.
 * 3. ONE conditional UPDATE (`pending` → `possibly_sent`) grants the single
 *    edit POST permission; every other concurrent caller is refused.
 * 4. Dispatch is fail-closed: the strict pre-edit GET must match the verified
 *    ledger (create intent items/money/identity + verified invoice link) and
 *    the gateway's own envelope/shape checks must pass — otherwise ZERO POST
 *    happens and a PII-safe investigation case is recorded. The edit is a
 *    full payload preserving SO id/number, detail ids, items and money
 *    verbatim; the ONLY intended change is `channel_status`.
 * 5. Ambiguity after the claim (timeout, 5xx, unreadable response, failed
 *    confirmation GET) leaves the intent `possibly_sent`; recovery is
 *    GET-ONLY via the persisted SO id — never a re-POST. TRANSIENT read
 *    failures (5xx/429/timeout GET after the claim) are treated the same:
 *    they stay `possibly_sent` for an aged GET-only retry, never an
 *    investigation; only DEFINITIVE read failures (strict shape, canceled,
 *    unknown SO) record a PII-safe investigation case. The confirmation
 *    always compares the GET against the intent's OWN target marker.
 * 6. A mirror failure never touches the local order: status, payment status,
 *    pickup code and verify-pickup permission stay authoritative locally.
 *    No writes to `orders` happen anywhere in this module.
 *
 * Wiring (implemented): the settlement pipeline reconciles the mirror
 * best-effort after pickup is claimed, after settlement manual reviews, and
 * on the cancel-aware failed-payment paths, and the cron sweep runs the
 * bounded fair mirror pass LAST (lowest priority).
 *
 * Ticket #04 (`Menunggu Verifikasi`): a paid-but-blocked order whose
 * committed state carries settlement manual review (a `manual_review` ledger
 * operation) or an explicit operator investigation block
 * (`fulfillment_blocked_reason`) projects the `Menunggu Verifikasi` marker
 * through the SAME intent/claim/full-payload/GET machinery. A short
 * pending/in-flight settlement and the implicit admin-queue membership of
 * every processing+paid order are NOT triggers. When a committed manual
 * review is resolved (order `ready_for_pickup` + verified invoice/payment),
 * the LATEST mirror target is the next monotonic version `Siap Proses` — a
 * stale pending `Menunggu Verifikasi` intent is durably superseded (never
 * dispatched) and a confirmed one is followed, never overwritten.
 *
 * Ticket #05 (`Gagal Bayar`): a committed `failed_payment` order whose
 * Sales-Order cancel path never started (or was definitively refused or
 * abandoned pre-apply) projects `Gagal Bayar`; a started/confirmed cancel
 * path is NEVER edited — the durable PII-safe mismatch is recorded instead.
 * A later settlement re-derives the current state (the failed marker is
 * never a permanent end state).
 *
 * Ticket #06 (`Selesai`): a committed local `completed` order (only
 * reachable AFTER pickup) projects the final `Selesai` marker through the
 * SAME machinery, and the store's internal order-complete endpoint schedules
 * the reconciliation via `after()` so the admin's pickup request never waits
 * on the Jubelio edit. The committed `cancelled` → `Dibatalkan` mapping
 * remains a FUTURE-FACING CONTRACT ONLY: no lawful runtime `cancelled`
 * writer exists, so nothing dispatches it and no cancel API/UI is added.
 */

// Accept both the complete app DB schema and the focused test schema: these
// operations need only the SQL query builders.
export type ChannelMirrorDb = Pick<NodePgDatabase, "select" | "insert" | "update">;

/** The one target this ticket dispatches (committed `ready_for_pickup`). */
export const CHANNEL_STATUS_SIAP_PROSES = "Siap Proses" as const;

/**
 * Ticket #04 target: the operator-investigation marker, projected ONLY for a
 * paid-but-blocked order whose committed state evidences a settlement manual
 * review or an explicit operator investigation block.
 */
export const CHANNEL_STATUS_MENUNGGU_VERIFIKASI = "Menunggu Verifikasi" as const;

/**
 * Ticket #05 target: the failed-payment marker, projected ONLY from a
 * COMMITTED `failed_payment` transition whose Sales Order is provably safe
 * to edit (the Sales-Order cancel path never started, or its single write
 * was definitively refused/abandoned before applying).
 */
export const CHANNEL_STATUS_GAGAL_BAYAR = "Gagal Bayar" as const;

/**
 * Ticket #06 target: the final-stage marker for a committed local `completed`
 * order (which is only reachable AFTER pickup — the completion path requires
 * `ready_for_pickup`). Dispatched ONLY from that committed state, never from
 * a payment result or an HTTP response alone.
 */
export const CHANNEL_STATUS_SELESAI = "Selesai" as const;

/**
 * FUTURE-FACING MAPPING CONTRACT ONLY (ticket #06): a committed local
 * `cancelled` order maps to the `Dibatalkan` marker. NO runtime code path
 * transitions a local order to `cancelled` today, so NOTHING dispatches
 * this marker: it is exposed and tested at the mapping level only, and any
 * lawful runtime `cancelled` transition (with its own cancel-aware safety
 * rules, mirroring the Gagal Bayar/SO-cancel interaction) is a separate
 * owner-approved change. No cancel API/UI/route is created here.
 */
export const CHANNEL_STATUS_DIBATALKAN = "Dibatalkan" as const;

/**
 * The approved final-state mapping (spec table): a committed local terminal
 * order status maps to its Status Channel marker. PURE and declarative —
 * dispatch eligibility is decided separately (see `deriveChannelStatusTarget`):
 * `Dibatalkan` is intentionally NOT wired into any dispatch path in this
 * ticket because no lawful runtime `cancelled` writer exists yet.
 */
export function channelStatusMarkerForTerminalLocalOrderStatus(
  status: string
): ChannelStatusMarker | null {
  switch (status) {
    case "completed":
      return CHANNEL_STATUS_SELESAI;
    case "cancelled":
      // FUTURE-FACING MAPPING ONLY (ticket #06): see CHANNEL_STATUS_DIBATALKAN.
      return CHANNEL_STATUS_DIBATALKAN;
    default:
      return null;
  }
}

/**
 * Monotonic forward sales-progression ranks for the linear stages the
 * mirror projects. An ALREADY-CONFIRMED intent whose target sits at or
 * after the proposed target on this chain is never followed by an older
 * edit (no backward marker overwrite, spec decision 5/10). `Gagal Bayar` is
 * deliberately NOT ranked: it is #05's branch state (a late settlement can
 * lawfully return to `Siap Proses`), so no ordering is claimed against it
 * and the mirror projects the latest committed state. Unknown/branch
 * targets (and `Dibatalkan`, which is never dispatched here) never block a
 * newer projection on ordering grounds.
 */
const TARGET_PROGRESS_RANK: Partial<Record<ChannelStatusMarker, number>> = {
  "Menunggu Verifikasi": 1, // #04: investigation branch resolved by the next stage
  "Siap Proses": 2,
  Selesai: 3,
};

/**
 * Pure guard: would dispatching `proposedTarget` regress the marker below a
 * target that is already CONFIRMED on the forward sales-progression chain?
 * Only provable orderings (both targets ranked) answer `true`; an unranked
 * confirmed target (e.g. `Gagal Bayar`) never blocks the projection of the
 * latest committed local state.
 */
export function isChannelTargetRegression(
  latestConfirmedTarget: string,
  proposedTarget: string
): boolean {
  const latestRank =
    TARGET_PROGRESS_RANK[latestConfirmedTarget as ChannelStatusMarker];
  const proposedRank = TARGET_PROGRESS_RANK[proposedTarget as ChannelStatusMarker];
  return (
    latestRank !== undefined &&
    proposedRank !== undefined &&
    latestRank >= proposedRank
  );
}

/** Ticket #04: derived mirror targets (the only values the mirror dispatches). */
export type DerivedChannelStatusTarget =
  | typeof CHANNEL_STATUS_SIAP_PROSES
  | typeof CHANNEL_STATUS_MENUNGGU_VERIFIKASI
  | typeof CHANNEL_STATUS_GAGAL_BAYAR
  | typeof CHANNEL_STATUS_SELESAI;

export type JubelioChannelStatusIntent = typeof jubelioChannelStatusIntents.$inferSelect;

type JubelioSalesOperation = typeof jubelioSalesOperations.$inferSelect;

export type ReconcileChannelStatusOutcome =
  | { status: "confirmed"; intent: JubelioChannelStatusIntent }
  | { status: "in_flight"; message: string; intent: JubelioChannelStatusIntent | null }
  | { status: "needs_investigation"; message: string; intent: JubelioChannelStatusIntent | null }
  | { status: "rejected"; message: string; intent: JubelioChannelStatusIntent }
  | {
      status: "skipped";
      reason:
        | "not_eligible"
        | "already_confirmed"
        | "investigation_open"
        | "cancel_started";
    };

function isSafePositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

// ---------------------------------------------------------------------------
// Gateway default (tests and callers inject a controlled gateway)
// ---------------------------------------------------------------------------

let defaultMirrorGateway: JubelioSalesGateway | null = null;

/** Default live gateway (disabled by default outside production; tests inject). */
export function getDefaultJubelioChannelMirrorGateway(): JubelioSalesGateway {
  if (!defaultMirrorGateway) {
    defaultMirrorGateway = createJubelioSalesGateway();
  }
  return defaultMirrorGateway;
}

/** Inject a gateway (tests). Pass null to reset to the default factory. */
export function setDefaultJubelioChannelMirrorGateway(
  gateway: JubelioSalesGateway | null
): void {
  defaultMirrorGateway = gateway;
}

// ---------------------------------------------------------------------------
// Durable primitives (same shape as the settlement ledger's operations API)
// ---------------------------------------------------------------------------

/**
 * Persists the channel-status intent for the NEXT monotonic version of the
 * order. Concurrent creators converge: the `(order_id, target_version)`
 * unique index admits exactly one row per version, and the loser re-reads
 * the winner instead of creating a parallel write path.
 */
export async function recordJubelioChannelStatusIntent(
  db: ChannelMirrorDb,
  input: {
    orderId: string;
    salesOrderId: number;
    targetStatus: string;
  }
): Promise<{ intent: JubelioChannelStatusIntent; created: boolean }> {
  if (!isSafePositiveInteger(input.salesOrderId)) {
    throw new Error("A channel-status intent requires a positive sales order id");
  }
  const latest = await getLatestJubelioChannelStatusIntent(db, input.orderId);
  const nextVersion = latest ? latest.targetVersion + 1 : 1;
  const inserted = await db
    .insert(jubelioChannelStatusIntents)
    .values({
      id: crypto.randomUUID(),
      orderId: input.orderId,
      salesOrderId: input.salesOrderId,
      targetVersion: nextVersion,
      targetStatus: input.targetStatus,
      status: "pending",
    })
    .onConflictDoNothing({
      target: [
        jubelioChannelStatusIntents.orderId,
        jubelioChannelStatusIntents.targetVersion,
      ],
    })
    .returning();
  if (inserted.length > 0) {
    return { intent: inserted[0], created: true };
  }
  const existing = await getLatestJubelioChannelStatusIntent(db, input.orderId);
  if (!existing) {
    throw new Error(
      `Channel-status intent for order ${input.orderId} could not be resolved`
    );
  }
  return { intent: existing, created: false };
}

/** Reads the order's latest (highest-version) channel-status intent. */
export async function getLatestJubelioChannelStatusIntent(
  db: ChannelMirrorDb,
  orderId: string
): Promise<JubelioChannelStatusIntent | null> {
  const rows = await db
    .select()
    .from(jubelioChannelStatusIntents)
    .where(eq(jubelioChannelStatusIntents.orderId, orderId))
    .orderBy(desc(jubelioChannelStatusIntents.targetVersion))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Atomic at-most-once dispatch claim: ONE conditional UPDATE
 * `WHERE id = ? AND status = 'pending'` → `possibly_sent` ... RETURNING.
 * The winning caller owns exactly one edit POST; every other caller is
 * refused — a claimed intent is POSSIBLY SENT and must never be re-POSTed.
 *
 * Per-SO serialization is a DATABASE guarantee: the partial unique index
 * `jubelio_channel_status_intent_active_per_so_unique` admits at most ONE
 * `possibly_sent` intent per sales_order_id across ALL local orders. When a
 * competing claim violates it, the loser fails CLOSED (claimed: false,
 * `reason: "active_for_so"`, its row untouched and still `pending`) —
 * never a second POST for the same SO. Monotonic per-order versions are
 * unaffected; the guard releases as soon as the active intent leaves
 * `possibly_sent`.
 */
export async function claimJubelioChannelStatusIntentForDispatch(
  db: ChannelMirrorDb,
  intentId: string
): Promise<{
  claimed: boolean;
  intent: JubelioChannelStatusIntent | null;
  reason?: "not_dispatchable" | "not_found" | "active_for_so";
}> {
  let claimed: JubelioChannelStatusIntent[];
  try {
    claimed = await db
      .update(jubelioChannelStatusIntents)
      .set({
        status: "possibly_sent",
        dispatchedAt: new Date(),
        attemptCount: sql`${jubelioChannelStatusIntents.attemptCount} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(jubelioChannelStatusIntents.id, intentId),
          eq(jubelioChannelStatusIntents.status, "pending")
        )
      )
      .returning();
  } catch (error) {
    const cause = (error as { cause?: { code?: string; constraint?: string } })
      ?.cause;
    if (
      cause?.code === "23505" &&
      cause?.constraint === "jubelio_channel_status_intent_active_per_so_unique"
    ) {
      // Another local order already holds the ACTIVE dispatch for this SO:
      // fail closed — this intent stays `pending`, no second POST.
      const rows = await db
        .select()
        .from(jubelioChannelStatusIntents)
        .where(eq(jubelioChannelStatusIntents.id, intentId))
        .limit(1);
      return { claimed: false, intent: rows[0] ?? null, reason: "active_for_so" };
    }
    throw error;
  }
  if (claimed.length > 0) {
    return { claimed: true, intent: claimed[0] };
  }
  const rows = await db
    .select()
    .from(jubelioChannelStatusIntents)
    .where(eq(jubelioChannelStatusIntents.id, intentId))
    .limit(1);
  return { claimed: false, intent: rows[0] ?? null, reason: "not_dispatchable" };
}

/**
 * CANCEL-AWARE dispatch claim (ticket #05 parent-review correction): the
 * `Gagal Bayar` variant of the generic at-most-once claim that fails
 * closed against the CURRENT committed cancel-active evidence IN THE SAME
 * `UPDATE ... WHERE status = 'pending'` statement — a Sales-Order cancel
 * path that starts (intent recorded, maybe-sent) or is confirmed AFTER the
 * eligibility read but BEFORE the claim can never grant the marker edit
 * POST. The generic claim (Siap Proses / Menunggu Verifikasi) is UNCHANGED.
 * Returns the same shape as the generic claim plus `reason: "cancel_started"`
 * when the correlated committed evidence refused a still-pending row (the
 * caller re-derives the started-cancel mismatch disposition without any
 * POST) and `reason: "active_for_so"` for the per-SO active-dispatch guard.
 */
export async function claimJubelioChannelStatusIntentForGagalBayarDispatch(
  db: ChannelMirrorDb,
  intentId: string
): Promise<{
  claimed: boolean;
  intent: JubelioChannelStatusIntent | null;
  reason?: "not_dispatchable" | "not_found" | "active_for_so" | "cancel_started";
}> {
  let claimed: JubelioChannelStatusIntent[];
  try {
    claimed = await db
      .update(jubelioChannelStatusIntents)
      .set({
        status: "possibly_sent",
        dispatchedAt: new Date(),
        attemptCount: sql`${jubelioChannelStatusIntents.attemptCount} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(jubelioChannelStatusIntents.id, intentId),
          eq(jubelioChannelStatusIntents.status, "pending"),
          // Correlated COMMITTED Gagal Bayar evidence, same statement:
          exists(
            db
              .select({ one: sql`1` })
              .from(orders)
              .where(
                and(
                  eq(orders.id, jubelioChannelStatusIntents.orderId),
                  eq(orders.status, "failed_payment"),
                  eq(orders.paymentStatus, "failed")
                )
              )
          ),
          exists(
            db
              .select({ one: sql`1` })
              .from(jubelioSalesOperations)
              .where(
                and(
                  eq(jubelioSalesOperations.orderId, jubelioChannelStatusIntents.orderId),
                  eq(jubelioSalesOperations.type, "create"),
                  eq(jubelioSalesOperations.status, "confirmed"),
                  gt(jubelioSalesOperations.salesOrderId, 0)
                )
              )
          ),
          // THE RACE GUARD: no cancel ledger operation in an ACTIVE state
          // (intent / dispatched_unknown / confirmed / manual_review) may
          // exist at claim time — a cancel path that started after the
          // eligibility read refuses the claim (row untouched, still
          // `pending`, attempt_count unchanged, zero POST).
          notExists(
            db
              .select({ one: sql`1` })
              .from(jubelioSalesOperations)
              .where(
                and(
                  eq(jubelioSalesOperations.orderId, jubelioChannelStatusIntents.orderId),
                  eq(jubelioSalesOperations.type, "cancel"),
                  inArray(jubelioSalesOperations.status, ACTIVE_CANCEL_STATUSES)
                )
              )
          )
        )
      )
      .returning();
  } catch (error) {
    const cause = (error as { cause?: { code?: string; constraint?: string } })
      ?.cause;
    if (
      cause?.code === "23505" &&
      cause?.constraint === "jubelio_channel_status_intent_active_per_so_unique"
    ) {
      const rows = await db
        .select()
        .from(jubelioChannelStatusIntents)
        .where(eq(jubelioChannelStatusIntents.id, intentId))
        .limit(1);
      return { claimed: false, intent: rows[0] ?? null, reason: "active_for_so" };
    }
    throw error;
  }
  if (claimed.length > 0) {
    return { claimed: true, intent: claimed[0] };
  }
  const rows = await db
    .select()
    .from(jubelioChannelStatusIntents)
    .where(eq(jubelioChannelStatusIntents.id, intentId))
    .limit(1);
  if (!rows[0]) {
    return { claimed: false, intent: null, reason: "not_found" };
  }
  // A still-pending row means the correlated committed evidence refused the
  // claim (the volatile part: the cancel path started). Anything else is
  // claimed by someone else (not_dispatchable).
  return {
    claimed: false,
    intent: rows[0],
    reason: rows[0].status === "pending" ? "cancel_started" : "not_dispatchable",
  };
}

/**
 * OWNER-ONLY pre-POST boundary abort (ticket #05 parent-review correction):
 * after the pre-edit GET and BEFORE the single edit POST, the claim owner
 * re-reads the committed cancel evidence; when the Sales-Order cancel path
 * became ACTIVE in that window, the owner aborts ITS OWN claim with the
 * static PII-safe reason `GAGAL_BAYAR_CANCEL_STARTED` and performs ZERO
 * POST. This is the ONLY code path that may transition a `possibly_sent`
 * intent to `aborted`: the owner provably has NOT POSTed yet (it is the
 * same synchronous execution between the claim and the edit POST), so the
 * at-most-once invariant is preserved — a claimed edit is never
 * retro-aborted by a competing caller, GET-only recovery is untouched, and
 * an owner crash between claim and this re-check leaves the intent
 * `possibly_sent` for GET-only recovery (which fail-closes a canceled SO).
 * Correlated to the committed cancel-active evidence in the SAME statement
 * (fail-closed against a raced cancel resolution).
 */
export async function abortClaimedIntentForStartedCancel(
  db: ChannelMirrorDb,
  intentId: string
): Promise<JubelioChannelStatusIntent | null> {
  const updated = await db
    .update(jubelioChannelStatusIntents)
    .set({
      status: "aborted",
      mismatchReason: GAGAL_BAYAR_CANCEL_STARTED,
      mismatchAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(jubelioChannelStatusIntents.id, intentId),
        eq(jubelioChannelStatusIntents.status, "possibly_sent"),
        exists(
          db
            .select({ one: sql`1` })
            .from(orders)
            .where(
              and(
                eq(orders.id, jubelioChannelStatusIntents.orderId),
                eq(orders.status, "failed_payment"),
                eq(orders.paymentStatus, "failed"),
                exists(
                  db
                    .select({ one: sql`1` })
                    .from(jubelioSalesOperations)
                    .where(
                      and(
                        eq(jubelioSalesOperations.orderId, jubelioChannelStatusIntents.orderId),
                        eq(jubelioSalesOperations.type, "cancel"),
                        inArray(jubelioSalesOperations.status, ACTIVE_CANCEL_STATUSES)
                      )
                    )
                )
              )
            )
        )
      )
    )
    .returning();
  return updated[0] ?? null;
}

/** Fresh committed cancel-path state for the pre-POST re-check. */
async function loadCancelOpForOrder(
  db: ChannelMirrorDb,
  orderId: string
): Promise<JubelioSalesOperation | null> {
  const rows = await db
    .select()
    .from(jubelioSalesOperations)
    .where(
      and(
        eq(jubelioSalesOperations.orderId, orderId),
        eq(jubelioSalesOperations.type, "cancel")
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Persists the verified full-payload edit snapshot BEFORE the single POST so
 * a crash still leaves an auditable request. Guarded to `possibly_sent`.
 */
export async function persistJubelioChannelStatusEditSnapshot(
  db: ChannelMirrorDb,
  intentId: string,
  edit: JubelioSalesOrderEditRequest["edit"]
): Promise<JubelioChannelStatusIntent | null> {
  const updated = await db
    .update(jubelioChannelStatusIntents)
    .set({
      payload: { type: "edit", edit },
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(jubelioChannelStatusIntents.id, intentId),
        eq(jubelioChannelStatusIntents.status, "possibly_sent")
      )
    )
    .returning();
  return updated[0] ?? null;
}

/** Confirms an intent AFTER the independent post-edit GET, guarded to the claim. */
export async function markJubelioChannelStatusIntentConfirmed(
  db: ChannelMirrorDb,
  intentId: string,
  input: { observedStatus: string }
): Promise<JubelioChannelStatusIntent | null> {
  if (!input.observedStatus.trim()) {
    throw new Error("A confirmed channel-status intent requires an observed marker");
  }
  const updated = await db
    .update(jubelioChannelStatusIntents)
    .set({
      status: "confirmed",
      lastObservedStatus: input.observedStatus,
      lastObservedAt: new Date(),
      confirmedAt: new Date(),
      lastError: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(jubelioChannelStatusIntents.id, intentId),
        eq(jubelioChannelStatusIntents.status, "possibly_sent")
      )
    )
    .returning();
  return updated[0] ?? null;
}

/**
 * Records a durable, PII-safe investigation case (fail-closed mismatch,
 * incomplete remote shape, aged unknown). The intent is never re-dispatched
 * automatically after this. Guarded to `possibly_sent` — only a claimed
 * intent owns its outcome.
 */
export async function markJubelioChannelStatusIntentNeedsInvestigation(
  db: ChannelMirrorDb,
  intentId: string,
  input: { reason: string; observedStatus?: string | null }
): Promise<JubelioChannelStatusIntent | null> {
  if (
    !(INVESTIGATION_REASON_CODES as readonly string[]).includes(input.reason)
  ) {
    throw new Error(
      "A channel-status investigation reason must be a known static internal reason code (finite allowlist); provider or dynamic text must never be persisted"
    );
  }
  const updated = await db
    .update(jubelioChannelStatusIntents)
    .set({
      status: "needs_investigation",
      mismatchReason: input.reason,
      mismatchAt: new Date(),
      ...(input.observedStatus != null
        ? { lastObservedStatus: input.observedStatus, lastObservedAt: new Date() }
        : {}),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(jubelioChannelStatusIntents.id, intentId),
        eq(jubelioChannelStatusIntents.status, "possibly_sent")
      )
    )
    .returning();
  return updated[0] ?? null;
}

/**
 * KNOWN LOCAL gateway fail-closed codes — constants set by OUR gateway only.
 * The provider  (an arbitrary, attacker-controllable string) must
 * NEVER reach a durable field; only these local constants may be persisted,
 * plus the static fallbacks PRE_READ_FAILED / RECOVERY_GET_FAILED /
 * EDIT_PROVIDER_REJECTED.
 */
export const LOCAL_EDIT_CODES = [
  "EDIT_SHAPE_INCOMPLETE",
  "EDIT_SO_CANCELED",
  "EDIT_SOURCE_NOT_INTERNAL",
  "EDIT_TARGET_INVALID",
  "EDIT_ENVELOPE_UNEVIDENCED",
] as const;

export type LocalEditCode = (typeof LOCAL_EDIT_CODES)[number];

/** Finite, static rejection vocabulary: local edit codes + the provider-rejection code. */
export const REJECTION_REASON_CODES = [
  ...LOCAL_EDIT_CODES,
  "EDIT_PROVIDER_REJECTED",
] as const;

export type RejectionReasonCode = (typeof REJECTION_REASON_CODES)[number];

/**
 * COMPLETE finite vocabulary of internal investigation reason codes: the
 * mirrorPreReadMismatch cross-check codes, the static fallbacks, and the
 * known local gateway fail-closed codes. markJubelioChannelStatusIntent
 * NeedsInvestigation refuses anything outside this list BEFORE any write.
 */
export const INVESTIGATION_REASON_CODES = [
  "PRE_READ_NO_VERIFIED_CREATE",
  "PRE_READ_SO_CANCELED",
  "PRE_READ_CONTACT_OR_LOCATION_MISMATCH",
  "PRE_READ_NOTE_MISMATCH",
  "PRE_READ_REF_MISMATCH",
  "PRE_READ_INVOICE_LINK_MISMATCH",
  "PRE_READ_ITEM_LINE_COUNT_MISMATCH",
  "PRE_READ_ITEM_MISMATCH",
  "PRE_READ_MONEY_MISMATCH",
  "PRE_READ_FAILED",
  "RECOVERY_GET_FAILED",
  "RECOVERY_NO_VERIFIED_CREATE",
  "RECOVERY_MARKER_NOT_OBSERVED",
  ...LOCAL_EDIT_CODES,
] as const;

/**
 * Narrows an error code to the KNOWN LOCAL set: anything else (including a
 * hostile provider body.code) maps to undefined so the caller persists a
 * static fallback instead of provider-controlled text.
 */
function safeLocalEditCode(code: string | undefined): LocalEditCode | undefined {
  return (LOCAL_EDIT_CODES as readonly string[]).includes(code ?? "")
    ? (code as LocalEditCode)
    : undefined;
}

/**
 * Records a definitive pre-apply provider rejection (4xx): the edit was
 * provably never applied. Guarded to the claim, like the settlement ledger.
 *
 * The durable `last_error` is constrained to a STATIC PII-safe reason code
 * (validated before any write); a dynamic provider/local error message must
 * NEVER reach the durable row — the caller may still surface the dynamic
 * message in its return value, but persistence is code-only, fail-closed:
 * anything that is not a static code is refused outright.
 */
export async function markJubelioChannelStatusIntentRejectedAfterClaim(
  db: ChannelMirrorDb,
  intentId: string,
  input: { reason: RejectionReasonCode }
): Promise<JubelioChannelStatusIntent | null> {
  if (!(REJECTION_REASON_CODES as readonly string[]).includes(input.reason)) {
    throw new Error(
      "A channel-status rejection reason must be a known static PII-safe rejection code (finite allowlist); provider or dynamic text must never be persisted"
    );
  }
  const updated = await db
    .update(jubelioChannelStatusIntents)
    .set({
      status: "rejected",
      lastError: input.reason,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(jubelioChannelStatusIntents.id, intentId),
        eq(jubelioChannelStatusIntents.status, "possibly_sent")
      )
    )
    .returning();
  return updated[0] ?? null;
}

/**
 * Bounded scan of unresolved intents for the sweep. Status-based ONLY: it
 * must find intents for `ready_for_pickup` AND terminal orders (completed,
 * cancelled; ticket #05 removed failed_payment — its pending intents now flow through the per-order Gagal Bayar derivation) — never filtered by `processing + paid`.
 */
export async function listJubelioChannelStatusIntentsByStatus(
  db: ChannelMirrorDb,
  statuses: JubelioChannelStatusIntentStatus[],
  limit = 50
): Promise<JubelioChannelStatusIntent[]> {
  if (
    statuses.length === 0 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 200
  ) {
    throw new Error(
      "Channel-status intent scan requires at least one status and a limit of 1–200"
    );
  }
  return db
    .select()
    .from(jubelioChannelStatusIntents)
    .where(inArray(jubelioChannelStatusIntents.status, statuses))
    .orderBy(jubelioChannelStatusIntents.updatedAt)
    .limit(limit);
}

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

function classifyGatewayError(error: unknown): {
  kind: "ambiguous" | "transient" | "definitive";
  code: string | undefined;
  message: string;
} {
  if (error instanceof JubelioSalesGatewayError) {
    return {
      // "transient": a NON-ambiguous but retryable failure (GET 5xx/429,
      // timeout, network error) — for reads this means "try again later,
      // GET-only"; for a WRITE it provably never applied.
      kind: error.options.ambiguous
        ? "ambiguous"
        : error.options.retryable
          ? "transient"
          : "definitive",
      code: error.options.code,
      message: error.message,
    };
  }
  // Without a typed gateway error we cannot prove the write was not applied.
  return {
    kind: "ambiguous",
    code: undefined,
    message: error instanceof Error ? error.message : "Unexpected Jubelio error",
  };
}

type MirrorContext = {
  order: {
    id: string;
    status: string;
    paymentStatus: string;
    fulfillmentBlockedReason: string | null;
  };
  create: JubelioSalesOperation | null;
  cancel: JubelioSalesOperation | null;
  invoice: JubelioSalesOperation | null;
  payment: JubelioSalesOperation | null;
  /** A committed manual_review ledger operation (any settlement step). */
  hasManualReviewOp: boolean;
};

async function loadMirrorContext(
  db: ChannelMirrorDb,
  orderId: string
): Promise<MirrorContext | null> {
  const orderRows = await db
    .select({
      id: orders.id,
      status: orders.status,
      paymentStatus: orders.paymentStatus,
      fulfillmentBlockedReason: orders.fulfillmentBlockedReason,
    })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);
  const order = orderRows[0];
  if (!order) return null;
  const ops = await db
    .select()
    .from(jubelioSalesOperations)
    .where(eq(jubelioSalesOperations.orderId, orderId));
  const byType = (type: string) => ops.find((op) => op.type === type) ?? null;
  return {
    order,
    create: byType("create"),
    cancel: byType("cancel"),
    invoice: byType("invoice"),
    payment: byType("payment"),
    hasManualReviewOp: ops.some((op) => op.status === "manual_review"),
  };
}

/**
 * The ticket #03 target, derived in this module: committed
 * `ready_for_pickup` plus a VERIFIED invoice and payment. Anything else is
 * not a `Siap Proses` mirror trigger.
 */
export function isSiapProsesTargetApplicable(context: MirrorContext): boolean {
  return (
    context.order.status === "ready_for_pickup" &&
    context.create?.status === "confirmed" &&
    isSafePositiveInteger(context.create.salesOrderId) &&
    context.invoice?.status === "confirmed" &&
    isSafePositiveInteger(context.invoice.invoiceId) &&
    context.payment?.status === "confirmed" &&
    isSafePositiveInteger(context.payment.paymentId)
  );
}

/**
 * Ticket #06 target: a COMMITTED local `completed` order (only reachable
 * AFTER pickup — the completion path requires `ready_for_pickup`) plus the
 * same verified invoice+payment ledger. The verified trio keeps the
 * fail-closed pre-edit cross-check meaningful (the SO must still match the
 * verified ledger); a completed order whose ledger is not provably verified
 * is never mirror-eligible (skipped, zero POST). A merely `paid` Midtrans
 * status or the pickup-verification HTTP outcome alone is NEVER a trigger.
 */
export function isSelesaiTargetApplicable(context: MirrorContext): boolean {
  return (
    context.order.status === "completed" &&
    context.create?.status === "confirmed" &&
    isSafePositiveInteger(context.create.salesOrderId) &&
    context.invoice?.status === "confirmed" &&
    isSafePositiveInteger(context.invoice.invoiceId) &&
    context.payment?.status === "confirmed" &&
    isSafePositiveInteger(context.payment.paymentId)
  );
}

/**
 * Ticket #04: `Menunggu Verifikasi` is applicable ONLY from committed state:
 * a PAID order still held in `processing` (never fulfilled) whose committed
 * state evidences a settlement manual review or an explicit operator
 * investigation block — a non-null `fulfillment_blocked_reason` (set ONLY by
 * the committed settlement/late-settlement review paths) or a committed
 * `manual_review` ledger operation. A short pending/in-flight settlement
 * (ops merely `intent`/`dispatched_unknown`, no block) and the implicit
 * admin-queue membership of EVERY processing+paid order are NOT triggers.
 * A confirmed create with a known SO id is required: the marker edit always
 * targets a KNOWN Sales Order.
 */
export function isMenungguVerifikasiTargetApplicable(
  context: MirrorContext
): boolean {
  return (
    context.order.status === "processing" &&
    context.order.paymentStatus === "paid" &&
    context.create?.status === "confirmed" &&
    isSafePositiveInteger(context.create.salesOrderId) &&
    (context.order.fulfillmentBlockedReason != null ||
      context.hasManualReviewOp)
  );
}

/**
 * The single derivation point for the mirror target: the committed local
 * state decides between `Siap Proses` (ready + verified invoice/payment),
 * `Menunggu Verifikasi` (paid-but-blocked for operator investigation),
 * `Gagal Bayar` (committed failed_payment with a provably safe-to-edit SO),
 * `Selesai` (committed completed after pickup, ticket #06) or no trigger at
 * all. The derivation is mutually exclusive by order status; `Dibatalkan` is
 * deliberately NOT derivable here: no lawful runtime `cancelled` writer
 * exists, so a committed `cancelled` order is handled by the pending-terminal
 * supersede only (mapping contract,
 * `channelStatusMarkerForTerminalLocalOrderStatus`).
 */
export function deriveChannelStatusTarget(
  context: MirrorContext
): DerivedChannelStatusTarget | null {
  if (isSelesaiTargetApplicable(context)) return CHANNEL_STATUS_SELESAI;
  if (isSiapProsesTargetApplicable(context)) return CHANNEL_STATUS_SIAP_PROSES;
  if (isMenungguVerifikasiTargetApplicable(context)) {
    return CHANNEL_STATUS_MENUNGGU_VERIFIKASI;
  }
  if (isGagalBayarTargetApplicable(context)) return CHANNEL_STATUS_GAGAL_BAYAR;
  return null;
}

/**
 * Ticket #05: the Sales-Order CANCEL path is ACTIVE when a committed cancel
 * ledger operation exists in `intent`, `dispatched_unknown` (possibly
 * sent), `confirmed` (applied) or `manual_review` (ambiguous) state. A
 * `rejected` operation is a definitive pre-apply refusal (the write was
 * provably never attempted and the SO remains active) and `aborted` was
 * locally abandoned while still an unsent intent — neither can hold a
 * cancel write in flight, so the Sales Order remains provably safe to edit
 * (still subject to the strict pre-read GET, which fail-closes an SO that
 * was canceled remotely anyway).
 */
const ACTIVE_CANCEL_STATUSES = [
  "intent",
  "dispatched_unknown",
  "confirmed",
  "manual_review",
] as const;

export function isCancelPathActive(cancel: JubelioSalesOperation | null): boolean {
  return (
    cancel != null &&
    (ACTIVE_CANCEL_STATUSES as readonly string[]).includes(cancel.status)
  );
}

/**
 * Ticket #05: `Gagal Bayar` is applicable ONLY from committed state: a
 * locally committed `failed_payment` + `failed` order whose confirmed
 * create carries a known SO id AND whose Sales-Order cancel path never
 * started (no cancel ledger operation, or one that was definitively
 * refused/abandoned before applying). A started or applied cancel path
 * makes the SO unsafe to edit for the failed-payment marker — see
 * `isGagalBayarBlockedByStartedCancel`.
 */
export function isGagalBayarTargetApplicable(context: MirrorContext): boolean {
  return (
    context.order.status === "failed_payment" &&
    context.order.paymentStatus === "failed" &&
    context.create?.status === "confirmed" &&
    isSafePositiveInteger(context.create.salesOrderId) &&
    !isCancelPathActive(context.cancel)
  );
}

/**
 * Ticket #05: a committed `failed_payment` order whose Sales-Order cancel
 * path STARTED (intent recorded, maybe-sent) or was CONFIRMED can never be
 * edited for the `Gagal Bayar` marker — even an existing pending mirror
 * intent must not be dispatched. The disposition is a durable, PII-safe,
 * findable mismatch (`GAGAL_BAYAR_CANCEL_STARTED`), with the Status Channel
 * possibly left at `Belum Bayar`; the cancel/hold release is never delayed
 * or reverted for the mirror.
 */
export function isGagalBayarBlockedByStartedCancel(
  context: MirrorContext
): boolean {
  return (
    context.order.status === "failed_payment" &&
    context.order.paymentStatus === "failed" &&
    context.create?.status === "confirmed" &&
    isSafePositiveInteger(context.create.salesOrderId) &&
    isCancelPathActive(context.cancel)
  );
}

/**
 * The invoice id the pre-edit cross-check compares the remote SO's invoice
 * link against: the ledger-persisted id when the invoice operation carries
 * one (verified for `Siap Proses` targets; the conversion-persisted id for
 * `Menunggu Verifikasi` targets whose settlement is still in manual
 * review), otherwise NULL — in which case the remote SO must have NO invoice
 * link (any remote link the ledger does not know of fails closed).
 */
function ledgerInvoiceIdForPreRead(context: MirrorContext): number | null {
  const id = context.invoice?.invoiceId;
  return isSafePositiveInteger(id) ? id : null;
}

/**
 * Fail-closed cross-check of a strict pre-edit GET against the verified
 * ledger: identity/location, note, ref_no, invoice link, item lines
 * (identity, quantity, unit, tax, price, amount) and money must all match
 * the persisted create intent and the verified invoice id. Source (INTERNAL),
 * positive detail ids and the zero-disc/zero-tax/zero-fee envelope are
 * enforced by the gateway's strict pre-read parse. Returns a PII-safe reason
 * code on any divergence (the caller performs ZERO POST) or null when the
 * pre-read is safe to edit.
 */
export function mirrorPreReadMismatch(input: {
  snapshot: JubelioSalesOrderEditSnapshot;
  create: JubelioSalesOperation | null;
  /** Ledger-persisted invoice id, or null when the ledger has none. */
  verifiedInvoiceId: number | null;
}): string | null {
  const snapshot = input.snapshot;
  if (
    input.create?.status !== "confirmed" ||
    input.create.payload?.type !== "create"
  ) {
    return "PRE_READ_NO_VERIFIED_CREATE";
  }
  const request = input.create.payload.create;
  if (snapshot.isCanceled) {
    return "PRE_READ_SO_CANCELED";
  }
  if (
    snapshot.contactId !== request.contactId ||
    snapshot.locationId !== request.locationId
  ) {
    return "PRE_READ_CONTACT_OR_LOCATION_MISMATCH";
  }
  if (snapshot.note !== request.note) {
    return "PRE_READ_NOTE_MISMATCH";
  }
  if (snapshot.refNo !== (request.refNo ?? "")) {
    return "PRE_READ_REF_MISMATCH";
  }
  if ((snapshot.invoiceId ?? null) !== input.verifiedInvoiceId) {
    return "PRE_READ_INVOICE_LINK_MISMATCH";
  }
  if (request.items.length === 0 || request.items.length !== snapshot.items.length) {
    return "PRE_READ_ITEM_LINE_COUNT_MISMATCH";
  }
  const requestLines = [...request.items].sort((a, b) => a.itemId - b.itemId);
  const remoteLines = [...snapshot.items].sort((a, b) => a.itemId - b.itemId);
  for (let index = 0; index < requestLines.length; index++) {
    const requested = requestLines[index];
    const remote = remoteLines[index];
    if (
      remote.itemId !== requested.itemId ||
      remote.quantity !== requested.quantity ||
      remote.unit !== requested.unit ||
      remote.taxId !== requested.taxId ||
      remote.price !== requested.price ||
      // Same safe epsilon comparator as the gateway post-edit confirmation:
      // serialization noise is tolerated, a MATERIAL amount change is not.
      !moneyEqualsSafe(remote.amount, requested.price * requested.quantity)
    ) {
      return "PRE_READ_ITEM_MISMATCH";
    }
  }
  const expectedSubTotal = request.items.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0
  );
  if (
    !moneyEqualsSafe(snapshot.subTotal, expectedSubTotal) ||
    !moneyEqualsSafe(snapshot.grandTotal, snapshot.subTotal)
  ) {
    return "PRE_READ_MONEY_MISMATCH";
  }
  return null;
}

/**
 * GET-only recovery of a possibly-sent edit: read the SO by the persisted SO
 * id; when the target marker is observable AND the core attributes still
 * match the verified ledger, confirm — otherwise record an investigation
 * case. NEVER a re-POST.
 */
async function recoverPossiblySentIntent(input: {
  db: ChannelMirrorDb;
  intent: JubelioChannelStatusIntent;
  context: MirrorContext;
  gateway: JubelioSalesGateway;
  log: Logger;
}): Promise<ReconcileChannelStatusOutcome> {
  const { db, intent, context, gateway, log } = input;
  try {
    const snapshot = await gateway.getSalesOrderForEdit(intent.salesOrderId);
    const mismatch = mirrorPreReadMismatch({
      snapshot,
      create: context.create,
      verifiedInvoiceId: ledgerInvoiceIdForPreRead(context),
    });
    const observed = snapshot.channelStatus ?? "";
    // The confirmation compares the GET against the intent's OWN target —
    // never a hardcoded marker — so a future target cannot false-confirm.
    if (!mismatch && snapshot.channelStatus === intent.targetStatus) {
      const confirmed = await markJubelioChannelStatusIntentConfirmed(db, intent.id, {
        observedStatus: observed,
      });
      if (confirmed) {
        log.info("channel-status edit recovered by GET", {
          salesOrderId: intent.salesOrderId,
          targetVersion: intent.targetVersion,
        });
        return { status: "confirmed", intent: confirmed };
      }
      return { status: "in_flight", message: "Recovery claim was lost", intent };
    }
    // GET does not show the (complete) target: unknown or mismatched
    // outcome — investigation, never a re-POST.
    const reviewed = await markJubelioChannelStatusIntentNeedsInvestigation(
      db,
      intent.id,
      {
        reason: mismatch ?? "RECOVERY_MARKER_NOT_OBSERVED",
        observedStatus: observed,
      }
    );
    log.error("channel-status recovery found no confirmed target — investigation recorded", {
      salesOrderId: intent.salesOrderId,
      reason: mismatch ?? "RECOVERY_MARKER_NOT_OBSERVED",
    });
    if (reviewed) {
      return { status: "needs_investigation", message: "Recovery mismatch", intent: reviewed };
    }
    return { status: "in_flight", message: "Recovery claim was lost", intent };
  } catch (error) {
    const classified = classifyGatewayError(error);
    log.warn("channel-status recovery GET failed", {
      salesOrderId: intent.salesOrderId,
      error: serializeError(error),
    });
    if (classified.kind === "ambiguous" || classified.kind === "transient") {
      // Ambiguous or transient GET failure: stay possibly_sent; the next
      // bounded sweep retries GET-only (never a re-POST).
      return { status: "in_flight", message: classified.message, intent };
    }
    const reviewed = await markJubelioChannelStatusIntentNeedsInvestigation(
      db,
      intent.id,
      {
        reason: safeLocalEditCode(classified.code) ?? "RECOVERY_GET_FAILED",
      }
    );
    if (reviewed) {
      return { status: "needs_investigation", message: classified.message, intent: reviewed };
    }
    return { status: "in_flight", message: classified.message, intent };
  }
}

/**
 * How long a freshly claimed (`possibly_sent`) intent is left alone before a
 * competing caller may GET-reconcile it. A fresh claim's owner may still be
 * between claim and POST: a premature GET verdict could bury a live edit as
 * `needs_investigation`. Aged claims are GET-reconciled (never re-POSTed),
 * so crash recovery does not wait forever; the sweep drives the same cutoff.
 */
export const CHANNEL_STATUS_MIRROR_STALE_CUTOFF_MS = 15 * 60_000;

/**
 * The static, PII-safe reason recorded when the committed `failed_payment`
 * state's Sales-Order cancel path has STARTED (intent recorded, maybe-sent)
 * or was CONFIRMED: the `Gagal Bayar` marker edit must never be attempted
 * (zero POST, zero GET), the Status Channel possibly stays `Belum Bayar`,
 * and the case remains findable by order/SO. The cancel/hold release is
 * never delayed or reverted for the mirror (ticket #05).
 */
export const GAGAL_BAYAR_CANCEL_STARTED = "GAGAL_BAYAR_CANCEL_STARTED";

/**
 * ATOMIC pending→aborted disposition for a pending channel-status intent
 * whose committed failed_payment order's Sales-Order cancel path is ACTIVE
 * (ticket #05): guarded to `pending` with the committed cancel-active
 * evidence checked IN THE SAME statement (fail-closed against a raced
 * cancel resolution — if the cancel path is no longer active at write time,
 * the disposition is refused and the caller retries; the intent then flows
 * through the ordinary derivation). Exactly one of dispatch claim / this
 * abort wins per row; zero edit POST, zero GET.
 */
export async function abortPendingIntentForStartedCancel(
  db: ChannelMirrorDb,
  intentId: string
): Promise<JubelioChannelStatusIntent | null> {
  const updated = await db
    .update(jubelioChannelStatusIntents)
    .set({
      status: "aborted",
      mismatchReason: GAGAL_BAYAR_CANCEL_STARTED,
      mismatchAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(jubelioChannelStatusIntents.id, intentId),
        eq(jubelioChannelStatusIntents.status, "pending"),
        exists(
          db
            .select({ one: sql`1` })
            .from(orders)
            .where(
              and(
                eq(orders.id, jubelioChannelStatusIntents.orderId),
                eq(orders.status, "failed_payment"),
                eq(orders.paymentStatus, "failed"),
                exists(
                  db
                    .select({ one: sql`1` })
                    .from(jubelioSalesOperations)
                    .where(
                      and(
                        eq(jubelioSalesOperations.orderId, jubelioChannelStatusIntents.orderId),
                        eq(jubelioSalesOperations.type, "cancel"),
                        inArray(jubelioSalesOperations.status, ACTIVE_CANCEL_STATUSES)
                      )
                    )
                )
              )
            )
        )
      )
    )
    .returning();
  return updated[0] ?? null;
}

/**
 * Ticket #05 disposition for a committed failed_payment order whose
 * Sales-Order cancel path started/maybe-sent/was confirmed: NO `Gagal
 * Bayar` edit may ever be attempted. An existing PENDING mirror intent is
 * durably aborted with the PII-safe reason; when no pending intent exists,
 * the intended `Gagal Bayar` target is recorded as the monotonic next
 * version and immediately aborted with the same reason (deduped per order,
 * so re-runs never stack rows). Zero edit POST, zero GET. The outcome is
 * skipped (reason `cancel_started`); a lost race returns in_flight for a
 * later retry.
 */
async function cancelBlockedGagalBayarDisposition(
  db: ChannelMirrorDb,
  context: MirrorContext,
  orderId: string,
  log: Logger
): Promise<ReconcileChannelStatusOutcome> {
  const salesOrderId = context.create?.salesOrderId;
  const latest = await getLatestJubelioChannelStatusIntent(db, orderId);
  if (latest?.status === "pending") {
    const aborted = await abortPendingIntentForStartedCancel(db, latest.id);
    if (aborted) {
      log.warn(
        "gagal bayar marker withheld — Sales-Order cancel path started (durable mismatch recorded)",
        {
          orderId,
          salesOrderId: latest.salesOrderId,
          staleTarget: latest.targetStatus,
          supersededVersion: latest.targetVersion,
        }
      );
      return { status: "skipped", reason: "cancel_started" };
    }
    // Race: the committed cancel path resolved between the read and the
    // write — do nothing here; the next reconcile re-derives the state.
    return {
      status: "in_flight",
      message: "Pending intent not superseded by the started cancel path",
      intent: latest,
    };
  }
  if (latest && (latest.status === "possibly_sent" || latest.status === "needs_investigation" || latest.status === "rejected")) {
    // An already-dispatched (GET-only recovery), investigated or rejected
    // intent is already durable and findable; no stacked record.
    return { status: "skipped", reason: "cancel_started" };
  }
  // No pending intent (none, or a settled one): record the intended Gagal
  // Bayar target and immediately abort it — the durable, findable mismatch
  // that the marker was withheld because the cancel path started. Deduped
  // per order: an existing record with the same reason is never duplicated.
  const existingRecords = await db
    .select({ id: jubelioChannelStatusIntents.id })
    .from(jubelioChannelStatusIntents)
    .where(
      and(
        eq(jubelioChannelStatusIntents.orderId, orderId),
        eq(jubelioChannelStatusIntents.status, "aborted"),
        eq(jubelioChannelStatusIntents.mismatchReason, GAGAL_BAYAR_CANCEL_STARTED)
      )
    )
    .limit(1);
  if (existingRecords.length > 0) {
    return { status: "skipped", reason: "cancel_started" };
  }
  const recorded = await recordJubelioChannelStatusIntent(db, {
    orderId,
    salesOrderId: salesOrderId as number,
    targetStatus: CHANNEL_STATUS_GAGAL_BAYAR,
  });
  if (recorded.intent.status !== "pending") {
    return { status: "in_flight", message: "Intent raced", intent: recorded.intent };
  }
  const aborted = await abortPendingIntentForStartedCancel(db, recorded.intent.id);
  if (!aborted) {
    // The committed cancel path resolved mid-disposition: the pending
    // intent is left in place; the next reconcile re-derives the (possibly
    // now safe-to-edit) state and dispatches normally.
    return {
      status: "in_flight",
      message: "Cancel path resolved while recording the withheld marker",
      intent: recorded.intent,
    };
  }
  log.warn("gagal bayar marker withheld — Sales-Order cancel path started (durable mismatch recorded)", {
    orderId,
    salesOrderId,
    supersededVersion: recorded.intent.targetVersion,
  });
  return { status: "skipped", reason: "cancel_started" };
}

/**
 * Public per-order seam (ticket #03, generalized by #04/#05): project the
 * committed local state of one order onto the Jubelio Status Channel — at
 * most one edit per intent, fail-closed, crash-tolerant, and never
 * interfering with payment/pickup.
 */
export async function reconcileJubelioChannelStatusForOrder(
  db: ChannelMirrorDb,
  input: {
    orderId: string;
    gateway?: JubelioSalesGateway;
    logger?: Logger;
    /** Test/sweep override for the fresh-claim in-flight guard cutoff. */
    staleCutoffMs?: number;
  }
): Promise<ReconcileChannelStatusOutcome> {
  const log =
    input.logger?.child({ orderId: input.orderId, module: "jubelio-channel-mirror" }) ??
    createLogger({ module: "jubelio-channel-mirror", orderId: input.orderId });
  const context = await loadMirrorContext(db, input.orderId);
  if (!context || !context.create) {
    return { status: "skipped", reason: "not_eligible" };
  }
  const derivedTarget = deriveChannelStatusTarget(context);
  if (!derivedTarget) {
    // Ticket #05: a committed failed_payment order whose Sales-Order cancel
    // path started/maybe-sent/was confirmed can never be edited for the
    // `Gagal Bayar` marker — durably record the PII-safe mismatch (an
    // existing pending intent is aborted atomically; a fresh intent is
    // recorded and immediately aborted, deduped per order) instead of any
    // edit. Zero POST, zero GET; the cancel/hold release is untouched.
    if (isGagalBayarBlockedByStartedCancel(context)) {
      return cancelBlockedGagalBayarDisposition(db, context, input.orderId, log);
    }
    // Neither a committed ready+verified state (`Siap Proses`) nor a
    // paid-but-blocked operator investigation (`Menunggu Verifikasi`): a
    // short pending/in-flight settlement or a mere admin-queue membership
    // is NOT a mirror trigger (no intent created).
    return { status: "skipped", reason: "not_eligible" };
  }
  const salesOrderId = context.create.salesOrderId as number;
  const verifiedInvoiceId = ledgerInvoiceIdForPreRead(context);

  const latest = await getLatestJubelioChannelStatusIntent(db, input.orderId);
  if (latest) {
    if (latest.status === "confirmed") {
      if (latest.targetStatus === derivedTarget) {
        return { status: "skipped", reason: "already_confirmed" };
      }
      // Ticket #06 ordering: never overwrite a confirmed LATER forward
      // stage with an earlier one (no backward marker overwrite). A
      // confirmed target outside the linear chain (e.g. Gagal Bayar, #05)
      // never blocks the projection of the latest committed state.
      if (isChannelTargetRegression(latest.targetStatus, derivedTarget)) {
        return { status: "skipped", reason: "already_confirmed" };
      }
      // A CONFIRMED stale target (e.g. a resolved `Menunggu Verifikasi`
      // investigation whose order is now committed ready_for_pickup, or a
      // confirmed `Siap Proses` whose order later completed, #06) is
      // history, never authority: the monotonic NEXT version targets the
      // derived state below. A possibly-sent/confirmed old intent can never
      // be overwritten by an older outcome.
    } else if (latest.status === "needs_investigation") {
      // Only an explicit operator action may move past an unresolved case.
      return { status: "skipped", reason: "investigation_open" };
    } else if (latest.status === "possibly_sent") {
      // IN-FLIGHT GUARD: a FRESH claim is never GET-reconciled by a
      // competing caller — the owner may be between the claim and the
      // edit/GET, and a premature verdict could bury a live edit as an
      // investigation case. Aged claims are GET-reconciled below (never
      // re-POSTed), so a crashed owner does not block recovery forever.
      const dispatchedAtMs = latest.dispatchedAt?.getTime() ?? 0;
      if (
        Date.now() - dispatchedAtMs <
        (input.staleCutoffMs ?? CHANNEL_STATUS_MIRROR_STALE_CUTOFF_MS)
      ) {
        return {
          status: "in_flight",
          message: "A channel edit dispatch is freshly in flight",
          intent: latest,
        };
      }
      return recoverPossiblySentIntent({
        db,
        intent: latest,
        context,
        gateway: input.gateway ?? getDefaultJubelioChannelMirrorGateway(),
        log,
      });
    }
    if (latest.status === "rejected") {
      // A definitive pre-apply rejection is terminal for this intent; a new
      // dispatch requires an explicit owner decision (stage-2 policy).
      return {
        status: "rejected",
        message: latest.lastError ?? "Channel edit was rejected earlier",
        intent: latest,
      };
    }
  }

  let intent: JubelioChannelStatusIntent;
  if (latest?.status === "pending" && latest.targetStatus === derivedTarget) {
    // A pending intent for the CURRENT derived target is the only dispatchable
    // state (at most one POST per intent).
    intent = latest;
  } else if (latest?.status === "pending") {
    // STALE PENDING TARGET (ticket #04): a pending intent whose target no
    // longer matches the committed local state was NEVER dispatched — the
    // committed state supersedes it. The supersede is ATOMIC and correlated
    // to the committed evidence of the NEW target (fail-closed against a
    // raced order transition): pending → aborted with the static PII-safe
    // reason. Zero edit POST, zero GET for the stale intent; the derived
    // target is then recorded as the monotonic NEXT version.
    const superseded = await supersedeStalePendingChannelStatusIntent(db, {
      intentId: latest.id,
      targetStatus: derivedTarget,
    });
    if (!superseded) {
      log.warn("stale pending channel intent not superseded — committed state changed", {
        orderId: input.orderId,
        staleTarget: latest.targetStatus,
        derivedTarget,
      });
      return {
        status: "in_flight",
        message: "Stale pending intent not superseded",
        intent: latest,
      };
    }
    log.info("stale pending channel intent superseded by the committed local state", {
      orderId: input.orderId,
      staleTarget: latest.targetStatus,
      supersededVersion: latest.targetVersion,
      derivedTarget,
    });
    const recorded = await recordJubelioChannelStatusIntent(db, {
      orderId: input.orderId,
      salesOrderId,
      targetStatus: derivedTarget,
    });
    intent = recorded.intent;
    if (intent.status !== "pending") {
      // Another caller created/advanced the intent between the read and the
      // insert; reconcile against its actual state on the next call.
      return { status: "in_flight", message: "Intent raced", intent };
    }
  } else {
    const recorded = await recordJubelioChannelStatusIntent(db, {
      orderId: input.orderId,
      salesOrderId,
      targetStatus: derivedTarget,
    });
    intent = recorded.intent;
    if (intent.status !== "pending") {
      // Another caller created/advanced the intent between the read and the
      // insert; reconcile against its actual state on the next call.
      return { status: "in_flight", message: "Intent raced", intent };
    }
  }

  // Ticket #05 parent-review correction: the Gagal Bayar dispatch claim
  // is CANCEL-AWARE — it re-checks the committed cancel-active evidence in
  // the SAME statement, so a cancel path that started after the eligibility
  // read can never grant the marker POST. On a cancel refusal the pending
  // intent is dispositioned (durable PII-safe mismatch) with zero POST/GET.
  const claimed =
    derivedTarget === CHANNEL_STATUS_GAGAL_BAYAR
      ? await claimJubelioChannelStatusIntentForGagalBayarDispatch(db, intent.id)
      : await claimJubelioChannelStatusIntentForDispatch(db, intent.id);
  if (!claimed.claimed || !claimed.intent) {
    if (
      derivedTarget === CHANNEL_STATUS_GAGAL_BAYAR &&
      claimed.reason === "cancel_started"
    ) {
      return cancelBlockedGagalBayarDisposition(db, context, input.orderId, log);
    }
    return { status: "in_flight", message: "Dispatch claim lost", intent };
  }
  const claimedIntent = claimed.intent;
  const gateway = input.gateway ?? getDefaultJubelioChannelMirrorGateway();

  // Strict pre-edit read; a read failure is NEVER classified as success.
  let preRead: JubelioSalesOrderEditSnapshot;
  try {
    preRead = await gateway.getSalesOrderForEdit(salesOrderId);
  } catch (error) {
    const classified = classifyGatewayError(error);
    if (classified.kind === "ambiguous" || classified.kind === "transient") {
      // Ambiguous (timeout/network) or transient (5xx/429 read) pre-read
      // failure after the claim: the edit was NOT yet attempted — keep the
      // claim possibly_sent so the sweep retries with an aged GET-only
      // pass. Never an investigation for a transient read failure.
      log.warn("channel edit pre-read failed transiently — stays possibly_sent", {
        salesOrderId,
        error: serializeError(error),
      });
      return { status: "in_flight", message: classified.message, intent: claimedIntent };
    }
    // Definitive read failure (incomplete shape / canceled / unknown SO):
    // zero POST, durable PII-safe investigation with the gateway code.
    const reviewed = await markJubelioChannelStatusIntentNeedsInvestigation(
      db,
      claimedIntent.id,
      {
        reason: safeLocalEditCode(classified.code) ?? "PRE_READ_FAILED",
      }
    );
    log.error("channel edit pre-read failed closed — investigation recorded", {
      salesOrderId,
      reason: safeLocalEditCode(classified.code) ?? "PRE_READ_FAILED",
    });
    if (reviewed) {
      return { status: "needs_investigation", message: classified.message, intent: reviewed };
    }
    return { status: "in_flight", message: classified.message, intent: claimedIntent };
  }

  // Fail-closed cross-check against the verified ledger.
  const preMismatch = mirrorPreReadMismatch({
    snapshot: preRead,
    create: context.create,
    verifiedInvoiceId,
  });
  if (preMismatch) {
    const reviewed = await markJubelioChannelStatusIntentNeedsInvestigation(
      db,
      claimedIntent.id,
      { reason: preMismatch, observedStatus: preRead.channelStatus }
    );
    log.error("channel edit pre-read mismatch — zero POST, investigation recorded", {
      salesOrderId,
      reason: preMismatch,
    });
    if (reviewed) {
      return { status: "needs_investigation", message: preMismatch, intent: reviewed };
    }
    return { status: "in_flight", message: preMismatch, intent: claimedIntent };
  }

  // Persist the verified full-payload snapshot BEFORE the single POST.
  const persisted = await persistJubelioChannelStatusEditSnapshot(
    db,
    claimedIntent.id,
    {
      salesorderId: preRead.salesorderId,
      salesorderNo: preRead.salesorderNo,
      contactId: preRead.contactId,
      customerName: preRead.customerName,
      transactionDate: preRead.transactionDate,
      isTaxIncluded: preRead.isTaxIncluded,
      note: preRead.note,
      refNo: preRead.refNo,
      locationId: preRead.locationId,
      source: preRead.source,
      channelStatus: derivedTarget,
      subTotal: preRead.subTotal,
      totalDisc: preRead.totalDisc,
      totalTax: preRead.totalTax,
      grandTotal: preRead.grandTotal,
      addFee: preRead.addFee,
      addDisc: preRead.addDisc,
      serviceFee: preRead.serviceFee,
      items: preRead.items,
    }
  );
  if (!persisted) {
    return {
      status: "in_flight",
      message: "Claim lost before the edit POST",
      intent: claimedIntent,
    };
  }

  // Ticket #05 parent-review correction: the LAST safe pre-POST boundary.
  // The pre-read GET may have taken time; re-read the COMMITTED cancel
  // state immediately before the edit POST. When the Sales-Order cancel
  // path became active in that window, the owner performs ZERO provider
  // writes and durably aborts its OWN claim with the PII-safe
  // `GAGAL_BAYAR_CANCEL_STARTED` reason (the owner provably has not POSTed
  // yet, so at-most-once is preserved). Inherent residual: the vendor has
  // no compare-and-swap, so a cancel claimed/applied in the remaining
  // re-check→POST gap (or between the GET and POST at the provider) can
  // still race the marker edit — an owner-accepted residual risk from the
  // spec, mitigated by this latest possible re-check.
  if (derivedTarget === CHANNEL_STATUS_GAGAL_BAYAR) {
    const freshCancelOp = await loadCancelOpForOrder(db, input.orderId);
    if (isCancelPathActive(freshCancelOp)) {
      const aborted = await abortClaimedIntentForStartedCancel(db, claimedIntent.id);
      if (aborted) {
        log.warn(
          "gagal bayar marker withheld at the pre-POST boundary — Sales-Order cancel path started (zero POST)",
          { orderId: input.orderId, salesOrderId }
        );
        return { status: "skipped", reason: "cancel_started" };
      }
      // The claim was lost between the claim and the re-check (or raced):
      // do nothing here; GET-only recovery re-derives the state safely.
      return {
        status: "in_flight",
        message: "Cancel path started before the edit POST",
        intent: claimedIntent,
      };
    }
  }


  try {
    const result = await gateway.editSalesOrder({
      edit: preRead,
      targetChannelStatus: derivedTarget,
      operationId: claimedIntent.id,
    });
    const confirmed = await markJubelioChannelStatusIntentConfirmed(
      db,
      claimedIntent.id,
      {
        observedStatus: result.order.channelStatus ?? derivedTarget,
      }
    );
    if (!confirmed) {
      return {
        status: "in_flight",
        message: "Claim lost at confirmation",
        intent: claimedIntent,
      };
    }
    log.info("channel status edit confirmed by GET", {
      salesOrderId,
      targetVersion: claimedIntent.targetVersion,
    });
    return { status: "confirmed", intent: confirmed };
  } catch (error) {
    const classified = classifyGatewayError(error);
    if (classified.kind === "ambiguous") {
      log.error(
        "channel edit outcome unknown — stays possibly_sent for GET-only recovery",
        { salesOrderId, error: serializeError(error) }
      );
      return { status: "in_flight", message: classified.message, intent: claimedIntent };
    }
    // Discriminate a LOCAL builder fail-closed refusal from a REMOTE provider
    // rejection: the local refusal is thrown BEFORE any provider HTTP
    // response exists (httpStatus undefined) AND its code is a known local
    // constant — never trusted from a prefix or from provider body.code.
    const localRefusalCode =
      error instanceof JubelioSalesGatewayError &&
      error.options.httpStatus === undefined
        ? safeLocalEditCode(error.options.code)
        : undefined;
    if (localRefusalCode !== undefined) {
      // A LOCAL fail-closed data-shape refusal inside the gateway (incomplete
      // shape, canceled SO, non-INTERNAL source, unevidenced money, invalid
      // target): the write was provably never attempted, but this is a data
      // problem to investigate — never a "harmless provider rejection".
      const reviewed = await markJubelioChannelStatusIntentNeedsInvestigation(
        db,
        claimedIntent.id,
        { reason: localRefusalCode }
      );
      log.error("channel edit failed closed locally — investigation recorded", {
        salesOrderId,
        reason: localRefusalCode,
      });
      if (reviewed) {
        return {
          status: "needs_investigation",
          message: classified.message,
          intent: reviewed,
        };
      }
      return { status: "in_flight", message: classified.message, intent: claimedIntent };
    }
    const rejected = await markJubelioChannelStatusIntentRejectedAfterClaim(
      db,
      claimedIntent.id,
      // Durable last_error is a STATIC code — the provider body.code is
      // never persisted; the dynamic message stays on the returned outcome
      // only.
      { reason: "EDIT_PROVIDER_REJECTED" }
    );
    log.warn("channel edit definitively rejected", { salesOrderId });
    if (rejected) {
      return { status: "rejected", message: classified.message, intent: rejected };
    }
    return { status: "in_flight", message: classified.message, intent: claimedIntent };
  }
}
/**
 * The static, PII-safe reason recorded when a never-dispatched pending
 * intent is superseded because the local committed order went terminal
 * (completed / cancelled / failed_payment). The marker target it intended
 * is stale; a later target records its own newer version.
 */
export const PENDING_TERMINAL_SUPERSEDED = "PENDING_TERMINAL_SUPERSEDED";

/**
 * ATOMIC pending→aborted disposition (ticket #03 final acceptance): a
 * pending intent whose local committed order went TERMINAL is durably
 * superseded — zero edit POST, zero GET. Guarded to `pending` by the same
 * conditional UPDATE the dispatch claim uses, so exactly one of claim/abort
 * wins per row: a possibly_sent intent is NEVER aborted (it belongs to
 * GET-only recovery), and a claimed write can never be retro-aborted. The
 * caller re-reads the committed local order state at the write boundary.
 *
 * Ticket #05: `failed_payment` orders are NO LONGER blanket-terminal for
 * the channel mirror — the `Gagal Bayar` derivation/window now governs
 * them (a safe Sales Order is edited for `Gagal Bayar`; a started cancel
 * path records the durable `GAGAL_BAYAR_CANCEL_STARTED` mismatch instead).
 * Only `completed` / `cancelled` orders remain blanket-terminal here.
 *
 * Ticket #06: the SAME conditional UPDATE spares a pending `Selesai` intent
 * whose committed order is `completed` AND `paid` AND whose Sales-Order
 * ledger is fully verified with POSITIVE persisted ids (confirmed create
 * with `sales_order_id > 0`, confirmed invoice with `invoice_id > 0`,
 * confirmed payment with `payment_id > 0` — the schema only forbids NULL,
 * so `isNotNull` would wrongly spare a confirmed id-0 row) —
 * that pending target IS the current projection (it dispatches through the
 * per-order seam / missed scan; it is never aborted here or by any direct
 * caller). A pending `Selesai` intent whose ledger is not provably
 * verified (or a malformed verified row, e.g. a confirmed payment with a
 * NULL `payment_id`) is still terminal-superseded — the dispatch would
 * fail closed anyway. The exemption is re-evaluated at WRITE time, so an
 * order whose ledger completes between a sweep scan and this write is
 * spared, never aborted (scan→write eligibility race, ticket #06).
 */
export async function abortPendingTerminalChannelStatusIntent(
  db: ChannelMirrorDb,
  intentId: string
): Promise<JubelioChannelStatusIntent | null> {
  const updated = await db
    .update(jubelioChannelStatusIntents)
    .set({
      status: "aborted",
      mismatchReason: PENDING_TERMINAL_SUPERSEDED,
      mismatchAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(jubelioChannelStatusIntents.id, intentId),
        eq(jubelioChannelStatusIntents.status, "pending"),
        // Correlated committed-terminal condition IN THE SAME statement: the
        // abort is atomic against a raced order transition — an order that is
        // (or has just become) ready_for_pickup at write time is NEVER
        // aborted; the sweep simply re-dispositions or dispatches it later.
        exists(
          db
            .select({ one: sql`1` })
            .from(orders)
            .where(
              and(
                eq(orders.id, jubelioChannelStatusIntents.orderId),
                // Ticket #05: failed_payment orders are no longer
                // blanket-terminal — their pending intents flow through the
                // per-order derivation (Gagal Bayar dispatch for a safe
                // Sales Order, or the started-cancel mismatch record).
                inArray(orders.status, [
                  "completed",
                  "cancelled",
                ])
              )
            )
        ),
        // Ticket #06: spare a pending `Selesai` intent only when the order is
        // completed AND paid AND the SO ledger is fully verified with the
        // positive persisted ids (the equivalent of
        // `not(and(completed, Selesai, verified trio with positive ids))`,
        // written as a disjunction of self-contained clauses so every arm
        // resolves inside the UPDATE's WHERE without a join).
        or(
          notExists(
            db
              .select({ one: sql`1` })
              .from(orders)
              .where(
                and(
                  eq(orders.id, jubelioChannelStatusIntents.orderId),
                  eq(orders.status, "completed"),
                  eq(orders.paymentStatus, "paid")
                )
              )
          ),
          ne(jubelioChannelStatusIntents.targetStatus, CHANNEL_STATUS_SELESAI),
          notExists(
            db
              .select({ one: sql`1` })
              .from(jubelioSalesOperations)
              .where(
                and(
                  eq(jubelioSalesOperations.orderId, jubelioChannelStatusIntents.orderId),
                  eq(jubelioSalesOperations.type, "create"),
                  eq(jubelioSalesOperations.status, "confirmed"),
                  gt(jubelioSalesOperations.salesOrderId, 0)
                )
              )
          ),
          notExists(
            db
              .select({ one: sql`1` })
              .from(jubelioSalesOperations)
              .where(
                and(
                  eq(jubelioSalesOperations.orderId, jubelioChannelStatusIntents.orderId),
                  eq(jubelioSalesOperations.type, "invoice"),
                  eq(jubelioSalesOperations.status, "confirmed"),
                  gt(jubelioSalesOperations.invoiceId, 0)
                )
              )
          ),
          notExists(
            db
              .select({ one: sql`1` })
              .from(jubelioSalesOperations)
              .where(
                and(
                  eq(jubelioSalesOperations.orderId, jubelioChannelStatusIntents.orderId),
                  eq(jubelioSalesOperations.type, "payment"),
                  eq(jubelioSalesOperations.status, "confirmed"),
                  gt(jubelioSalesOperations.paymentId, 0)
                )
              )
          )
        )
      )
    )
    .returning();
  return updated[0] ?? null;
}

/**
 * Durable rotation touch: when a bounded sweep pass cannot resolve a
 * possibly-sent intent (ambiguous/transient GET failure), bump its
 * `updated_at` so the `updatedAt`-ordered bounded scan rotates past it on
 * the next run instead of starving intents beyond the limit. Guarded to
 * `possibly_sent`; a confirmed/investigated outcome is never overwritten.
 * Deliberately writes NOTHING else: no error text is persisted (a provider
 * or unknown error message could carry PII/tokens) and `attempt_count` is
 * unchanged — it counts the dispatch POST permission, not GET-only retries.
 */
export async function touchChannelStatusIntentForRotation(
  db: ChannelMirrorDb,
  intentId: string
): Promise<void> {
  await db
    .update(jubelioChannelStatusIntents)
    .set({ updatedAt: new Date() })
    .where(
      and(
        eq(jubelioChannelStatusIntents.id, intentId),
        eq(jubelioChannelStatusIntents.status, "possibly_sent")
      )
    );
}

/**
 * The static, PII-safe reason recorded when a never-dispatched PENDING
 * intent is superseded because the committed local state now evidences a
 * DIFFERENT mirror target (ticket #04: a resolved `Menunggu Verifikasi`
 * investigation whose order became committed `ready_for_pickup` — the stale
 * pending intent is durably aborted, zero edit POST, zero GET, and the
 * derived target is recorded as the monotonic NEXT version).
 */
export const PENDING_TARGET_SUPERSEDED = "PENDING_TARGET_SUPERSEDED";

/**
 * ATOMIC pending→aborted disposition for a STALE pending intent (ticket
 * #04): guarded to `pending` AND to the intent's OWN targetStatus being
 * different from the NEW derived target, with the committed evidence of the
 * NEW target checked IN THE SAME statement (fail-closed against a raced
 * order transition — if the committed state changed, the supersede is
 * refused and the caller retries later). Exactly one of claim/supersede wins
 * per row; a possibly_sent intent is NEVER superseded here (it belongs to
 * GET-only recovery), and a claimed write can never be retro-aborted.
 */
export async function supersedeStalePendingChannelStatusIntent(
  db: ChannelMirrorDb,
  input: { intentId: string; targetStatus: string }
): Promise<JubelioChannelStatusIntent | null> {
  if (
    input.targetStatus !== CHANNEL_STATUS_SIAP_PROSES &&
    input.targetStatus !== CHANNEL_STATUS_MENUNGGU_VERIFIKASI &&
    input.targetStatus !== CHANNEL_STATUS_GAGAL_BAYAR &&
    input.targetStatus !== CHANNEL_STATUS_SELESAI
  ) {
    throw new Error(
      "A stale pending channel intent can only be superseded for a known derived mirror target"
    );
  }
  const committedEvidence =
    input.targetStatus === CHANNEL_STATUS_SIAP_PROSES
      ? // Siap Proses evidence: committed ready_for_pickup + paid + verified
        // invoice + verified payment ledger operations.
        and(
          exists(
            db
              .select({ one: sql`1` })
              .from(orders)
              .where(
                and(
                  eq(orders.id, jubelioChannelStatusIntents.orderId),
                  eq(orders.status, "ready_for_pickup"),
                  eq(orders.paymentStatus, "paid")
                )
              )
          ),
          exists(
            db
              .select({ one: sql`1` })
              .from(jubelioSalesOperations)
              .where(
                and(
                  eq(jubelioSalesOperations.orderId, jubelioChannelStatusIntents.orderId),
                  eq(jubelioSalesOperations.type, "invoice"),
                  eq(jubelioSalesOperations.status, "confirmed"),
                  gt(jubelioSalesOperations.invoiceId, 0)
                )
              )
          ),
          exists(
            db
              .select({ one: sql`1` })
              .from(jubelioSalesOperations)
              .where(
                and(
                  eq(jubelioSalesOperations.orderId, jubelioChannelStatusIntents.orderId),
                  eq(jubelioSalesOperations.type, "payment"),
                  eq(jubelioSalesOperations.status, "confirmed"),
                  gt(jubelioSalesOperations.paymentId, 0)
                )
              )
          )
        )
      : // Menunggu Verifikasi evidence: committed paid-but-blocked operator
        // investigation (block reason or committed manual_review op).
        input.targetStatus === CHANNEL_STATUS_MENUNGGU_VERIFIKASI
        ? exists(
            db
              .select({ one: sql`1` })
              .from(orders)
              .where(
                and(
                  eq(orders.id, jubelioChannelStatusIntents.orderId),
                  eq(orders.status, "processing"),
                  eq(orders.paymentStatus, "paid"),
                  or(
                    isNotNull(orders.fulfillmentBlockedReason),
                    exists(
                      db
                        .select({ one: sql`1` })
                        .from(jubelioSalesOperations)
                        .where(
                          and(
                            eq(jubelioSalesOperations.orderId, jubelioChannelStatusIntents.orderId),
                            eq(jubelioSalesOperations.status, "manual_review")
                          )
                        )
                    )
                  )
                )
              )
            )
        : // Ticket #06 Selesai evidence: committed completed (only reachable
          // after pickup) + paid + verified invoice + verified payment ledger
          // operations — the same trio the per-order derivation requires.
          input.targetStatus === CHANNEL_STATUS_SELESAI
          ? and(
              exists(
                db
                  .select({ one: sql`1` })
                  .from(orders)
                  .where(
                    and(
                      eq(orders.id, jubelioChannelStatusIntents.orderId),
                      eq(orders.status, "completed"),
                      eq(orders.paymentStatus, "paid")
                    )
                  )
              ),
              exists(
                db
                  .select({ one: sql`1` })
                  .from(jubelioSalesOperations)
                  .where(
                    and(
                      eq(jubelioSalesOperations.orderId, jubelioChannelStatusIntents.orderId),
                      eq(jubelioSalesOperations.type, "invoice"),
                      eq(jubelioSalesOperations.status, "confirmed"),
                      gt(jubelioSalesOperations.invoiceId, 0)
                    )
                  )
              ),
              exists(
                db
                  .select({ one: sql`1` })
                  .from(jubelioSalesOperations)
                  .where(
                    and(
                      eq(jubelioSalesOperations.orderId, jubelioChannelStatusIntents.orderId),
                      eq(jubelioSalesOperations.type, "payment"),
                      eq(jubelioSalesOperations.status, "confirmed"),
                      gt(jubelioSalesOperations.paymentId, 0)
                    )
                  )
              )
            )
          : // Gagal Bayar evidence (ticket #05): committed failed_payment +
            // failed + a confirmed create with a known SO id, and the
            // Sales-Order cancel path provably NOT active (no cancel
            // operation, or one definitively refused/abandoned pre-apply).
            and(
              exists(
                db
                  .select({ one: sql`1` })
                  .from(orders)
                  .where(
                    and(
                      eq(orders.id, jubelioChannelStatusIntents.orderId),
                      eq(orders.status, "failed_payment"),
                      eq(orders.paymentStatus, "failed")
                    )
                  )
              ),
              exists(
                db
                  .select({ one: sql`1` })
                  .from(jubelioSalesOperations)
                  .where(
                    and(
                      eq(jubelioSalesOperations.orderId, jubelioChannelStatusIntents.orderId),
                      eq(jubelioSalesOperations.type, "create"),
                      eq(jubelioSalesOperations.status, "confirmed"),
                      gt(jubelioSalesOperations.salesOrderId, 0)
                    )
                  )
              ),
              notExists(
                db
                  .select({ one: sql`1` })
                  .from(jubelioSalesOperations)
                  .where(
                    and(
                      eq(jubelioSalesOperations.orderId, jubelioChannelStatusIntents.orderId),
                      eq(jubelioSalesOperations.type, "cancel"),
                      inArray(jubelioSalesOperations.status, ACTIVE_CANCEL_STATUSES)
                    )
                  )
              )
            );
  const updated = await db
    .update(jubelioChannelStatusIntents)
    .set({
      status: "aborted",
      mismatchReason: PENDING_TARGET_SUPERSEDED,
      mismatchAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(jubelioChannelStatusIntents.id, input.intentId),
        eq(jubelioChannelStatusIntents.status, "pending"),
        ne(jubelioChannelStatusIntents.targetStatus, input.targetStatus),
        committedEvidence
      )
    )
    .returning();
  return updated[0] ?? null;
}

/**
 * Bounded sweep reconciliation for the channel-status mirror (tickets #03,
 * #04, #05 and #06).
 *
 * 1. AGED possibly-sent intents are reconciled GET-ONLY via the persisted
 *    SO id — never a re-POST, whatever the local order status (terminal
 *    orders included). A fresh claim is left alone (the owner may still be
 *    between claim and POST). GET confirms → `confirmed`; GET mismatch →
 *    PII-safe `needs_investigation`; ambiguous GET failure stays
 *    `possibly_sent` for the next sweep.
 * 2. MISSED `ready_for_pickup` AND `completed` orders (crash before any
 *    intent was created, or completion before the store's after-commit
 *    mirror trigger, ticket #06) are dispatched through the per-order seam,
 *    bounded by `limit`. Orders whose latest CONFIRMED intent targets the
 *    marker applicable to the committed state (or a LATER forward stage) are
 *    excluded; a confirmed `Menunggu Verifikasi` (a resolved investigation,
 *    ticket #04) or a confirmed `Siap Proses` on a since-completed order
 *    does NOT exclude — the monotonic next version is recorded.
 * 3. MISSED paid-but-blocked operator investigations (crash before any
 *    intent; ticket #04) are dispatched as `Menunggu Verifikasi` through the
 *    same per-order seam, bounded by `limit`. COMMITTED manual review or an
 *    explicit operator block is the trigger — a short pending/in-flight
 *    settlement and the implicit admin-queue membership of every
 *    processing+paid order are NOT.
 * 4. MISSED committed `failed_payment` orders (ticket #05) are dispatched as
 *    `Gagal Bayar` through the same per-order seam when the Sales Order is
 *    provably safe to edit; a started/confirmed Sales-Order cancel path
 *    records the durable PII-safe mismatch instead (zero POST/GET).
 * 5. Pending intents of terminal orders and open investigations are NEVER
 *    dispatched (a pending `Selesai` intent on a verified completed order is
 *    the current projection, ticket #06; the `Dibatalkan` marker remains a
 *    future-facing mapping contract with no runtime writer).
 */
export type ChannelStatusSweepSummary = {
  possiblySentScanned: number;
  skippedFresh: number;
  recovered: number;
  investigated: number;
  stillUnknown: number;
  pendingTerminalScanned: number;
  pendingTerminalAborted: number;
  pendingTerminalSkipped: number;
  missedOrdersScanned: number;
  missedDispatched: number;
  missedFailed: number;
  /** Ticket #04: bounded paid-but-blocked `Menunggu Verifikasi` window. */
  verifikasiOrdersScanned: number;
  verifikasiDispatched: number;
  verifikasiFailed: number;
  /** Ticket #05: bounded failed_payment `Gagal Bayar` window. */
  gagalBayarOrdersScanned: number;
  gagalBayarDispatched: number;
  gagalBayarFailed: number;
};

export async function reconcileChannelStatusMirrorForSweep(
  db: ChannelMirrorDb,
  input: {
    limit?: number;
    staleCutoffMs?: number;
    gateway?: JubelioSalesGateway;
    logger?: Logger;
  } = {}
): Promise<ChannelStatusSweepSummary> {
  const limit = input.limit ?? 50;
  const staleCutoffMs = input.staleCutoffMs ?? CHANNEL_STATUS_MIRROR_STALE_CUTOFF_MS;
  const gateway = input.gateway ?? getDefaultJubelioChannelMirrorGateway();
  const log = input.logger ?? createLogger({ module: "jubelio-channel-sweep" });
  const summary: ChannelStatusSweepSummary = {
    possiblySentScanned: 0,
    skippedFresh: 0,
    recovered: 0,
    investigated: 0,
    stillUnknown: 0,
    pendingTerminalScanned: 0,
    pendingTerminalAborted: 0,
    pendingTerminalSkipped: 0,
    missedOrdersScanned: 0,
    missedDispatched: 0,
    missedFailed: 0,
    verifikasiOrdersScanned: 0,
    verifikasiDispatched: 0,
    verifikasiFailed: 0,
    gagalBayarOrdersScanned: 0,
    gagalBayarDispatched: 0,
    gagalBayarFailed: 0,
  };

  // 1. GET-only recovery of aged possibly-sent intents (terminal orders too).
  const possiblySent = await listJubelioChannelStatusIntentsByStatus(
    db,
    ["possibly_sent"],
    limit
  );
  summary.possiblySentScanned = possiblySent.length;
  for (const intent of possiblySent) {
    const dispatchedAtMs = intent.dispatchedAt?.getTime() ?? 0;
    if (Date.now() - dispatchedAtMs < staleCutoffMs) {
      summary.skippedFresh++;
      continue;
    }
    try {
      const context = await loadMirrorContext(db, intent.orderId);
      if (!context || !context.create) {
        // The verified create intent is gone — nothing safe to reconcile
        // against; record an investigation case instead of assuming success.
        const reviewed = await markJubelioChannelStatusIntentNeedsInvestigation(
          db,
          intent.id,
          { reason: "RECOVERY_NO_VERIFIED_CREATE" }
        );
        if (reviewed) summary.investigated++;
        else summary.stillUnknown++;
        continue;
      }
      const outcome = await recoverPossiblySentIntent({
        db,
        intent,
        context,
        gateway,
        log,
      });
      if (outcome.status === "confirmed") summary.recovered++;
      else if (outcome.status === "needs_investigation") summary.investigated++;
      else {
        summary.stillUnknown++;
        // Durable rotation: a still-unknown intent moves to the back of the
        // bounded scan so the next run reaches intents beyond the limit.
        // PII-safe by construction: only updated_at is touched.
        await touchChannelStatusIntentForRotation(db, intent.id);
      }
    } catch (error) {
      log.warn("channel-status sweep recovery failed", {
        orderId: intent.orderId,
        salesOrderId: intent.salesOrderId,
        error: serializeError(error),
      });
      summary.stillUnknown++;
      // Same rotation, no arbitrary error text persisted.
      await touchChannelStatusIntentForRotation(db, intent.id);
    }
  }

  // 2. Scheduled PENDING terminal disposition (ticket #03 final acceptance,
  //    refined by ticket #06): a pending intent whose local committed order
  //    is TERMINAL (completed / cancelled) is durably superseded — zero edit
  //    POST, zero GET; active ready_for_pickup orders are never in this
  //    window (they dispatch through the missed scan when eligible);
  //    possibly_sent is never touched here (GET-only recovery); and
  //    failed_payment orders are NO LONGER blanket-terminal (ticket #05:
  //    their pending intents flow through the Gagal Bayar derivation/window).
  //    EXCEPTED (ticket #06): a pending `Selesai` intent whose committed
  //    order is `completed` with a fully verified SO ledger is the CURRENT
  //    projection — it dispatches through the per-order seam / missed scan
  //    below and must NOT be superseded. A pending `Selesai` intent on a
  //    completed order WITHOUT the verified ledger is still superseded
  //    (stale orphan: the dispatch would fail closed anyway). No runtime
  //    `cancelled` writer exists, so pending `Dibatalkan` intents cannot
  //    lawfully arise and cancelled orders stay in the supersede window.
  const pendingTerminal = await db
    .select({ id: jubelioChannelStatusIntents.id, orderId: jubelioChannelStatusIntents.orderId })
    .from(jubelioChannelStatusIntents)
    .innerJoin(orders, eq(orders.id, jubelioChannelStatusIntents.orderId))
    .where(
      and(
        eq(jubelioChannelStatusIntents.status, "pending"),
        inArray(orders.status, ["completed", "cancelled"]),
        // Ticket #06: spare a pending `Selesai` intent only when the order is
        // completed AND paid AND the SO ledger is fully verified with the
        // positive persisted ids — EXACTLY the same eligibility the
        // abort primitive re-checks at write time (abortPendingTerminal-
        // ChannelStatusIntent), so the scan cannot select a row the write
        // would then have to refuse.
        or(
          ne(orders.status, "completed"),
          ne(jubelioChannelStatusIntents.targetStatus, CHANNEL_STATUS_SELESAI),
          ne(orders.paymentStatus, "paid"),
          notExists(
            db
              .select({ one: sql`1` })
              .from(jubelioSalesOperations)
              .where(
                and(
                  eq(jubelioSalesOperations.orderId, orders.id),
                  eq(jubelioSalesOperations.type, "create"),
                  eq(jubelioSalesOperations.status, "confirmed"),
                  gt(jubelioSalesOperations.salesOrderId, 0)
                )
              )
          ),
          notExists(
            db
              .select({ one: sql`1` })
              .from(jubelioSalesOperations)
              .where(
                and(
                  eq(jubelioSalesOperations.orderId, orders.id),
                  eq(jubelioSalesOperations.type, "invoice"),
                  eq(jubelioSalesOperations.status, "confirmed"),
                  gt(jubelioSalesOperations.invoiceId, 0)
                )
              )
          ),
          notExists(
            db
              .select({ one: sql`1` })
              .from(jubelioSalesOperations)
              .where(
                and(
                  eq(jubelioSalesOperations.orderId, orders.id),
                  eq(jubelioSalesOperations.type, "payment"),
                  eq(jubelioSalesOperations.status, "confirmed"),
                  gt(jubelioSalesOperations.paymentId, 0)
                )
              )
          )
        )
      )
    )
    .orderBy(asc(jubelioChannelStatusIntents.updatedAt))
    .limit(limit);
  summary.pendingTerminalScanned = pendingTerminal.length;
  for (const row of pendingTerminal) {
    try {
      // Write-boundary re-read of the committed local state: a raced
      // transition back to a non-terminal state skips the abort; a
      // disappeared order (FK cascade) leaves nothing to abort.
      const context = await loadMirrorContext(db, row.orderId);
      if (!context || !["completed", "cancelled"].includes(context.order.status)) {
        summary.pendingTerminalSkipped++;
        continue;
      }
      const aborted = await abortPendingTerminalChannelStatusIntent(db, row.id);
      if (aborted) summary.pendingTerminalAborted++;
      else summary.pendingTerminalSkipped++;
    } catch (error) {
      log.warn("channel-status sweep pending-terminal disposition failed", {
        orderId: row.orderId,
        error: serializeError(error),
      });
      summary.pendingTerminalSkipped++;
    }
  }

  // 3. Missed ready_for_pickup AND completed orders (crash before intent
  //    creation, or completion before the store's after-commit mirror
  //    trigger, ticket #06). The bounded scan is FAIR and eligibility-driven:
  //    orders whose latest intent is already settled (confirmed for the
  //    marker applicable to the CURRENT committed state) or in progress
  //    (possibly_sent) are EXCLUDED by SQL, as are ready/paid or
  //    completed/paid orders with NO verified SO ledger (create + invoice +
  //    payment confirmed) — none of them can consume the window. A
  //    confirmed `Menunggu Verifikasi` (resolved investigation, ticket #04)
  //    and a confirmed `Gagal Bayar` (late settlement, ticket #05) are
  //    history, never authority — the monotonic next version targets the
  //    committed state below. Oldest first, so every unresolved eligible
  //    order is eventually reached without scanning the whole table.
  const missed = await db
    .select({ id: orders.id })
    .from(orders)
    .where(
      and(
        // Ticket #06: the completed local state (only reachable after
        // pickup) also projects a marker (Selesai).
        inArray(orders.status, ["ready_for_pickup", "completed"]),
        eq(orders.paymentStatus, "paid"),
        // Mirror eligibility is provable in SQL from committed state.
        exists(
          db
            .select({ one: sql`1` })
            .from(jubelioSalesOperations)
            .where(
              and(
                eq(jubelioSalesOperations.orderId, orders.id),
                eq(jubelioSalesOperations.type, "create"),
                eq(jubelioSalesOperations.status, "confirmed"),
                // Ticket #06 alignment: the SQL window must match the
                // reconcile's positive-id derivation exactly (a confirmed
                // op with id 0/negative is NOT a verified ledger) so the
                // bounded scan never spends its budget on an order the
                // per-order seam would skip.
                gt(jubelioSalesOperations.salesOrderId, 0)
              )
            )
        ),
        exists(
          db
            .select({ one: sql`1` })
            .from(jubelioSalesOperations)
            .where(
              and(
                eq(jubelioSalesOperations.orderId, orders.id),
                eq(jubelioSalesOperations.type, "invoice"),
                eq(jubelioSalesOperations.status, "confirmed"),
                gt(jubelioSalesOperations.invoiceId, 0)
              )
            )
        ),
        exists(
          db
            .select({ one: sql`1` })
            .from(jubelioSalesOperations)
            .where(
              and(
                eq(jubelioSalesOperations.orderId, orders.id),
                eq(jubelioSalesOperations.type, "payment"),
                eq(jubelioSalesOperations.status, "confirmed"),
                gt(jubelioSalesOperations.paymentId, 0)
              )
            )
        ),
        // In-progress and dead-end intents (of ANY target) exclude the
        // order: a possibly_sent edit must be GET-reconciled first, an open
        // investigation needs an operator action, and a rejected intent
        // needs an explicit owner decision.
        notExists(
          db
            .select({ one: sql`1` })
            .from(jubelioChannelStatusIntents)
            .where(
              and(
                eq(jubelioChannelStatusIntents.orderId, orders.id),
                inArray(jubelioChannelStatusIntents.status, [
                  "possibly_sent",
                  "needs_investigation",
                  "rejected",
                ])
              )
            )
        ),
        // A confirmed intent already AT (or, for non-terminal orders, past)
        // the marker applicable to the committed local state excludes the
        // order; a confirmed EARLIER stage (a confirmed `Menunggu
        // Verifikasi` from a resolved investigation, ticket #04, or a
        // confirmed `Siap Proses` whose order later completed, ticket #06)
        // does NOT — the monotonic next version is needed.
        notExists(
          db
            .select({ one: sql`1` })
            .from(jubelioChannelStatusIntents)
            .where(
              and(
                eq(jubelioChannelStatusIntents.orderId, orders.id),
                eq(jubelioChannelStatusIntents.status, "confirmed"),
                or(
                  eq(
                    jubelioChannelStatusIntents.targetStatus,
                    sql`case when ${orders.status} = 'completed' then 'Selesai' else 'Siap Proses' end`
                  ),
                  // Never regress a non-terminal order past a confirmed
                  // Selesai (unreachable in the lawful flow; guarded anyway).
                  and(
                    ne(orders.status, "completed"),
                    eq(jubelioChannelStatusIntents.targetStatus, CHANNEL_STATUS_SELESAI)
                  )
                )
              )
            )
        )
      )
    )
    .orderBy(asc(orders.updatedAt))
    .limit(limit);
  summary.missedOrdersScanned = missed.length;
  for (const row of missed) {
    try {
      const outcome = await reconcileJubelioChannelStatusForOrder(db, {
        orderId: row.id,
        gateway,
        logger: log,
      });
      if (outcome.status === "confirmed") summary.missedDispatched++;
    } catch (error) {
      log.warn("channel-status sweep missed-order reconciliation failed", {
        orderId: row.id,
        error: serializeError(error),
      });
      summary.missedFailed++;
    }
  }

  // 4. MISSED paid-but-blocked operator investigations (ticket #04): paid
  //    `processing` orders whose committed state evidences a settlement
  //    manual review or an explicit operator investigation block, whose
  //    mirror intent was never created (crash before intent). The trigger
  //    is the COMMITTED evidence only — a short pending/in-flight
  //    settlement (`intent`/`dispatched_unknown` ops without a block or
  //    manual_review op) and the implicit admin-queue membership of every
  //    processing+paid order are NOT in this window. Current blocking
  //    states exclude an order from the window; a CONFIRMED intent only
  //    excludes when it already confirms the derived `Menunggu Verifikasi`
  //    target, and a pending intent (either target) passes so the per-order
  //    reconcile can dispatch or supersede it. Oldest first, bounded.
  const missedVerifikasi = await db
    .select({ id: orders.id })
    .from(orders)
    .where(
      and(
        eq(orders.status, "processing"),
        eq(orders.paymentStatus, "paid"),
        // COMMITTED operator investigation evidence (never a raw callback
        // or queue membership): a durable block reason or a committed
        // manual_review ledger operation.
        or(
          isNotNull(orders.fulfillmentBlockedReason),
          exists(
            db
              .select({ one: sql`1` })
              .from(jubelioSalesOperations)
              .where(
                and(
                  eq(jubelioSalesOperations.orderId, orders.id),
                  eq(jubelioSalesOperations.status, "manual_review")
                )
              )
          )
        ),
        // The marker edit always targets a KNOWN, confirmed Sales Order.
        exists(
          db
            .select({ one: sql`1` })
            .from(jubelioSalesOperations)
            .where(
              and(
                eq(jubelioSalesOperations.orderId, orders.id),
                eq(jubelioSalesOperations.type, "create"),
                eq(jubelioSalesOperations.status, "confirmed"),
                gt(jubelioSalesOperations.salesOrderId, 0)
              )
            )
        ),
        notExists(
          db
            .select({ one: sql`1` })
            .from(jubelioChannelStatusIntents)
            .where(
              and(
                eq(jubelioChannelStatusIntents.orderId, orders.id),
                or(
                  inArray(jubelioChannelStatusIntents.status, [
                    "needs_investigation",
                    "rejected",
                    "possibly_sent",
                  ]),
                  and(
                    eq(jubelioChannelStatusIntents.status, "confirmed"),
                    eq(
                      jubelioChannelStatusIntents.targetStatus,
                      CHANNEL_STATUS_MENUNGGU_VERIFIKASI
                    )
                  )
                )
              )
            )
        )
      )
    )
    .orderBy(asc(orders.updatedAt))
    .limit(limit);
  summary.verifikasiOrdersScanned = missedVerifikasi.length;
  for (const row of missedVerifikasi) {
    try {
      const outcome = await reconcileJubelioChannelStatusForOrder(db, {
        orderId: row.id,
        gateway,
        logger: log,
      });
      if (outcome.status === "confirmed") summary.verifikasiDispatched++;
    } catch (error) {
      log.warn("channel-status sweep paid-but-blocked reconciliation failed", {
        orderId: row.id,
        error: serializeError(error),
      });
      summary.verifikasiFailed++;
    }
  }

  // 5. MISSED committed failed_payment orders (ticket #05): paid-failed
  //    orders whose Sales Order is SAFE to edit (confirmed create with a
  //    known SO id; the cancel path never started, or was definitively
  //    refused/abandoned pre-apply) get ONE `Gagal Bayar` edit through the
  //    per-order seam — bounded, oldest first. A committed failed_payment
  //    order whose cancel path STARTED/maybe-sent/was confirmed is ALSO in
  //    this window, but only to RECORD the durable PII-safe mismatch
  //    (`GAGAL_BAYAR_CANCEL_STARTED`) — the per-order reconcile performs
  //    zero POST and zero GET for it, dedupes its record per order, and the
  //    recorded mismatch (while the cancel path is still active) frees the
  //    bounded window. Current blocking states exclude an order from the
  //    window; a pending intent (either target) passes so the per-order
  //    reconcile can dispatch or supersede it. Oldest first, bounded.
  const missedGagalBayar = await db
    .select({ id: orders.id })
    .from(orders)
    .where(
      and(
        eq(orders.status, "failed_payment"),
        eq(orders.paymentStatus, "failed"),
        // The marker edit always targets a KNOWN, confirmed Sales Order.
        exists(
          db
            .select({ one: sql`1` })
            .from(jubelioSalesOperations)
            .where(
              and(
                eq(jubelioSalesOperations.orderId, orders.id),
                eq(jubelioSalesOperations.type, "create"),
                eq(jubelioSalesOperations.status, "confirmed"),
                gt(jubelioSalesOperations.salesOrderId, 0)
              )
            )
        ),
        notExists(
          db
            .select({ one: sql`1` })
            .from(jubelioChannelStatusIntents)
            .where(
              and(
                eq(jubelioChannelStatusIntents.orderId, orders.id),
                or(
                  inArray(jubelioChannelStatusIntents.status, [
                    "needs_investigation",
                    "rejected",
                    "possibly_sent",
                  ]),
                  and(
                    eq(jubelioChannelStatusIntents.status, "confirmed"),
                    eq(
                      jubelioChannelStatusIntents.targetStatus,
                      CHANNEL_STATUS_GAGAL_BAYAR
                    )
                  )
                )
              )
            )
        ),
        // Anti-starvation: an order whose durable started-cancel mismatch
        // was already recorded (and whose cancel path is STILL active) is
        // freed from the bounded window; when the cancel later resolves
        // (definitively refused/abandoned), the order re-enters the window
        // and the per-order reconcile dispatches `Gagal Bayar` normally.
        notExists(
          db
            .select({ one: sql`1` })
            .from(jubelioChannelStatusIntents)
            .where(
              and(
                eq(jubelioChannelStatusIntents.orderId, orders.id),
                eq(jubelioChannelStatusIntents.status, "aborted"),
                eq(
                  jubelioChannelStatusIntents.mismatchReason,
                  GAGAL_BAYAR_CANCEL_STARTED
                ),
                exists(
                  db
                    .select({ one: sql`1` })
                    .from(jubelioSalesOperations)
                    .where(
                      and(
                        eq(jubelioSalesOperations.orderId, orders.id),
                        eq(jubelioSalesOperations.type, "cancel"),
                        inArray(jubelioSalesOperations.status, ACTIVE_CANCEL_STATUSES)
                      )
                    )
                )
              )
            )
        )
      )
    )
    .orderBy(asc(orders.updatedAt))
    .limit(limit);
  summary.gagalBayarOrdersScanned = missedGagalBayar.length;
  for (const row of missedGagalBayar) {
    try {
      const outcome = await reconcileJubelioChannelStatusForOrder(db, {
        orderId: row.id,
        gateway,
        logger: log,
      });
      if (outcome.status === "confirmed") summary.gagalBayarDispatched++;
    } catch (error) {
      log.warn("channel-status sweep failed-payment reconciliation failed", {
        orderId: row.id,
        error: serializeError(error),
      });
      summary.gagalBayarFailed++;
    }
  }

  log.info("channel-status mirror sweep completed", { ...summary });
  return summary;
}

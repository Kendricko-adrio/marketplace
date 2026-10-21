import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db, checkoutRequests, orders, jubelioSalesOperations } from "@/db";
import { readOrderPricing } from "./versioned-pricing";
import { CheckoutReviewRequiredError } from "./checkout-review";
import { withRequestId, type Logger } from "./logger";

export class CheckoutRequestConflictError extends Error {
  readonly code = "REQUEST_KEY_CONFLICT";
  constructor() { super("Request checkout ini sudah digunakan untuk pilihan berbeda."); }
}
export class AcceptedCheckoutReplay extends Error {}
export interface CheckoutRequestIdentity { clientId: string; requestKey: string; fingerprint: string }
export interface CheckoutRecovery { identity?: CheckoutRequestIdentity; committed?: boolean }

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
    .filter(([, v]) => v !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, v]) => [key, canonical(v)]));
  return value;
}

export function normalizeCheckoutApproval(pricing: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(pricing).map(([key, value]) => {
    const text = String(value);
    if (!/^\d+(?:\.\d+)?$/.test(text)) return [key, text];
    const [whole, fraction = ""] = text.split(".");
    const tail = fraction.replace(/0+$/, "");
    return [key, `${whole.replace(/^0+(?=\d)/, "")}${tail ? `.${tail}` : ""}`];
  }));
}

/** Intent canonical tidak membaca cart/master dan tetap dapat dibangun setelah expiry. */
export function checkoutIntentFingerprint(body: Record<string, unknown>): string {
  const { requestKey: _key, reviewToken, approvedPricing, ...intent } = body;
  void _key;
  let reviewedFingerprint: string;
  try {
    const payload = JSON.parse(Buffer.from(String(reviewToken).split(".")[0], "base64url").toString("utf8"));
    if (typeof payload.fp !== "string" || !/^[a-f0-9]{64}$/.test(payload.fp)) throw new Error();
    reviewedFingerprint = payload.fp;
  } catch { throw new CheckoutReviewRequiredError(); }
  const idsField = "itemIds" in intent ? "itemIds" : "selectedItemIds";
  const ids = intent[idsField];
  if (Array.isArray(ids)) intent[idsField] = [...ids].sort();
  for (const field of ["phone", "email", "contactPhone", "contactEmail"]) {
    if (typeof intent[field] === "string") intent[field] = intent[field].trim();
  }
  const money = approvedPricing && typeof approvedPricing === "object"
    ? normalizeCheckoutApproval(approvedPricing as Record<string, unknown>)
    : undefined;
  return createHash("sha256").update(JSON.stringify(canonical({
    ...intent, ...(money ? { approvedPricing: money } : {}), reviewedFingerprint,
  }))).digest("hex");
}

export async function findAcceptedCheckout(identity: CheckoutRequestIdentity) {
  const [receipt] = await db.select().from(checkoutRequests).where(and(
    eq(checkoutRequests.clientId, identity.clientId), eq(checkoutRequests.requestKey, identity.requestKey),
  )).limit(1);
  if (!receipt) return null;
  if (receipt.fingerprint !== identity.fingerprint) throw new CheckoutRequestConflictError();
  return readCheckoutResult(identity.clientId, identity.requestKey);
}

/** Read-only: tidak requote, reserve, dispatch, atau memperbarui payment deadline. */
export async function readCheckoutResult(clientId: string, requestKey: string) {
  const [row] = await db.select({ receipt: checkoutRequests, order: orders })
    .from(checkoutRequests).innerJoin(orders, and(
      eq(orders.id, checkoutRequests.orderId), eq(orders.userId, checkoutRequests.clientId),
    )).where(and(eq(checkoutRequests.clientId, clientId), eq(checkoutRequests.requestKey, requestKey))).limit(1);
  if (!row) return null;
  const { receipt, order } = row;
  if (receipt.status !== "accepted" || receipt.result?.version !== 1 || receipt.result.orderId !== order.id) {
    throw new Error("Checkout result version tidak didukung.");
  }
  readOrderPricing(order); // Strict persisted version fence, bukan master/config terbaru.
  const [operation] = await db.select({ status: jubelioSalesOperations.status }).from(jubelioSalesOperations)
    .where(and(eq(jubelioSalesOperations.orderId, order.id), eq(jubelioSalesOperations.type, "create"))).limit(1);
  const paymentAvailable = order.paymentStatus === "pending" && order.status === "pending_payment" &&
    !!order.snapRedirectUrl && !!order.expiresAt && order.expiresAt.getTime() > Date.now() && operation?.status === "confirmed";
  const state = order.paymentStatus === "paid" ? "paid"
    : order.status === "failed_payment" || order.status === "cancelled" ? "failed"
    : operation?.status === "manual_review" || operation?.status === "dispatched_unknown" ? "manual_review"
    : paymentAvailable ? "payment_ready" : "processing";
  return { requestKey: receipt.requestKey, orderId: order.id, state, paymentAvailable,
    redirectUrl: paymentAvailable ? order.snapRedirectUrl : null, expiresAt: order.expiresAt?.toISOString() ?? null };
}

export function checkoutResultResponse(result: NonNullable<Awaited<ReturnType<typeof readCheckoutResult>>>,
  replay: boolean, log: Logger) {
  const status = replay ? 200 : result.state === "processing" || result.state === "manual_review" ? 202 : 201;
  log.info("accepted checkout result returned", { orderId: result.orderId, state: result.state, replay, status });
  // Top-level aliases menjaga compatibility dengan payment consumers existing;
  // kontrak baru menggunakan data. Tidak mengembalikan review token atau PII.
  return withRequestId(NextResponse.json({ success: true, data: result,
    orderId: result.orderId, redirectUrl: result.redirectUrl },
    { status, headers: { "Cache-Control": "no-store" } }), log);
}

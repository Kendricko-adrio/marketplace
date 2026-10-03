/**
 * POST /api/webhooks/jubelio-shipment — the Jubelio SHIPMENT callback
 * (ticket 06; SEPARATE from the Omnichannel webhook route).
 *
 * Only raw bytes are read (`request.text()` — never reserialized); the
 * X-Jubelio-Signature hex is verified FIRST via the vendor's own HMAC
 * construction (key = the secret, message = raw + secret, hex, constant
 * time) against the DEDICATED `JUBELIO_SHIPMENT_WEBHOOK_SECRET` (a distinct
 * signing secret — never the API credentials). No polling retries exist; the
 * factory dedupes replays and never mutates an unverified/unknown/mismatched
 * body. Logging stays PII-safe (no raw bodies, signatures, tokens,
 * addresses, or POD payloads).
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { createLogger, serializeError } from "@/lib/logger";
import {
  createShipmentTracking,
  ShipmentTrackingError,
} from "@marketplace/db/src/shipment-tracking";

const log = createLogger({ module: "jubelio-shipment-webhook" });

const MAX_WEBHOOK_BODY_CHARS = 1_048_576;

export async function POST(request: NextRequest) {
  try {
    const secret = (process.env.JUBELIO_SHIPMENT_WEBHOOK_SECRET ?? "").trim();
    // Fail closed: a missing dedicated secret disables the callback entirely
    // (never an API-credential fallback; verified-mode rejects with 503).
    if (!secret) {
      log.error("shipment webhook secret missing", { outcome: "denied" });
      return NextResponse.json(
        { success: false, error: "Webhook not configured" },
        { status: 503 }
      );
    }

    const raw = await request.text();
    if (raw.length > MAX_WEBHOOK_BODY_CHARS) {
      log.warn("shipment webhook body too large", { outcome: "denied" });
      return NextResponse.json(
        { success: false, error: "Webhook body too large" },
        { status: 413 }
      );
    }
    const hexSignature = (request.headers.get("x-jubelio-signature") ?? "").trim();
    // A quick (cheap) pre-check for the 401 contract: the factory performs
    // the full constant-time verification and refuses pre-parse.
    if (!hexSignature || !verifyShipmentSignatureFormatOnly(raw, hexSignature, secret)) {
      log.warn("shipment webhook signature invalid", { outcome: "denied" });
      log.info("shipment webhook refused", { outcome: "denied" });
      return NextResponse.json(
        { success: false, error: "Invalid webhook signature" },
        { status: 401 }
      );
    }

    // NO gateway is injected: the callback NEVER performs provider GETs (the
    // reconciliation is the admin's manual/reactive path only).
    const tracking = createShipmentTracking(
      db,
      {
        getAwb: async () => {
          throw new Error("SHIPMENT_UNAVAILABLE");
        },
      },
      {
        logger: {
          info: (event, data) => log.info(event, { ...(data ?? {}), outcome: "success" }),
          error: (event, data) => log.error(event, { ...(data ?? {}), outcome: "error" }),
        },
      }
    );
    const result = await tracking.ingestWebhook(raw, hexSignature, secret);

    log.info("shipment webhook processed", { outcome: result.status });
    // Once verified and ingested the callback is always answered 200 — even
    // duplicates/ignored/unknown-status receipts (no retry storms).
    return NextResponse.json({ success: true, status: result.status });
  } catch (error) {
    if (error instanceof ShipmentTrackingError && error.code === "INVALID_SIGNATURE") {
      log.warn("shipment webhook refused", { outcome: "denied", code: error.code });
      return NextResponse.json(
        { success: false, error: "Invalid webhook signature" },
        { status: 401 }
      );
    }
    log.error("shipment webhook failed", {
      outcome: "error",
      error: serializeError(error),
    });
    return NextResponse.json(
      { success: false, error: "Webhook processing failed" },
      { status: 500 }
    );
  }
}

/**
 * The route pre-check mirrors verifyShipmentSignature's type/shape rules
 * (hex64 + non-empty secret) WITHOUT computing the HMAC — the factory's
 * constant-time verification remains the single source of truth.
 */
function verifyShipmentSignatureFormatOnly(raw: string, hex: string, secret: string): boolean {
  if (raw.length === 0 || secret.length === 0) return false;
  return /^[0-9a-fA-F]{64}$/.test(hex);
}
/**
 * Jubelio Shipment HTTP adapter — ADMIN's own server-only token + create
 * boundary (ticket 05). Mirrors the hardened store shipment client (same
 * config rules, token expiry handling, runtime cache key and fail-closed E2E
 * guards) but is a SEPARATE owned copy: NO cross-app store imports, its own
 * logger, its own env reads — and credentials EXCLUSIVELY from
 * `JUBELIO_SHIPMENT_URL` / `JUBELIO_SHIPMENT_CLIENT_ID` /
 * `JUBELIO_SHIPMENT_CLIENT_SECRET` (never the Omnichannel/sales pair).
 *
 * E2E mock mode stays fail-closed: `E2E_PROVIDER_MOCKS=true` requires a BARE
 * loopback base (http://127.0.0.1:<port>), and neither NODE_ENV nor APP_ENV
 * may be production while the flag is on. No live fallback, no retries (an
 * ambiguous create stays ambiguous — the ledger owns reconciliation).
 *
 * The wire body carries ONLY the documented Shipment create fields (ref_no,
 * courier_id, courier_service_id, is_cod, origin/destination, items); no
 * invented carton/package_detail. No tokens, sender/recipient PII, or raw
 * provider payloads are logged.
 */
import { createLogger, serializeError } from "@/lib/logger";

const log = createLogger({ module: "jubelio-shipment-client" });
const TOKEN_SAFETY_MARGIN_MS = 60_000;
const DEFAULT_TIMEOUT_MS = 10_000;

export type JubelioShipmentCreateRequest = {
  ref_no: string;
  courier_id: number;
  courier_service_id: number;
  is_cod: boolean;
  shipping_insurance?: number;
  origin: {
    name: string;
    phone: string;
    address: string;
    zipcode: string;
    area_id?: string;
  };
  destination: {
    name: string;
    phone: string;
    address: string;
    zipcode: string;
    area_id?: string;
  };
  items: Array<{
    item_name: string;
    quantity: number;
    value: number;
    weight: number;
    length: number;
    width: number;
    height: number;
  }>;
};

export interface JubelioShipmentCreateResult {
  shipment_id: number;
  awb: string;
  tracking_url?: string;
  price: number;
  price_bill?: number;
}

function timeoutMs(): number {
  const raw = (process.env.JUBELIO_SHIPMENT_TIMEOUT_MS ?? "").trim();
  const parsed = raw === "" ? NaN : Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
}

type CachedToken = { value: string; expiresAt: number; runtimeKey: string };

let cachedToken: CachedToken | null = null;

function shipmentEnv(): { baseUrl: string; clientId: string; clientSecret: string; timeout: number } {
  const baseUrl = (process.env.JUBELIO_SHIPMENT_URL ?? "").trim().replace(/\/$/, "");
  const clientId = (process.env.JUBELIO_SHIPMENT_CLIENT_ID ?? "").trim();
  const clientSecret = (process.env.JUBELIO_SHIPMENT_CLIENT_SECRET ?? "").trim();
  if (!baseUrl || !clientId || !clientSecret) {
    log.error("shipment runtime not fully configured", { outcome: "denied" });
    throw new Error("SHIPMENT_NOT_CONFIGURED");
  }
  const url = new URL(baseUrl);
  const isBareLoopback =
    url.protocol === "http:" &&
    url.hostname === "127.0.0.1" &&
    url.pathname === "/" &&
    !url.search &&
    !url.hash &&
    !url.username &&
    !url.password;
  const production =
    process.env.NODE_ENV === "production" || process.env.APP_ENV === "production";
  if (process.env.E2E_PROVIDER_MOCKS === "true") {
    if (production) {
      log.error("E2E provider mocks forbidden outside development", { outcome: "denied" });
      throw new Error("SHIPMENT_E2E_MODE_FORBIDDEN");
    }
    if (!isBareLoopback) {
      log.error("E2E shipment base must be bare loopback", { outcome: "denied" });
      throw new Error("SHIPMENT_MOCK_BASE_NOT_LOOPBACK");
    }
  } else if (production && url.protocol !== "https:") {
    log.error("shipment base must be https in production", { outcome: "denied" });
    throw new Error("SHIPMENT_NOT_CONFIGURED");
  }
  return { baseUrl, clientId, clientSecret, timeout: timeoutMs() };
}

async function refreshToken(
  baseUrl: string,
  clientId: string,
  clientSecret: string,
  timeout: number
): Promise<CachedToken> {
  const requestedAt = Date.now();
  log.info("shipment token requested", { host: new URL(baseUrl).host });
  const response = await fetch(`${baseUrl}/auth/generate-token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret }),
    cache: "no-store",
    signal: AbortSignal.timeout(timeout),
  });
  if (!response.ok) {
    log.error("shipment token failed", { outcome: "error", status: response.status });
    throw new Error("SHIPMENT_TOKEN_FAILED");
  }
  const body = (await response.json()) as Record<string, unknown>;
  const token = body.token;
  const expiresIn = body.expires_in;
  // The contract's expires_in type is ambiguous (attributes: string; live
  // tenant: number 86400) — accept both, validate explicitly.
  const seconds = typeof expiresIn === "number" ? expiresIn : Number(expiresIn);
  if (
    typeof token !== "string" ||
    !token.trim() ||
    (typeof expiresIn !== "number" && typeof expiresIn !== "string") ||
    !Number.isFinite(seconds) ||
    seconds <= 0
  ) {
    log.error("shipment token response malformed", { outcome: "error" });
    throw new Error("SHIPMENT_TOKEN_FAILED");
  }
  const ttl = seconds * 1000;
  const expiresAt = requestedAt + ttl - Math.min(TOKEN_SAFETY_MARGIN_MS, ttl / 10);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw new Error("SHIPMENT_TOKEN_FAILED");
  const fresh: CachedToken = {
    value: token,
    expiresAt,
    runtimeKey: `${baseUrl}\0${clientId}\0${clientSecret}`,
  };
  cachedToken = fresh;
  return fresh;
}

async function currentToken(
  baseUrl: string,
  clientId: string,
  clientSecret: string,
  timeout: number
): Promise<string> {
  const runtimeKey = `${baseUrl}\0${clientId}\0${clientSecret}`;
  if (cachedToken && cachedToken.runtimeKey === runtimeKey && cachedToken.expiresAt > Date.now()) {
    return cachedToken.value;
  }
  const fresh = await refreshToken(baseUrl, clientId, clientSecret, timeout);
  return fresh.value;
}

function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Server-only Shipment create gateway: ONE POST /shipments/create with the
 * Bearer token; no auth retry and NO booking retry. Malformed/failed answers
 * throw — shipment-fulfillment marks the dispatch ambiguous (never retries
 * on its own).
 */
export function createJubelioShipmentGateway() {
  return {
    async createShipment(
      request: JubelioShipmentCreateRequest
    ): Promise<JubelioShipmentCreateResult> {
      const { baseUrl, clientId, clientSecret, timeout } = shipmentEnv();
      const token = await currentToken(baseUrl, clientId, clientSecret, timeout);
      log.info("shipment create dispatched", {
        refNo: request.ref_no,
        courierId: request.courier_id,
      });
      const wireBody = {
        // Documented create fields only — no invented carton/package_detail.
        ref_no: request.ref_no,
        courier_id: request.courier_id,
        courier_service_id: request.courier_service_id,
        shipping_insurance: 0,
        is_cod: false,
        origin: {
          name: request.origin.name,
          phone: request.origin.phone,
          address: request.origin.address,
          zipcode: request.origin.zipcode,
          ...(request.origin.area_id ? { area_id: request.origin.area_id } : {}),
        },
        destination: {
          name: request.destination.name,
          phone: request.destination.phone,
          address: request.destination.address,
          zipcode: request.destination.zipcode,
          ...(request.destination.area_id ? { area_id: request.destination.area_id } : {}),
        },
        items: request.items,
      };
      let response: Response;
      try {
        response = await fetch(`${baseUrl}/shipments/create`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(wireBody),
          cache: "no-store",
          signal: AbortSignal.timeout(timeout),
        });
      } catch (error) {
        log.error("shipment create transport failed", {
          outcome: "error",
          error: serializeError(error),
        });
        throw new Error("SHIPMENT_UNAVAILABLE");
      }
      if (!response.ok) {
        log.error("shipment create failed", { outcome: "error", status: response.status });
        throw new Error("SHIPMENT_CREATE_FAILED");
      }
      const body = (await response.json()) as Record<string, unknown>;
      const shipmentId = Number(body.shipment_id);
      const awb = body.awb;
      const price = Number(body.price);
      const priceBill = body.price_bill;
      const priceBillNumber = priceBill === undefined || priceBill === null ? null : Number(priceBill);
      if (
        !Number.isSafeInteger(shipmentId) ||
        shipmentId <= 0 ||
        typeof awb !== "string" ||
        !awb.trim() ||
        !Number.isFinite(price) ||
        price < 0 ||
        (priceBillNumber !== null && !Number.isFinite(priceBillNumber))
      ) {
        log.error("shipment create response malformed", { outcome: "error" });
        throw new Error("SHIPMENT_MALFORMED");
      }
      const trackingUrl = body.tracking_url;
      const trackingUrlSafe =
        typeof trackingUrl === "string" && trackingUrl.trim() && isValidHttpUrl(trackingUrl.trim())
          ? trackingUrl.trim()
          : null;
      return {
        shipment_id: shipmentId,
        awb: awb,
        price,
        ...(priceBillNumber !== null ? { price_bill: priceBillNumber } : {}),
        ...(trackingUrlSafe ? { tracking_url: trackingUrlSafe } : {}),
      };
    },

    /**
     * Ticket 06 — GET /shipments/awb/{encoded} — the READ-ONLY detail for the
     * reconciliation. ONE attempt, no retry, no fallback (the identity is
     * returned untouched; the caller verifies the triplet against its
     * ledger). 404/unknown → SHIPMENT_AWB_UNKNOWN.
     */
    async getAwb(awb: string): Promise<unknown> {
      const { baseUrl, clientId, clientSecret, timeout } = shipmentEnv();
      const token = await currentToken(baseUrl, clientId, clientSecret, timeout);
      log.info("shipment awb detail requested", {});
      let response: Response;
      try {
        response = await fetch(`${baseUrl}/shipments/awb/${encodeURIComponent(awb)}`, {
          method: "GET",
          headers: { authorization: `Bearer ${token}` },
          cache: "no-store",
          signal: AbortSignal.timeout(timeout),
        });
      } catch (error) {
        log.error("shipment awb detail transport failed", {
          outcome: "error",
          error: serializeError(error),
        });
        throw new Error("SHIPMENT_UNAVAILABLE");
      }
      if (response.status === 404) {
        log.error("shipment awb detail unknown", { outcome: "error" });
        throw new Error("SHIPMENT_AWB_UNKNOWN");
      }
      if (!response.ok) {
        log.error("shipment awb detail failed", { outcome: "error", status: response.status });
        throw new Error("SHIPMENT_UNAVAILABLE");
      }
      const body: unknown = await response.json();
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        log.error("shipment awb detail malformed", { outcome: "error" });
        throw new Error("SHIPMENT_MALFORMED");
      }
      const detail = body as Record<string, unknown>;
      if (Number(detail.shipment_id) <= 0 || !detail.awb) {
        log.error("shipment awb detail identity missing", { outcome: "error" });
        throw new Error("SHIPMENT_MALFORMED");
      }
      return body;
    },
  };
}
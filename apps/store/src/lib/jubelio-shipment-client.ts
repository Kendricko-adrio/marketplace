/**
 * Jubelio Shipment HTTP adapter — server-only token + rates/all boundary
 * (ticket 03). THE ONLY external provider boundary of the delivery quote.
 *
 * Credentials come EXCLUSIVELY from `JUBELIO_SHIPMENT_URL` /
 * `JUBELIO_SHIPMENT_CLIENT_ID` / `JUBELIO_SHIPMENT_CLIENT_SECRET` — never
 * from the Omnichannel/sales (JUBELIO_*) credential pair; the two integrations
 * stay separate by contract. There is NO live fallback and NO retry: any
 * failure (env, token, HTTP, malformed body) surfaces as an error to the
 * caller (quoteDelivery throws — never a zero or stale price).
 *
 * E2E mock mode is fail-closed: `E2E_PROVIDER_MOCKS=true` requires a BARE
 * loopback base URL (http://127.0.0.1:<port>), and a production runtime must
 * never run with the E2E flag on.
 *
 * No tokens, addresses, PII or raw provider payloads are logged — failures
 * log only the phase and HTTP status.
 */
import { createModuleLogger } from "./logger";

/**
 * Module-scope logger: hanya nama module yang di-bind di sini. Field korelasi
 * dibaca dari scope aktif saat baris ditulis, jadi aman dibuat sekali saat
 * import. Kegagalan hanya mencatat fase dan HTTP status — tidak pernah token,
 * alamat, PII, atau payload provider mentah.
 */
const log = createModuleLogger("jubelio-shipment");

/**
 * Technical failure codes this module is allowed to describe in a log line.
 */
type ShipmentLogCode = "TRANSPORT_FAILED";

/**
 * Safe technical projection for the `error` field of this module's log lines.
 *
 * The logging core keeps the `name`/`message`/`stack`/`cause` of whatever it is
 * given, redacted by shape only. Passing the raw caught value would publish free
 * text that the transport layer put into `message`/`stack`/`cause` (a URL with
 * credentials, a provider body). This class is therefore the ONLY value this
 * module hands to a log line; the message and the code are chosen here.
 *
 * The caught value is never lost from the business flow: the caller still throws
 * the same `SHIPMENT_UNAVAILABLE` error as before.
 */
class ShipmentDependencyError extends Error {
  readonly code?: ShipmentLogCode;

  constructor(message: string, code?: ShipmentLogCode) {
    super(message);
    this.name = "ShipmentDependencyError";
    this.code = code;
  }
}

/** Static projection for a failed transport call: no raw error text is copied. */
function shipmentTransportErrorLog(): ShipmentDependencyError {
  return new ShipmentDependencyError(
    "Jubelio shipment request gagal pada lapisan transport",
    "TRANSPORT_FAILED"
  );
}

const TOKEN_SAFETY_MARGIN_MS = 60_000;
const RATES_TIMEOUT_MS = 10_000;

/** Wire shape of the /rates/all request (Shipment contract v1.8). */
export interface ShipmentRatesRequest {
  origin: Record<string, unknown>;
  destination: Record<string, unknown>;
  weight: number;
  items?: unknown[];
}

type CachedToken = { value: string; expiresAt: number; runtimeKey: string };

let cachedToken: CachedToken | null = null;

function shipmentEnv(): { baseUrl: string; clientId: string; clientSecret: string } {
  const baseUrl = (process.env.JUBELIO_SHIPMENT_URL ?? "").trim().replace(/\/$/, "");
  const clientId = (process.env.JUBELIO_SHIPMENT_CLIENT_ID ?? "").trim();
  const clientSecret = (process.env.JUBELIO_SHIPMENT_CLIENT_SECRET ?? "").trim();
  if (!baseUrl || !clientId || !clientSecret) {
    log.error("Shipment runtime not fully configured — request denied");
    throw new Error("SHIPMENT_NOT_CONFIGURED");
  }
  const url = new URL(baseUrl);
  const isBareLoopback = url.protocol === "http:" && url.hostname === "127.0.0.1" && url.pathname === "/" && !url.search && !url.hash && !url.username && !url.password;
  const production = process.env.NODE_ENV === "production" || process.env.APP_ENV === "production";
  if (process.env.E2E_PROVIDER_MOCKS === "true") {
    // Fail closed: production never runs with the E2E flag on, and the mock
    // base must be a BARE loopback URL (never a shared host name).
    if (production) {
      log.error("E2E provider mocks forbidden outside development — request denied");
      throw new Error("SHIPMENT_E2E_MODE_FORBIDDEN");
    }
    if (!isBareLoopback) {
      log.error("E2E shipment base must be a bare loopback URL — request denied");
      throw new Error("SHIPMENT_MOCK_BASE_NOT_LOOPBACK");
    }
  } else if (production && url.protocol !== "https:") {
    // A loopback shipment base in production is a misconfiguration.
    log.error("Loopback shipment URL forbidden in production — request denied");
    throw new Error("SHIPMENT_NOT_CONFIGURED");
  }
  return { baseUrl, clientId, clientSecret };
}

async function refreshToken(baseUrl: string, clientId: string, clientSecret: string): Promise<CachedToken> {
  log.info(`Shipment token requested (host ${new URL(baseUrl).host})`);
  const response = await fetch(`${baseUrl}/auth/generate-token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret }),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    log.error(`Shipment token request failed (HTTP ${response.status})`);
    throw new Error("SHIPMENT_TOKEN_FAILED");
  }
  const body = (await response.json()) as Record<string, unknown>;
  const token = body.token;
  const expiresIn = body.expires_in;
  // The contract's expires_in type is ambiguous (attribute table: string,
  // live tenant: number 86400) — accept both, validate explicitly.
  const seconds = typeof expiresIn === "number" ? expiresIn : Number(expiresIn);
  if (
    typeof token !== "string" ||
    !token.trim() ||
    (typeof expiresIn !== "number" && typeof expiresIn !== "string") ||
    !Number.isFinite(seconds) ||
    seconds <= 0
  ) {
    log.error("Shipment token response malformed");
    throw new Error("SHIPMENT_TOKEN_FAILED");
  }
  const expiresAt = Date.now() + seconds * 1000 - TOKEN_SAFETY_MARGIN_MS;
  const fresh: CachedToken = { value: token, expiresAt, runtimeKey: `${baseUrl}\0${clientId}\0${clientSecret}` };
  cachedToken = fresh;
  return fresh;
}

async function currentToken(): Promise<string> {
  const { baseUrl, clientId, clientSecret } = shipmentEnv();
  if (cachedToken && cachedToken.runtimeKey === `${baseUrl}\0${clientId}\0${clientSecret}` && cachedToken.expiresAt > Date.now()) return cachedToken.value;
  const fresh = await refreshToken(baseUrl, clientId, clientSecret);
  return fresh.value;
}

/**
 * Server-only rates gateway: one POST /rates/all with the Bearer token, no
 * retries. Malformed/failed provider answers throw — quoteDelivery surfaces
 * them as quote failures (never a zero or stale ongkir).
 */
export function createJubelioShipmentGateway() {
  return {
    async rates(request: ShipmentRatesRequest): Promise<unknown[]> {
      const { baseUrl } = shipmentEnv();
      const token = await currentToken();
      log.info(`Shipment rates requested (host ${new URL(baseUrl).host})`);
      let response: Response;
      try {
        response = await fetch(`${baseUrl}/rates/all`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${token}`,
          },
          // Rates accepts only zip/area/coordinates and item measurement
          // fields. Sender contacts/value belong to booking, not this POST.
          body: JSON.stringify({
            origin: { zipcode: request.origin.zipcode, ...(request.origin.area_id ? { area_id: request.origin.area_id } : {}) },
            destination: { zipcode: request.destination.zipcode, ...(request.destination.area_id ? { area_id: request.destination.area_id } : {}) },
            weight: request.weight,
            ...(request.items ? { items: request.items.map((raw) => {
              const item = raw as Record<string, unknown>;
              return { quantity: item.quantity, weight: item.weight, length: item.length, width: item.width, height: item.height };
            }) } : {}),
          }),
          cache: "no-store",
          signal: AbortSignal.timeout(RATES_TIMEOUT_MS),
        });
      } catch {
        log.error(
          "Shipment rates transport failed — outcome unknown",
          shipmentTransportErrorLog()
        );
        throw new Error("SHIPMENT_UNAVAILABLE");
      }
      if (!response.ok) {
        // The provider answer is never logged; only the status.
        log.error(`Shipment rates request failed (HTTP ${response.status})`);
        throw new Error("SHIPMENT_UNAVAILABLE");
      }
      const body: unknown = await response.json();
      if (!Array.isArray(body)) {
        log.error("Shipment rates response malformed");
        throw new Error("SHIPMENT_MALFORMED");
      }
      return body as unknown[];
    },
  };
}
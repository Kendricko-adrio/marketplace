import { db } from "@/db";
import { eq } from "drizzle-orm";
import { systemConfig } from "@/db";
import { createModuleLogger } from "@/lib/logger";
import { DEFAULT_PPN_RATE_PERCENT, resolvePpnRate } from "@/lib/order-pricing";

/**
 * Module-scope logger: hanya nama module yang di-bind di sini. Field korelasi
 * dibaca dari scope aktif saat baris ditulis, jadi aman dibuat sekali saat
 * import. Nama key config masuk ke message; nilai config mentah tidak pernah
 * dicatat.
 */
const log = createModuleLogger("system-config");

/**
 * Technical failure codes this module is allowed to describe in a log line.
 */
type SystemConfigLogCode = "CONFIG_LOAD_FAILED";

/**
 * Safe technical projection for the `error` field of this module's log lines.
 *
 * The logging core keeps the `name`/`message`/`stack`/`cause` of whatever it is
 * given, redacted by shape only. Passing the raw caught value would publish free
 * text that the database/driver layer put into `message`/`stack`/`cause` (a
 * connection string, a query value). This class is therefore the ONLY value this
 * module hands to a log line; the message and the code are chosen here.
 *
 * The caught value is never lost from the business flow: `loadConfig` still
 * rethrows it unchanged, so the caller keeps its retry-on-next-call contract.
 */
class SystemConfigDependencyError extends Error {
  readonly code?: SystemConfigLogCode;

  constructor(message: string, code?: SystemConfigLogCode) {
    super(message);
    this.name = "SystemConfigDependencyError";
    this.code = code;
  }
}

/** Static projection for a failed config read: no raw error text is copied. */
function systemConfigLoadErrorLog(): SystemConfigDependencyError {
  return new SystemConfigDependencyError(
    "System config gagal dibaca pada lapisan penyimpanan",
    "CONFIG_LOAD_FAILED"
  );
}

/**
 * General-purpose system config reader backed by the `system_config` table.
 *
 * Config is loaded ONCE from the DB (lazily, on first access after the app
 * boots) and held in an in-memory Map for the lifetime of the process. To pick
 * up changes made via SQL, restart the store app.
 *
 * Concurrency: the first call triggers a single load (a shared Promise), so a
 * burst of concurrent first-access callers does not stampede the DB. If the
 * initial load fails, the cache stays unset and the next call retries — so a
 * transient DB outage at boot self-heals instead of permanently pinning
 * fallbacks.
 *
 * Known keys (seeded in packages/db/src/seed.ts):
 *   reservation.ttlMinutes (number, default 15) — minutes a customer has to pay
 *   on the Midtrans Snap page before the order expires and its stock reservation
 *   is released.
 *   tax.ppnRatePercent (number, default 11) — PPN applied after discounts and
 *   rounded upward to a whole Rupiah.
 */

type ConfigEntry = { value: string; type: string };

let cache: Map<string, ConfigEntry> | null = null;
let loadPromise: Promise<Map<string, ConfigEntry>> | null = null;

async function loadConfig(): Promise<Map<string, ConfigEntry>> {
  if (cache) return cache;
  if (!loadPromise) {
    loadPromise = (async () => {
      try {
        const rows = await db.select().from(systemConfig);
        const map = new Map<string, ConfigEntry>();
        for (const row of rows) {
          map.set(row.key, { value: row.value, type: row.type });
        }
        cache = map;
        return map;
      } catch (error) {
        // Don't cache a failure — allow the next call to retry. Callers fall
        // back to their provided default until the DB is reachable.
        log.error(
          "System config load failed; using fallback values",
          systemConfigLoadErrorLog()
        );
        loadPromise = null;
        throw error;
      }
    })();
  }
  return loadPromise;
}

/** Domain writer gate: uncached, so SQL changes take effect on the next request.
 * Missing is legacy0; malformed values and DB failures never become legacy.
 */
export async function getDiscountsContractVersion(): Promise<0 | 1> {
  const [entry] = await db.select({ value: systemConfig.value }).from(systemConfig)
    .where(eq(systemConfig.key, "discounts.contractVersion")).limit(1);
  if (!entry || entry.value === "0") return 0;
  if (entry.value === "1") return 1;
  throw new Error("Unsupported discounts contract version");
}

export async function getConfigString(
  key: string,
  fallback: string
): Promise<string> {
  try {
    const map = await loadConfig();
    return map.get(key)?.value ?? fallback;
  } catch {
    return fallback;
  }
}

export async function getConfigNumber(
  key: string,
  fallback: number
): Promise<number> {
  try {
    const map = await loadConfig();
    const entry = map.get(key);
    if (!entry) return fallback;
    const n = Number(entry.value);
    return Number.isFinite(n) ? n : fallback;
  } catch {
    return fallback;
  }
}

export async function getPpnRatePercent(): Promise<string> {
  const configured = await getConfigString(
    "tax.ppnRatePercent",
    DEFAULT_PPN_RATE_PERCENT
  );
  const resolved = resolvePpnRate(configured);
  const isValid = /^\d+(?:\.\d{1,6})?$/.test(configured.trim()) &&
    Number(configured) >= 0 && Number(configured) <= 100;
  if (!isValid) {
    log.warn(
      `Invalid tax.ppnRatePercent config value; using fallback ${DEFAULT_PPN_RATE_PERCENT}`
    );
  }
  return resolved;
}

export async function getConfigJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const map = await loadConfig();
    const entry = map.get(key);
    if (!entry) return fallback;
    return JSON.parse(entry.value) as T;
  } catch {
    return fallback;
  }
}

/**
 * Clear the in-memory cache so the next getConfig call reloads from the DB.
 * Primarily for tests / manual ops. In production, restart the app to refresh.
 */
export function reloadConfig(): void {
  cache = null;
  loadPromise = null;
}

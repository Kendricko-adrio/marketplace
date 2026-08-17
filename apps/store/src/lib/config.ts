import { db } from "@/db";
import { systemConfig } from "@/db";

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
        console.error("system_config load failed; using fallback values:", error);
        loadPromise = null;
        throw error;
      }
    })();
  }
  return loadPromise;
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

// =========================================================
// WIB (Asia/Jakarta) calendar-day helpers for the 30-day analytics trend
// =========================================================
// The trend window is 30 WIB calendar days ending "today" in the business
// timezone — not a rolling 30×24h window. Indonesia has no DST, so WIB is a
// fixed UTC+7 offset and every conversion here is deterministic.
//
// All functions are pure and take `now` explicitly so callers (route + tests)
// control the clock.

export interface TrendPoint {
  /** WIB calendar day, "YYYY-MM-DD". */
  date: string;
  revenue: number;
  orders: number;
}

/** A per-day aggregate row as returned by the trend query. */
export interface TrendRow {
  day: string;
  revenue: string | number;
  orders: string | number;
}

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000; // Asia/Jakarta = UTC+7, no DST
const DAY_MS = 24 * 60 * 60 * 1000;
const TREND_DAYS = 30;

/** UTC instant of 00:00 WIB on a "YYYY-MM-DD" calendar day. */
function wibMidnightUtc(dayKey: string): number {
  return Date.parse(`${dayKey}T00:00:00+07:00`);
}

/**
 * WIB calendar day key ("YYYY-MM-DD") of an instant. Because WIB is a fixed
 * offset, shifting the instant by +7h and taking the UTC date part yields the
 * WIB wall-clock date.
 */
export function wibDayKey(date: Date): string {
  return new Date(date.getTime() + WIB_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * The 30 consecutive WIB calendar days ending today (WIB), oldest → newest.
 * Day arithmetic happens on the WIB date numbers themselves (via UTC noon
 * anchors), so month and year boundaries are handled by Date.
 */
export function trendWindowKeys(now: Date): string[] {
  const [y, m, d] = wibDayKey(now).split("-").map(Number);
  // Anchor at UTC noon of the WIB today: subtracting whole days from a noon
  // anchor never crosses a day boundary (no DST in UTC).
  const endUtcNoon = Date.UTC(y, m - 1, d, 12);
  const keys: string[] = [];
  for (let i = TREND_DAYS - 1; i >= 0; i--) {
    keys.push(new Date(endUtcNoon - i * DAY_MS).toISOString().slice(0, 10));
  }
  return keys;
}

/**
 * The UTC instant of 00:00 WIB on the oldest trend day — the inclusive lower
 * bound for the trend query (`created_at >= start`). Every order from that
 * instant on falls on one of the 30 WIB window days.
 */
export function trendWindowStart(now: Date): Date {
  return new Date(wibMidnightUtc(trendWindowKeys(now)[0]));
}

/**
 * Merge sparse per-day aggregates into exactly the given window keys,
 * oldest → newest, zero-filling days without rows. Rows outside the window
 * are ignored; values are coerced to numbers (Postgres numeric/bigint arrive
 * as strings).
 */
export function zeroFilledTrend(rows: TrendRow[], keys: string[]): TrendPoint[] {
  const byDay = new Map<string, TrendRow>();
  for (const row of rows) {
    byDay.set(row.day, row);
  }
  return keys.map((key) => {
    const row = byDay.get(key);
    return {
      date: key,
      revenue: row ? Number(row.revenue) : 0,
      orders: row ? Number(row.orders) : 0,
    };
  });
}
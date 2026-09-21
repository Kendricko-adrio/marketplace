import { describe, expect, it } from "vitest";
import {
  trendWindowKeys,
  trendWindowStart,
  wibDayKey,
  zeroFilledTrend,
} from "./analytics-wib";

// =========================================================
// Pure WIB (Asia/Jakarta, fixed UTC+7, no DST) calendar-day helpers for the
// 30-day analytics trend window. All expected values below are hand-computed
// fixed literals — an independent source of truth (no shared arithmetic with
// the implementation).
//
// Case anchors were chosen so the WIB calendar day differs from the UTC day
// and the window crosses month and year boundaries.
// =========================================================

// 2025-06-15T18:30Z = 2025-06-16T01:30 WIB → "today" in WIB is 2025-06-16.
const NOW_JUNE = new Date("2025-06-15T18:30:00Z");
// 2025-07-02T00:30Z = 2025-07-02T07:30 WIB → window crosses June → July.
const NOW_JULY = new Date("2025-07-02T00:30:00Z");
// 2025-01-01T03:00Z = 2025-01-01T10:00 WIB → window crosses 2024 → 2025.
const NOW_JANUARY = new Date("2025-01-01T03:00:00Z");

describe("wibDayKey", () => {
  it("formats an instant as its WIB calendar day", () => {
    expect(wibDayKey(new Date("2025-06-15T02:00:00Z"))).toBe("2025-06-15");
    expect(wibDayKey(NOW_JUNE)).toBe("2025-06-16");
  });

  it("rolls over at exactly 17:00 UTC (= 00:00 WIB the next day)", () => {
    expect(wibDayKey(new Date("2025-06-15T16:59:59Z"))).toBe("2025-06-15");
    expect(wibDayKey(new Date("2025-06-15T17:00:00Z"))).toBe("2025-06-16");
  });
});

describe("trendWindowKeys", () => {
  it("returns exactly 30 WIB days ending today, oldest to newest", () => {
    const keys = trendWindowKeys(NOW_JUNE);
    expect(keys).toHaveLength(30);
    expect(keys[0]).toBe("2025-05-18"); // 2025-06-16 minus 29 days
    expect(keys[28]).toBe("2025-06-15");
    expect(keys[29]).toBe("2025-06-16"); // today (WIB)
  });

  it("crosses month boundaries", () => {
    const keys = trendWindowKeys(NOW_JULY);
    expect(keys[0]).toBe("2025-06-03");
    expect(keys[29]).toBe("2025-07-02");
  });

  it("crosses year boundaries", () => {
    const keys = trendWindowKeys(NOW_JANUARY);
    expect(keys[0]).toBe("2024-12-03");
    expect(keys[29]).toBe("2025-01-01");
  });

  it("keys are unique and consecutive calendar days", () => {
    const keys = trendWindowKeys(NOW_JUNE);
    expect(new Set(keys).size).toBe(30);
    for (let i = 1; i < keys.length; i++) {
      const prev = Date.parse(`${keys[i - 1]}T00:00:00Z`);
      const curr = Date.parse(`${keys[i]}T00:00:00Z`);
      expect(curr - prev).toBe(24 * 60 * 60 * 1000);
    }
  });
});

describe("trendWindowStart", () => {
  it("is 00:00 WIB on the oldest window day, as a UTC instant", () => {
    expect(trendWindowStart(NOW_JUNE).toISOString()).toBe(
      "2025-05-17T17:00:00.000Z"
    );
    expect(trendWindowStart(NOW_JULY).toISOString()).toBe(
      "2025-06-02T17:00:00.000Z"
    );
    expect(trendWindowStart(NOW_JANUARY).toISOString()).toBe(
      "2024-12-02T17:00:00.000Z"
    );
  });

  it("starts exactly on the oldest trend day (self-consistency)", () => {
    expect(wibDayKey(trendWindowStart(NOW_JUNE))).toBe(
      trendWindowKeys(NOW_JUNE)[0]
    );
  });
});

describe("zeroFilledTrend", () => {
  // Window for NOW_JUNE: "2025-05-18" … "2025-06-16" (30 days).
  const keys = trendWindowKeys(NOW_JUNE);

  it("zero-fills sparse per-day aggregates into exactly the 30 window entries", () => {
    const points = zeroFilledTrend(
      [
        { day: "2025-05-19", revenue: "40000.50", orders: "1" },
        { day: "2025-06-16", revenue: "120000", orders: 2 },
      ],
      keys
    );

    expect(points).toHaveLength(30);
    expect(points[0]).toEqual({ date: "2025-05-18", revenue: 0, orders: 0 });
    expect(points[1]).toEqual({ date: "2025-05-19", revenue: 40000.5, orders: 1 });
    expect(points[29]).toEqual({
      date: "2025-06-16",
      revenue: 120000,
      orders: 2,
    });
  });

  it("dates run oldest to newest matching the given keys", () => {
    const points = zeroFilledTrend([], keys);
    expect(points.map((p) => p.date)).toEqual(keys);
  });

  it("returns numeric revenue and orders (not SQL strings)", () => {
    const [point] = zeroFilledTrend(
      [{ day: "2025-05-18", revenue: "2500.00", orders: "3" }],
      keys
    );
    expect(point.revenue).toBe(2500);
    expect(point.orders).toBe(3);
    expect(typeof point.revenue).toBe("number");
    expect(typeof point.orders).toBe("number");
  });

  it("ignores aggregates outside the window", () => {
    const points = zeroFilledTrend(
      [{ day: "2025-05-01", revenue: "999999", orders: 99 }],
      keys
    );
    expect(points).toHaveLength(30);
    expect(points.every((p) => p.revenue === 0 && p.orders === 0)).toBe(true);
  });
});
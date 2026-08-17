import { describe, it, expect } from "vitest";
import {
  getDayHours,
  generateTimeSlots,
  validatePickupSlot,
  formatDateLabel,
} from "./pickup-validation";
import type { OperatingHours } from "@/db";

// Backs the checkout step-2 validation and place-order pickup-slot check.
const HOURS: OperatingHours = {
  monday: { open: "09:00", close: "21:00" },
  sunday: null, // closed
};

describe("getDayHours", () => {
  it("returns the hours for the date's day of week", () => {
    // 2026-08-17 is a Monday.
    expect(getDayHours(HOURS, new Date(2026, 7, 17))).toEqual({
      open: "09:00",
      close: "21:00",
    });
  });

  it("returns null when the branch is closed that day", () => {
    // 2026-08-16 is a Sunday.
    expect(getDayHours(HOURS, new Date(2026, 7, 16))).toBeNull();
  });

  it("returns null when no operating hours exist", () => {
    expect(getDayHours(null, new Date(2026, 7, 17))).toBeNull();
  });
});

describe("generateTimeSlots", () => {
  it("generates 30-minute slots from open to close", () => {
    const slots = generateTimeSlots({ open: "09:00", close: "11:00" });
    expect(slots).toEqual(["09:00", "09:30", "10:00", "10:30"]);
  });

  it("returns an empty list when closed", () => {
    expect(generateTimeSlots(null)).toEqual([]);
  });

  it("pads single-digit hours", () => {
    const slots = generateTimeSlots({ open: "8:00", close: "9:00" });
    expect(slots[0]).toBe("08:00");
  });
});

describe("validatePickupSlot", () => {
  const beforeOpening = new Date("2026-08-17T08:00:00+07:00");

  it("accepts a valid open-day slot", () => {
    expect(
      validatePickupSlot(HOURS, "2026-08-17", "10:00", beforeOpening)
    ).toEqual({ ok: true });
  });

  it("rejects a closed day", () => {
    expect(validatePickupSlot(HOURS, "2026-08-16", "10:00", beforeOpening)).toMatchObject({
      ok: false,
      error: /closed/,
    });
  });

  it("rejects a time outside operating hours", () => {
    expect(validatePickupSlot(HOURS, "2026-08-17", "08:00", beforeOpening)).toMatchObject({
      ok: false,
      error: /between 09:00 and 21:00/,
    });
  });

  it("rejects a time that is not a 30-minute slot", () => {
    expect(validatePickupSlot(HOURS, "2026-08-17", "10:15", beforeOpening)).toMatchObject({
      ok: false,
      error: /30-min/,
    });
  });

  it("rejects an overflowing calendar date", () => {
    expect(
      validatePickupSlot(HOURS, "2026-02-31", "10:00", beforeOpening)
    ).toMatchObject({ ok: false, error: /Invalid pickup date/ });
  });

  it("rejects a pickup time that already passed today in Jakarta", () => {
    expect(
      validatePickupSlot(
        HOURS,
        "2026-08-17",
        "10:00",
        new Date("2026-08-17T10:01:00+07:00")
      )
    ).toMatchObject({ ok: false, error: /future/ });
  });

  it("rejects a past date", () => {
    expect(validatePickupSlot(HOURS, "2020-01-01", "10:00")).toMatchObject({
      ok: false,
      error: /past/,
    });
  });

  it("rejects missing date or time", () => {
    expect(validatePickupSlot(HOURS, "", "10:00")).toMatchObject({
      ok: false,
      error: /required/,
    });
    expect(validatePickupSlot(HOURS, "2026-08-17", "")).toMatchObject({
      ok: false,
      error: /required/,
    });
  });
});

describe("formatDateLabel", () => {
  it("formats a date in Indonesian locale", () => {
    expect(formatDateLabel("2026-08-17")).toContain("2026");
  });

  it("returns an empty string for no date", () => {
    expect(formatDateLabel("")).toBe("");
  });
});

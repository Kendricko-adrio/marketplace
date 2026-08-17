import type { OperatingHours, DayHours } from "@/db";

// Days of the week keyed as in OperatingHours. Sunday = 0.
const DAY_KEYS: (keyof OperatingHours)[] = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

export interface PickupValidationResult {
  ok: boolean;
  error?: string;
}

/**
 * Get the OperatingHours entry for a specific date's day of week.
 */
export function getDayHours(
  operatingHours: OperatingHours | null | undefined,
  date: Date
): DayHours {
  if (!operatingHours) return null;
  const dayKey = DAY_KEYS[date.getDay()];
  return operatingHours[dayKey] ?? null;
}

/**
 * Generate 30-minute interval time slots between open and close.
 * Returns ["09:00", "09:30", "10:00", ...] or [] if closed.
 */
export function generateTimeSlots(dayHours: DayHours): string[] {
  if (!dayHours) return [];
  const [openH, openM] = dayHours.open.split(":").map(Number);
  const [closeH, closeM] = dayHours.close.split(":").map(Number);
  const slots: string[] = [];
  let h = openH;
  let m = openM;
  while (h < closeH || (h === closeH && m < closeM)) {
    slots.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
    m += 30;
    if (m >= 60) {
      m -= 60;
      h += 1;
    }
  }
  return slots;
}

/**
 * Validate a pickup date + time against a branch's operating hours.
 * Used both client-side (Step 2) and server-side (place-order).
 *
 * Checks:
 *  - date is not in the past
 *  - the branch is open on that day of week
 *  - the time is within open/close and matches a 30-min slot
 */
export function validatePickupSlot(
  operatingHours: OperatingHours | null | undefined,
  pickupDate: string, // "YYYY-MM-DD"
  pickupTime: string, // "HH:mm"
  now: Date = new Date()
): PickupValidationResult {
  if (!pickupDate) return { ok: false, error: "Pickup date is required." };
  if (!pickupTime) return { ok: false, error: "Pickup time is required." };

  if (!/^\d{4}-\d{2}-\d{2}$/.test(pickupDate)) {
    return { ok: false, error: "Invalid pickup date." };
  }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(pickupTime)) {
    return { ok: false, error: "Invalid pickup time." };
  }

  const [y, mo, d] = pickupDate.split("-").map(Number);
  const date = new Date(Date.UTC(y, mo - 1, d));

  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== mo - 1 ||
    date.getUTCDate() !== d
  ) {
    return { ok: false, error: "Invalid pickup date." };
  }

  const jakartaDateParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    jakartaDateParts.find((value) => value.type === type)?.value ?? "";
  const todayInJakarta = `${part("year")}-${part("month")}-${part("day")}`;

  if (pickupDate < todayInJakarta) {
    return { ok: false, error: "Pickup date cannot be in the past." };
  }

  const dayHours = operatingHours?.[DAY_KEYS[date.getUTCDay()]] ?? null;
  if (!dayHours) {
    return { ok: false, error: "Branch is closed on the selected day." };
  }

  const slots = generateTimeSlots(dayHours);
  if (!slots.includes(pickupTime)) {
    return {
      ok: false,
      error: `Pickup time must be between ${dayHours.open} and ${dayHours.close} (30-min intervals).`,
    };
  }

  if (pickupDateToInstant(pickupDate, pickupTime) <= now) {
    return { ok: false, error: "Pickup date and time must be in the future." };
  }

  return { ok: true };
}

export function pickupDateToInstant(
  pickupDate: string,
  pickupTime = "00:00"
): Date {
  return new Date(`${pickupDate}T${pickupTime}:00+07:00`);
}

/**
 * Format a date string "YYYY-MM-DD" into a readable label.
 */
export function formatDateLabel(pickupDate: string): string {
  if (!pickupDate) return "";
  const [y, mo, d] = pickupDate.split("-").map(Number);
  const date = new Date(y, mo - 1, d);
  return date.toLocaleDateString("id-ID", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

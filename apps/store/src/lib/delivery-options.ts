export const DELIVERY_CATEGORY_FILTERS = [
  { id: "all", label: "Semua · Termurah" },
  { id: "regular-economy", label: "Reguler/Ekonomi" },
  { id: "nextday", label: "Next Day" },
  { id: "sameday", label: "Same Day" },
  { id: "instant", label: "Instant" },
  { id: "other", label: "Lainnya" },
] as const;

export type DeliveryCategoryFilter = typeof DELIVERY_CATEGORY_FILTERS[number]["id"];

/** Official Jubelio IDs only; absent/unknown metadata is never a speed guess. */
function categoryGroup(categoryId?: number | null): Exclude<DeliveryCategoryFilter, "all"> {
  switch (categoryId) {
    case 1:
    case 2: return "regular-economy";
    case 3: return "nextday";
    case 4: return "instant";
    case 5: return "sameday";
    default: return "other";
  }
}

const DELIVERY_PAGE_SIZE = 5;
const etaDateFormat = new Intl.DateTimeFormat("id-ID", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Asia/Jakarta",
});

/** Vendor arrival dates, not a duration or a guaranteed delivery appointment. */
export function formatDeliveryEta(eta?: { from: string; to: string }): string {
  const unavailable = "Estimasi tiba belum tersedia";
  if (!eta) return unavailable;
  const from = new Date(eta.from);
  const to = new Date(eta.to);
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from > to) {
    return unavailable;
  }
  const parts = (date: Date) => {
    const values = etaDateFormat.formatToParts(date);
    return {
      day: values.find((part) => part.type === "day")!.value,
      month: values.find((part) => part.type === "month")!.value,
      year: values.find((part) => part.type === "year")!.value,
    };
  };
  const start = parts(from);
  const end = parts(to);
  const endLabel = `${end.day} ${end.month} ${end.year}`;
  if (start.year !== end.year) {
    return `Estimasi tiba ${start.day} ${start.month} ${start.year}–${endLabel}`;
  }
  if (start.month !== end.month) {
    return `Estimasi tiba ${start.day} ${start.month}–${endLabel}`;
  }
  return start.day === end.day
    ? `Estimasi tiba ${endLabel}`
    : `Estimasi tiba ${start.day}–${endLabel}`;
}

/** Filter first, then cheapest-first pagination; never alter quote pricing. */
export function getDeliveryOptionsPage<T extends { shippingCost: number; serviceCategoryId?: number | null }>(
  services: readonly T[],
  requestedPage: number,
  category: DeliveryCategoryFilter = "all",
) {
  const categoryCounts: Record<DeliveryCategoryFilter, number> = {
    all: services.length, "regular-economy": 0, nextday: 0, sameday: 0, instant: 0, other: 0,
  };
  for (const service of services) categoryCounts[categoryGroup(service.serviceCategoryId)] += 1;
  const sorted = services
    .filter((service) => category === "all" || categoryGroup(service.serviceCategoryId) === category)
    .sort((a, b) => a.shippingCost - b.shippingCost);
  const total = sorted.length;
  const pageCount = Math.max(1, Math.ceil(total / DELIVERY_PAGE_SIZE));
  const page = Math.min(pageCount, Math.max(1, Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 1));
  const offset = (page - 1) * DELIVERY_PAGE_SIZE;
  return {
    options: sorted.slice(offset, offset + DELIVERY_PAGE_SIZE),
    page,
    pageCount,
    start: total === 0 ? 0 : offset + 1,
    end: Math.min(offset + DELIVERY_PAGE_SIZE, total),
    total,
    cheapestCost: sorted[0]?.shippingCost,
    categoryCounts,
  };
}

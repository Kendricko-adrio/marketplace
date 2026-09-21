// =========================================================
// Shared display formatting for the analytics dashboard (Indonesian UI).
// Client-side only rendering — the dashboard fetches after mount, so these
// never run during SSR/hydration.
// =========================================================

/** Rupiah currency, no decimals (repo-wide convention). */
export function formatRupiah(value: number | string): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(Number(value));
}

/** Compact rupiah for chart axis ticks (e.g. "1,2 jt"). */
export function formatRupiahCompact(value: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

/** "2025-06-16" → "16/06" for axis ticks. */
export function formatTrendTick(dateKey: string): string {
  return `${dateKey.slice(8, 10)}/${dateKey.slice(5, 7)}`;
}

/** "2025-06-16" → "16 Jun 2025" for tooltips/table (deterministic, no tz math). */
const MONTHS_ID = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "Mei",
  "Jun",
  "Jul",
  "Agu",
  "Sep",
  "Okt",
  "Nov",
  "Des",
] as const;

export function formatTrendDate(dateKey: string): string {
  const day = Number(dateKey.slice(8, 10));
  const month = Number(dateKey.slice(5, 7));
  const year = dateKey.slice(0, 4);
  return `${day} ${MONTHS_ID[month - 1]} ${year}`;
}

/** Order status → Indonesian display label. */
export const STATUS_LABELS: Record<string, string> = {
  pending_payment: "Menunggu Pembayaran",
  processing: "Diproses",
  ready_for_pickup: "Siap Diambil",
  completed: "Selesai",
  cancelled: "Dibatalkan",
  failed_payment: "Pembayaran Gagal",
};

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}
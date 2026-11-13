/**
 * Formatter halaman detail pesanan customer. Semua label tanggal/waktu
 * mengikuti konvensi browser existing (`id-ID`), tanpa mengasumsikan zona
 * waktu WIB.
 */

export function formatRupiah(value: string) {
  return `Rp ${parseFloat(value).toLocaleString("id-ID")}`;
}

export function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function formatDateTime(dateStr: string) {
  return new Date(dateStr).toLocaleString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Label wajib untuk timestamp yang kosong atau tidak valid. */
export const TIME_UNAVAILABLE = "Waktu tidak tersedia";

/**
 * Waktu event timeline: waktu event dari DTO, atau `Waktu tidak tersedia`
 * bila kosong/tidak valid. Tidak pernah diisi waktu pembuatan order.
 */
export function formatTrackingTime(value: string | null): string {
  if (!value) return TIME_UNAVAILABLE;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return TIME_UNAVAILABLE;
  return formatDateTime(value);
}

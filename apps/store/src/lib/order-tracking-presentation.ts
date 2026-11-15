/**
 * Aturan presentasi tracking untuk halaman detail pesanan customer.
 *
 * Modul ini murni: tidak ada query, provider call, atau state. Sumber status
 * adalah DTO GET `/api/orders/[id]` (timeline hanya event `applied`), sehingga
 * helper ini tidak pernah menambah arti yang tidak dikirim backend.
 */

/**
 * Satu event timeline dari DTO pesanan. Dipakai juga oleh tipe UI di
 * `components/orders/order-detail-types.ts` (re-export) agar bentuknya satu.
 */
export interface OrderTimelineEvent {
  status: string | null;
  detail: string | null;
  at: string | null;
}

/** Heading netral untuk status kosong/asing — kode internal tidak dipakai. */
export const TRACKING_UPDATE_HEADING = "Pembaruan pengiriman";

/**
 * Normalized provider status → label customer. `ON_THE_WAY_PICKUP` ikut
 * dipetakan karena plan memakai ejaan itu; status kanonik runtime adalah
 * `ON_THE_WAY_PICK_UP` (packages/db/src/shipment-tracking.ts).
 */
const TRACKING_STATUS_LABELS: Record<string, string> = {
  WAITING: "Menunggu kurir",
  CONFIRMED_BY_COURIER: "Kurir dikonfirmasi",
  ON_THE_WAY_PICK_UP: "Kurir menuju lokasi pengambilan",
  ON_THE_WAY_PICKUP: "Kurir menuju lokasi pengambilan",
  PICKED_UP: "Paket diambil kurir",
  ON_DELIVERY: "Dalam pengantaran",
  DELIVERED: "Paket telah diterima",
  ON_HOLD: "Pengiriman tertunda",
  RETURNED: "Paket dikembalikan",
  CANCELED: "Pengiriman dibatalkan",
  SHIPMENT_ISSUE: "Pengiriman mengalami kendala",
};

export function getTrackingStatusLabel(status: string | null): string {
  if (!status) return TRACKING_UPDATE_HEADING;
  return TRACKING_STATUS_LABELS[status] ?? TRACKING_UPDATE_HEADING;
}

/**
 * Penanda detail dari `scripts/simulate-jubelio-shipment.sh`. Hanya marker
 * simulator repo yang disembunyikan; pesan kurir lain tetap ditampilkan.
 */
const SIMULATOR_DETAIL_MARKER = /simulasi webhook jubelio:/i;

export function getCustomerTrackingDetail(detail: string | null): string | null {
  if (!detail) return null;
  if (SIMULATOR_DETAIL_MARKER.test(detail)) return null;
  return detail;
}

/**
 * Salinan urutan terbaru dahulu untuk tampilan. Tidak mengurutkan ulang
 * berdasarkan timestamp provider (bisa kosong/tidak berurutan) dan tidak
 * mengubah array sumber.
 */
export function newestTrackingEvents(
  events: readonly OrderTimelineEvent[]
): OrderTimelineEvent[] {
  return [...events].reverse();
}

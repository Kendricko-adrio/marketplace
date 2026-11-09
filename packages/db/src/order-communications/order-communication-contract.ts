/**
 * Kontrak domain `order-communications` (spec: penyelarasan status, notifikasi,
 * dan email order).
 *
 * Modul ini SENGAJA tanpa runtime app: hanya tipe/konstanta yang aman dipakai
 * bersama oleh `packages/db`, app store dan app admin. Tidak ada import auth,
 * SMTP, logger app, atau gateway provider.
 */

import type {
  OrderCommunicationKindDb,
  OrderEmailJobStatusDb,
} from "../schema/order-communications";

/** Fakta komunikasi yang boleh dicatat (7 jenis). */
export type OrderCommunicationKind = OrderCommunicationKindDb;

/** Jenis fakta yang punya pekerjaan email (semua kecuali penutupan manual). */
export type OrderEmailKind = Exclude<
  OrderCommunicationKind,
  "delivery_closed_manually"
>;

export type OrderEmailJobStatus = OrderEmailJobStatusDb;

/** 1 percobaan awal + maksimal 3 retry = paling banyak empat dispatch. */
export const ORDER_EMAIL_MAX_ATTEMPTS = 4;

/** Jeda retry lima menit dari kegagalan/hasil tidak pasti terakhir. */
export const ORDER_EMAIL_RETRY_DELAY_MS = 5 * 60_000;

/** Lease claim lima menit (timeout transport wajib lebih pendek). */
export const ORDER_EMAIL_LEASE_MS = 5 * 60_000;

/** Marker batas komunikasi untuk order baru (baris lama tetap 0). */
export const ORDER_COMMUNICATION_VERSION_CURRENT = 1;

export const ORDER_EMAIL_KINDS: readonly OrderEmailKind[] = [
  "delivery_ready",
  "delivery_in_transit",
  "delivery_delivered",
  "pickup_ready",
  "pickup_completed",
  "payment_failed",
];

/**
 * Keadaan authoritative yang boleh dipakai policy. SEMUA field berasal dari
 * baris tersimpan (orders + delivery shipment ledger), bukan payload webhook,
 * bukan data akun yang bisa berubah.
 */
export type OrderCommunicationStage = {
  fulfillmentMethod: "pickup" | "delivery" | null;
  orderStatus: string;
  paymentStatus: string;
  /** Gate finansial terverifikasi (paid + invoice/payment/provider ledger sah). */
  ready: boolean;
  /** Bukti pertama barang dibawa (serah-terima petugas atau kurir PICKED_UP/ON_DELIVERY). */
  inTransit: boolean;
  /** Bukti DELIVERED valid dan cocok dengan shipment/order. */
  delivered: boolean;
  /** Penutupan manual: penanganan berakhir, BUKAN bukti barang diterima. */
  closedManually: boolean;
};

export type OrderCommunicationEventSnapshot = {
  id: string;
  kind: OrderCommunicationKind;
  source: string;
  occurredAt: Date | null;
  receivedAt: Date;
  emailJobCreatedAt: Date | null;
  notificationCreatedAt: Date | null;
};

export type OrderEmailJobSnapshot = {
  id: string;
  kind: OrderEmailKind;
  eventId: string;
  status: OrderEmailJobStatus;
  attemptCount: number;
  nextAttemptAt: Date;
  claimToken: string | null;
  leaseUntil: Date | null;
  sentAt: Date | null;
  errorCode: string | null;
};

export type OrderCommunicationState = {
  orderId: string;
  orderCommunicationVersion: number;
  stage: OrderCommunicationStage;
  events: OrderCommunicationEventSnapshot[];
  emailJobs: OrderEmailJobSnapshot[];
};

/** Job yang sudah di-claim (attempt SUDAH dinaikkan sebelum dispatch). */
export type ClaimedOrderEmailJob = {
  id: string;
  orderId: string;
  kind: OrderEmailKind;
  eventId: string;
  attemptCount: number;
  claimToken: string;
  leaseUntil: Date;
};

/** Hasil satu dispatch email; tidak pernah mengekspos raw transport error. */
export type OrderEmailSendOutcome =
  | "accepted"
  | "temporary"
  | "uncertain"
  | "permanent";

export type OrderEmailContent = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

export type OrderCommunicationSummary = {
  projected: number;
  recoveredEvents: number;
  emailJobsCreated: number;
  notificationsCreated: number;
  channelMirrorAttempted: number;
};

export type OrderEmailDispatchSummary = {
  claimed: number;
  sent: number;
  retry: number;
  failed: number;
  superseded: number;
  rejectedUnavailable: number;
};

export type OrderCommunicationSweepSummary = OrderCommunicationSummary &
  OrderEmailDispatchSummary;

export function isOrderEmailKind(
  kind: OrderCommunicationKind
): kind is OrderEmailKind {
  return kind !== "delivery_closed_manually";
}

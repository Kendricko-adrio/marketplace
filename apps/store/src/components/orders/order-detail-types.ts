import type { DeliverySnapshotPayload } from "@marketplace/db/src/schema";
import type { OrderTimelineEvent } from "@/lib/order-tracking-presentation";

/**
 * Bentuk DTO halaman detail pesanan — cermin dari GET `/api/orders/[id]`.
 * Hanya tipe: nilai tetap berasal dari API, tidak ada query di sini.
 *
 * `OrderTimelineEvent` sengaja tinggal di modul presentasi tracking supaya
 * helper timeline dan tipe UI memakai satu definisi (re-export di bawah).
 */
export type { OrderTimelineEvent };

export interface OrderItem {
  id: string;
  orderId: string;
  variantId: string;
  productName: string;
  variantInfo: string | null;
  price: string;
  quantity: number;
  createdAt: string;
  productId: string;
  imageUrl: string | null;
  slug: string | null;
}

export interface Branch {
  id: string;
  name: string;
  address: string;
  city: string;
  operatingHours: Record<string, unknown>;
}

/**
 * Ticket 06 — permukaan tracking customer-safe: resi/link/latest status,
 * pencapaian delivered, bukti, dan timeline event yang sudah `applied`.
 */
export interface OrderShipment {
  awb: string;
  trackingUrl: string | null;
  latestStatus: string | null;
  delivered: boolean;
  deliveredAt: string | null;
  podUrl: string | null;
  timeline: OrderTimelineEvent[];
}

/** TX-02: proyeksi pemulihan pembayaran yang owner-scoped (read only). */
export interface OrderPaymentRecovery {
  state: string;
  message: string;
  paymentAvailable: boolean;
  canInitialize: boolean;
  redirectUrl: string | null;
  expiresAt: string | null;
}

export interface OrderDetail {
  id: string;
  userId: string;
  status: string;
  paymentMethod: string | null;
  paymentStatus: string;
  paymentFailureReason: string | null;
  /** Ticket 07 — paid but settlement/fulfillment is blocked for review. */
  fulfillmentBlockedReason: string | null;
  pickupCode: string | null;
  pickupDate: string | null;
  pickupTime: string | null;
  contactPhone: string;
  contactEmail: string;
  subtotal: string;
  shippingCost: string;
  discount: string;
  serviceFee: string;
  ppnRate: string;
  ppnAmount: string;
  total: string;
  createdAt: string;
  snapRedirectUrl: string | null;
  paymentRecovery: OrderPaymentRecovery | null;
  // Ticket 04 — the fulfillment method + the immutable delivery snapshot.
  fulfillmentMethod: string;
  deliverySnapshot: DeliverySnapshotPayload | null;
  /** Ticket 07 — this customer's own Coupon redemption (public, no code). */
  promo: {
    name: string | null;
    benefitAmount: string;
    status: string;
    consumedAt: string | null;
    releasedAt: string | null;
  } | null;
  shipment: OrderShipment | null;
  branch: Branch | null;
  items: OrderItem[];
}

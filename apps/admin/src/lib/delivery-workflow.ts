// Browser-safe presentation of authoritative evidence. Never authorizes a write.
export interface DeliveryEvidence {
  status: string;
  paymentStatus: string;
  paymentVerificationPending?: boolean;
  settlementVerified?: boolean;
  fulfillmentBlockedReason?: string | null;
  deliveryFailureCode?: string | null;
  deliveryManualAt?: string | Date | null;
  shipment?: {
    state: string;
    latestStatus?: string | null;
    handedOverAt?: string | Date | null;
    attemptCount?: number;
  } | null;
}

export const DELIVERY_STAGE_LABELS: string[] = [
  "Menunggu pembayaran", "Verifikasi pembayaran", "Verifikasi tertunda", "Siapkan barang", "Barang siap", "Menunggu penjemputan", "Diserahkan ke kurir", "Dibawa kurir", "Dalam pengiriman", "Barang diterima", "Selesai manual", "Menunggu hasil booking", "Booking belum pasti", "Stok tidak tersedia", "Barang rusak", "Batas layanan terlampaui", "Pengiriman tertahan", "Barang dikembalikan", "Pengiriman dibatalkan", "Kendala pengiriman",
];

export interface DeliveryStage {
  label: string;
  guidance: string;
  terminal: boolean;
}

export function projectDeliveryStage(evidence: DeliveryEvidence): DeliveryStage {
  const result = (label: string, guidance: string, terminal = false) => ({ label, guidance, terminal });
  if (evidence.status === "completed" && evidence.deliveryManualAt) {
    return result("Selesai manual", "Order ditutup manual.", true);
  }
  if (evidence.shipment?.latestStatus === "DELIVERED") {
    return result("Barang diterima", "Barang telah diterima. Pengiriman selesai.", true);
  }
  // A terminal lifecycle without the supporting delivery evidence is not arrival.
  if (["completed", "cancelled", "failed_payment"].includes(evidence.status)) {
    return result("Order tidak aktif", "Tidak ada tindakan pemenuhan berikutnya.", true);
  }
  if (evidence.paymentStatus !== "paid") {
    return evidence.paymentVerificationPending
      ? result("Verifikasi pembayaran", "Tunggu verifikasi pembayaran.")
      : result("Menunggu pembayaran", "Tunggu pembayaran pelanggan.");
  }
  if (evidence.fulfillmentBlockedReason || evidence.settlementVerified === false) {
    return result("Verifikasi tertunda", "Pembayaran diterima. Tunggu verifikasi Jubelio.");
  }
  const failures: Record<string, [string, string]> = {
    physical_stock_unavailable: ["Stok tidak tersedia", "Stok tidak tersedia. Tindak lanjuti di luar aplikasi."],
    damaged_goods: ["Barang rusak", "Barang rusak. Tindak lanjuti di luar aplikasi."],
    paid_service_limits_exceeded: ["Batas layanan terlampaui", "Paket melebihi batas layanan. Tindak lanjuti di luar aplikasi."],
  };
  const failure = failures[evidence.deliveryFailureCode ?? ""];
  if (failure) return result(...failure);
  const shipment = evidence.shipment;
  if (shipment?.state === "booking_dispatched") return result("Menunggu hasil booking", "Hasil booking belum tersedia. Jangan pesan ulang.");
  if (shipment?.state === "booking_unknown") return result("Booking belum pasti", "Konfirmasi ke Jubelio. Jangan pesan ulang.");
  const courier: Record<string, [string, string]> = {
    PICKED_UP: ["Dibawa kurir", "Barang dibawa kurir. Pantau pengiriman."],
    ON_DELIVERY: ["Dalam pengiriman", "Barang dalam pengiriman. Pantau pengiriman."],
    ON_HOLD: ["Pengiriman tertahan", "Pengiriman tertahan. Konfirmasi ke kurir."],
    RETURNED: ["Barang dikembalikan", "Kurir melaporkan pengembalian. Tindak lanjuti kendala."],
    CANCELED: ["Pengiriman dibatalkan", "Pengiriman dibatalkan kurir. Tindak lanjuti kendala."],
    SHIPMENT_ISSUE: ["Kendala pengiriman", "Pengiriman bermasalah. Konfirmasi ke kurir."],
  };
  const observation = courier[shipment?.latestStatus ?? ""];
  if (observation) return result(...observation);
  if (shipment?.handedOverAt) return result("Diserahkan ke kurir", "Barang diserahkan. Tunggu update kurir.");
  if (shipment?.state === "booked") return result("Menunggu penjemputan", "Tunggu kurir. Catat serah terima setelah barang diserahkan.");
  if (shipment?.state === "packed") return result("Barang siap", (shipment.attemptCount ?? 0) > 0 ? "Booking sebelumnya tidak terbentuk. Pesan pengiriman." : "Barang siap. Pesan pengiriman.");
  return result("Siapkan barang", "Siapkan barang, lalu tandai siap.");
}

export interface DeliveryAccess {
  known: boolean;
  allowed: boolean;
  reasons: string[];
}

export function projectDeliveryAccess(input: {
  canEditOrders?: boolean;
  homeBranchId?: string | null;
  homeBranchName?: string | null;
  orderBranchId: string | null;
  orderBranchName?: string | null;
}): DeliveryAccess {
  if (input.canEditOrders === undefined || input.homeBranchId === undefined) {
    return { known: false, allowed: false, reasons: ["Kelayakan tindakan belum dapat dipastikan. Muat ulang detail sebelum melanjutkan."] };
  }
  const reasons: string[] = [];
  if (!input.canEditOrders) reasons.push("Hanya dapat dilihat. Anda tidak memiliki izin mengubah order.");
  if (!input.homeBranchId) {
    reasons.push("Hanya dapat dilihat. Tindakan pemenuhan memerlukan Home Branch yang sesuai dengan cabang order. Akun Anda belum memiliki Home Branch.");
  } else if (input.homeBranchId !== input.orderBranchId) {
    reasons.push(`Hanya dapat dilihat. Home Branch Anda: ${input.homeBranchName ?? input.homeBranchId}. Cabang order: ${input.orderBranchName ?? input.orderBranchId ?? "Belum tersedia"}. Tindakan pemenuhan harus dilakukan oleh staff dengan Home Branch ${input.orderBranchName ?? input.orderBranchId ?? "sesuai cabang order"} dan izin yang sesuai.`);
  }
  return { known: true, allowed: reasons.length === 0, reasons };
}

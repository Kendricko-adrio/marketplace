import { describe, expect, it } from "vitest";
import { projectDeliveryStage, projectDeliveryAccess } from "./delivery-workflow";

const paid = { status: "processing", paymentStatus: "paid", settlementVerified: true };

describe("delivery evidence presented to authorized viewers", () => {
  it.each([
    [{ paymentStatus: "pending" }, "Menunggu pembayaran", "Tunggu pembayaran pelanggan."],
    [{ paymentStatus: "pending", paymentVerificationPending: true }, "Verifikasi pembayaran", "Tunggu verifikasi pembayaran."],
    [{ settlementVerified: false }, "Verifikasi tertunda", "Pembayaran diterima. Tunggu verifikasi Jubelio."],
    [{}, "Siapkan barang", "Siapkan barang, lalu tandai siap."],
    [{ shipment: { state: "packed" } }, "Barang siap", "Barang siap. Pesan pengiriman."],
    [{ shipment: { state: "packed", attemptCount: 1 } }, "Barang siap", "Booking sebelumnya tidak terbentuk. Pesan pengiriman."],
    [{ shipment: { state: "booked" } }, "Menunggu penjemputan", "Tunggu kurir. Catat serah terima setelah barang diserahkan."],
    [{ shipment: { state: "booked", handedOverAt: "2026-05-01", latestStatus: "WAITING" } }, "Diserahkan ke kurir", "Barang diserahkan. Tunggu update kurir."],
    [{ shipment: { state: "booked", latestStatus: "PICKED_UP" } }, "Dibawa kurir", "Barang dibawa kurir. Pantau pengiriman."],
    [{ shipment: { state: "booked", latestStatus: "ON_DELIVERY" } }, "Dalam pengiriman", "Barang dalam pengiriman. Pantau pengiriman."],
    [{ shipment: { state: "booking_dispatched" } }, "Menunggu hasil booking", "Hasil booking belum tersedia. Jangan pesan ulang."],
    [{ shipment: { state: "booking_unknown" } }, "Booking belum pasti", "Konfirmasi ke Jubelio. Jangan pesan ulang."],
    [{ deliveryFailureCode: "physical_stock_unavailable" }, "Stok tidak tersedia", "Stok tidak tersedia. Tindak lanjuti di luar aplikasi."],
    [{ deliveryFailureCode: "damaged_goods" }, "Barang rusak", "Barang rusak. Tindak lanjuti di luar aplikasi."],
    [{ deliveryFailureCode: "paid_service_limits_exceeded" }, "Batas layanan terlampaui", "Paket melebihi batas layanan. Tindak lanjuti di luar aplikasi."],
    [{ shipment: { state: "booked", latestStatus: "ON_HOLD" } }, "Pengiriman tertahan", "Pengiriman tertahan. Konfirmasi ke kurir."],
    [{ shipment: { state: "booked", latestStatus: "RETURNED" } }, "Barang dikembalikan", "Kurir melaporkan pengembalian. Tindak lanjuti kendala."],
    [{ shipment: { state: "booked", latestStatus: "CANCELED" } }, "Pengiriman dibatalkan", "Pengiriman dibatalkan kurir. Tindak lanjuti kendala."],
    [{ shipment: { state: "booked", latestStatus: "SHIPMENT_ISSUE" } }, "Kendala pengiriman", "Pengiriman bermasalah. Konfirmasi ke kurir."],
  ] as const)("projects %j without treating order stage as viewer authority", (evidence, label, guidance) => {
    expect(projectDeliveryStage({ ...paid, ...evidence })).toEqual({ label, guidance, terminal: false });
  });

  it("shows all verified access restrictions together and never guesses a restriction from missing eligibility", () => {
    expect(projectDeliveryAccess({ canEditOrders: false, homeBranchId: null, orderBranchId: "bdg" })).toEqual({ known: true, allowed: false, reasons: [
      "Hanya dapat dilihat. Anda tidak memiliki izin mengubah order.",
      "Hanya dapat dilihat. Tindakan pemenuhan memerlukan Home Branch yang sesuai dengan cabang order. Akun Anda belum memiliki Home Branch.",
    ] });
    expect(projectDeliveryAccess({ canEditOrders: true, homeBranchId: "jkt", homeBranchName: "Jakarta", orderBranchId: "bdg", orderBranchName: "Bandung" }).reasons).toEqual([
      "Hanya dapat dilihat. Home Branch Anda: Jakarta. Cabang order: Bandung. Tindakan pemenuhan harus dilakukan oleh staff dengan Home Branch Bandung dan izin yang sesuai.",
    ]);
    expect(projectDeliveryAccess({ orderBranchId: "bdg" })).toEqual({ known: false, allowed: false, reasons: ["Kelayakan tindakan belum dapat dipastikan. Muat ulang detail sebelum melanjutkan."] });
  });
  it("keeps courier arrival distinct from manual closure, without inventing intermediate scans", () => {
    expect(projectDeliveryStage({ ...paid, status: "completed", shipment: { state: "booked", latestStatus: "DELIVERED" } })).toMatchObject({ label: "Barang diterima", guidance: "Barang telah diterima. Pengiriman selesai.", terminal: true });
    expect(projectDeliveryStage({ ...paid, status: "completed", deliveryManualAt: "2026-05-01", shipment: { state: "booked", latestStatus: "DELIVERED" } })).toMatchObject({ label: "Selesai manual", guidance: "Order ditutup manual.", terminal: true });
  });
});

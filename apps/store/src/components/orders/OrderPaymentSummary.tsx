"use client";

import { CreditCard } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import { getStatusTone } from "@marketplace/ui/src/lib/status-presentation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { formatPaymentMethodLabel } from "@/lib/payment-method-label";
import type { OrderDetail } from "./order-detail-types";
import { formatRupiah } from "./order-detail-format";

const PAYMENT_STATUS_LABELS: Record<string, string> = {
  pending: "Menunggu",
  paid: "Lunas",
  failed: "Gagal",
};

/** Redemption promo bukan status pembayaran; nilai asing tidak diklaim reserved. */
const PROMO_STATUS_LABELS: Record<string, string> = {
  reserved: "Direservasi sampai batas pembayaran",
  consumed: "Dipakai (lunas)",
  released: "Dibatalkan (kapasitas dilepas)",
};
const UNKNOWN_PROMO_STATUS_LABEL = "Status promo belum tersedia";

/**
 * Satu kelompok pembayaran: metode, status, rincian biaya, total, dan aksi
 * bayar/pemulihan. Eligibility dan tujuan pembayaran sama dengan sebelumnya —
 * komponen ini tidak menambah operasi pembayaran baru.
 */
export function OrderPaymentSummary({
  order,
  onPay,
  onCheckPayment,
}: {
  order: OrderDetail;
  onPay: () => void;
  onCheckPayment: () => void;
}) {
  const payStatusLabel = PAYMENT_STATUS_LABELS[order.paymentStatus];

  const isPendingPayment = order.status === "pending_payment";
  const canPay = isPendingPayment && Boolean(order.snapRedirectUrl);
  const showRecovery = Boolean(
    isPendingPayment &&
      order.paymentRecovery &&
      !order.paymentRecovery.paymentAvailable &&
      !order.snapRedirectUrl
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <h2 className="flex items-center gap-2 text-base font-semibold leading-none tracking-tight">
          <CreditCard className="h-5 w-5 text-primary" aria-hidden />
          Pembayaran
        </h2>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex flex-wrap justify-between gap-x-4 gap-y-1">
          <span className="text-muted-foreground">Metode</span>
          <span className="font-medium">
            {formatPaymentMethodLabel(order.paymentMethod)}
          </span>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <span className="text-muted-foreground">Status</span>
          <StatusBadge tone={getStatusTone("payment", order.paymentStatus)}>
            {payStatusLabel ?? "Status pembayaran belum tersedia"}
          </StatusBadge>
        </div>

        <Separator />

        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">Subtotal</span>
          <span>{formatRupiah(order.subtotal)}</span>
        </div>
        {Number(order.discount) > 0 && (
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">
              Diskon promo{order.promo?.name ? ` (${order.promo.name})` : ""}
            </span>
            <span className="text-green-700">
              -{formatRupiah(order.discount)}
            </span>
          </div>
        )}
        {order.promo && (
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <span className="text-muted-foreground">Status promo</span>
            <StatusBadge
              tone={getStatusTone("redemption", order.promo.status)}
              className="text-right"
            >
              {PROMO_STATUS_LABELS[order.promo.status] ??
                UNKNOWN_PROMO_STATUS_LABEL}
            </StatusBadge>
          </div>
        )}
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">
            PPN ({parseFloat(order.ppnRate)}%)
          </span>
          <span>{formatRupiah(order.ppnAmount)}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">Ongkos Kirim</span>
          <span>{formatRupiah(order.shippingCost)}</span>
        </div>
        {/* Zero is not a charge: a legacy order with a real fee keeps the row. */}
        {Number(order.serviceFee) > 0 && (
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">Biaya Layanan</span>
            <span>{formatRupiah(order.serviceFee)}</span>
          </div>
        )}

        <Separator />

        <div className="flex justify-between gap-4 text-base font-bold">
          <span>Total</span>
          <span className="text-primary">{formatRupiah(order.total)}</span>
        </div>

        {canPay && (
          <div className="space-y-2 pt-1">
            <Button className="w-full" onClick={onPay}>
              <CreditCard aria-hidden />
              Bayar sekarang
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              Selesaikan pembayaran Anda sebelum link kedaluwarsa.
            </p>
          </div>
        )}

        {showRecovery && (
          <div
            role="status"
            className="space-y-2 rounded-lg border bg-muted/30 p-3"
          >
            <p>{order.paymentRecovery?.message}</p>
            <Button
              variant="outline"
              className="w-full"
              onClick={onCheckPayment}
            >
              Periksa status pembayaran
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

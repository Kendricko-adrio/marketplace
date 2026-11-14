"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Image from "next/image";
import {
  AlertCircle,
  ArrowLeft,
  Calendar,
  CheckCircle2,
  Clock,
  Copy,
  MapPin,
  Package,
  PackageX,
  ShoppingBag,
  Truck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  getStatusTone,
  type StatusTone,
} from "@marketplace/ui/src/lib/status-presentation";
import { getStatusToneClassName } from "@marketplace/ui/src/lib/status-styles";
import { OrderFulfillmentPanel } from "@/components/orders/OrderFulfillmentPanel";
import { OrderPaymentSummary } from "@/components/orders/OrderPaymentSummary";
import type { OrderDetail } from "@/components/orders/order-detail-types";
import {
  formatDate,
  formatDateTime,
  formatRupiah,
  formatTrackingTime,
} from "@/components/orders/order-detail-format";
import { useCopyFeedback } from "@/components/orders/use-copy-feedback";

const ORDER_STATUS_LABELS: Record<string, string> = {
  pending_payment: "Menunggu pembayaran",
  processing: "Pesanan diproses",
  ready_for_pickup: "Siap diambil",
  completed: "Pesanan selesai",
  cancelled: "Pesanan dibatalkan",
  failed_payment: "Pembayaran gagal",
};

const UNKNOWN_STATUS_LABEL = "Status pesanan belum tersedia";

const LOAD_ERROR_MESSAGE =
  "Detail pesanan belum dapat dimuat. Silakan coba lagi.";

export default function OrderDetailPage() {
  const params = useParams();
  const router = useRouter();
  const orderId = params.id as string;

  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const { feedback, copy } = useCopyFeedback();

  useEffect(() => {
    let ignore = false;

    async function fetchOrder() {
      setLoading(true);
      setError(null);
      setNotFound(false);
      try {
        const res = await fetch(`/api/orders/${orderId}`);
        const data = await res.json().catch(() => null);
        if (ignore) return;
        if (res.status === 404) {
          setNotFound(true);
          return;
        }
        if (!res.ok || !data?.success) {
          setError(LOAD_ERROR_MESSAGE);
          return;
        }
        setOrder(data.data as OrderDetail);
      } catch {
        if (!ignore) setError(LOAD_ERROR_MESSAGE);
      } finally {
        if (!ignore) setLoading(false);
      }
    }

    fetchOrder();

    return () => {
      ignore = true;
    };
  }, [orderId, reloadKey]);

  const goToHistory = useCallback(() => router.push("/account"), [router]);

  if (loading) {
    return (
      <div
        className="container mx-auto max-w-6xl px-4 py-8"
        role="status"
        aria-live="polite"
      >
        <span className="sr-only">Memuat detail pesanan…</span>
        <div className="animate-pulse space-y-6" aria-hidden>
          <div className="space-y-2">
            <div className="h-4 w-32 rounded bg-muted" />
            <div className="h-8 w-56 rounded bg-muted" />
            <div className="h-4 w-40 rounded bg-muted" />
          </div>
          <div className="h-24 rounded-xl bg-muted" />
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="h-64 rounded-xl bg-muted lg:col-span-2" />
            <div className="h-64 rounded-xl bg-muted" />
          </div>
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="h-48 rounded-xl bg-muted lg:col-span-2" />
            <div className="h-48 rounded-xl bg-muted" />
          </div>
        </div>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="container mx-auto max-w-2xl px-4 py-16">
        <div className="space-y-4 text-center">
          <PackageX
            className="mx-auto h-14 w-14 text-muted-foreground"
            aria-hidden
          />
          <h1 className="text-xl font-semibold">Pesanan tidak ditemukan</h1>
          <Button variant="outline" onClick={goToHistory}>
            <ArrowLeft aria-hidden />
            Kembali ke riwayat pesanan
          </Button>
        </div>
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="container mx-auto max-w-2xl px-4 py-16">
        <div className="space-y-4 text-center">
          <AlertCircle
            className="mx-auto h-14 w-14 text-muted-foreground"
            aria-hidden
          />
          <p className="text-lg text-muted-foreground">
            {error ?? LOAD_ERROR_MESSAGE}
          </p>
          <div className="flex flex-col justify-center gap-3 sm:flex-row">
            <Button onClick={() => setReloadKey((key) => key + 1)}>
              Coba lagi
            </Button>
            <Button variant="outline" onClick={goToHistory}>
              <ArrowLeft aria-hidden />
              Kembali ke riwayat pesanan
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const statusLabel =
    ORDER_STATUS_LABELS[order.status] ?? UNKNOWN_STATUS_LABEL;
  const statusToneKey: StatusTone = getStatusTone("order", order.status);
  const isBlocked =
    order.paymentStatus === "paid" && Boolean(order.fulfillmentBlockedReason);
  const isFailedPayment = order.status === "failed_payment";
  const isCancelled = order.status === "cancelled";
  const isPickup = order.fulfillmentMethod !== "delivery";
  const showPickupCode =
    Boolean(order.pickupCode) &&
    (order.status === "ready_for_pickup" || order.status === "completed");

  const StatusIcon = isCancelled
    ? PackageX
    : isFailedPayment
      ? AlertCircle
      : isBlocked
        ? AlertCircle
        : order.status === "completed"
          ? CheckCircle2
          : order.status === "ready_for_pickup"
            ? MapPin
            : order.status === "pending_payment"
              ? Clock
              : order.shipment
                ? Truck
                : Package;

  const statusTone = getStatusToneClassName(
    isBlocked ? "progress" : statusToneKey
  );

  // Waktu pembaruan pengiriman: hanya dari DTO (deliveredAt / event terakhir).
  const shipmentUpdateAt = order.shipment
    ? (order.shipment.deliveredAt ??
      order.shipment.timeline.at(-1)?.at ??
      null)
    : null;

  return (
    <div className="container mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <Button
            variant="ghost"
            size="sm"
            className="-ml-3 text-muted-foreground"
            onClick={goToHistory}
          >
            <ArrowLeft aria-hidden />
            Riwayat pesanan
          </Button>
          <h1 className="text-2xl font-bold">Detail Pesanan</h1>
          <p className="text-sm text-muted-foreground">
            Dibuat {formatDateTime(order.createdAt)}
          </p>
        </div>
        <StatusBadge
          tone={isBlocked ? "progress" : statusToneKey}
          className="text-sm"
          aria-label="Status pesanan"
        >
          {statusLabel}
        </StatusBadge>
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
        <span className="text-muted-foreground">ID Pesanan</span>
        <span className="break-all font-mono">{order.id}</span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => copy(order.id, "ID disalin")}
        >
          <Copy aria-hidden />
          Salin ID
        </Button>
        <p role="status" aria-live="polite" className="text-xs">
          {feedback && (
            <span
              className={feedback.ok ? "text-green-700" : "text-destructive"}
            >
              {feedback.message}
            </span>
          )}
        </p>
      </div>

      {/* Ringkasan status: order, pembayaran, dan paket tetap terpisah. */}
      <Card
        className={
          isBlocked
            ? "mb-6 border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/50"
            : "mb-6"
        }
      >
        <CardContent className="flex items-start gap-4 pt-6">
          <div
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${statusTone}`}
          >
            <StatusIcon className="h-5 w-5" aria-hidden />
          </div>
          <div className="min-w-0 space-y-1">
            <p
              className={`text-lg font-semibold ${
                isBlocked ? "text-amber-900 dark:text-amber-100" : ""
              }`}
            >
              {isBlocked
                ? "Pembayaran diterima, pesanan menunggu verifikasi"
                : statusLabel}
            </p>
            {isBlocked && (
              <p className="text-sm text-amber-900 dark:text-amber-100">
                Pembayaran Anda sudah tercatat. Pesanan belum dapat diproses
                sampai tim kami menyelesaikan verifikasi. Tidak perlu membayar
                ulang.
              </p>
            )}
            {isFailedPayment && order.paymentFailureReason && (
              <p className="text-sm text-muted-foreground">
                {order.paymentFailureReason}
              </p>
            )}
            {isFailedPayment && (
              <p className="text-sm text-muted-foreground">
                Silakan buat pesanan baru untuk mencoba pembayaran kembali.
              </p>
            )}
            {!isBlocked &&
              !isCancelled &&
              !isFailedPayment &&
              shipmentUpdateAt && (
                <p className="text-sm text-muted-foreground">
                  Pembaruan pengiriman: {formatTrackingTime(shipmentUpdateAt)}
                </p>
              )}
          </div>
        </CardContent>
      </Card>

      {showPickupCode && (
        <Card className="mb-6">
          <CardContent className="flex flex-wrap items-center justify-between gap-4 pt-6">
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Kode Pickup Anda</p>
              <p className="font-mono text-3xl font-bold tracking-widest text-primary break-all">
                {order.pickupCode}
              </p>
              <p className="text-xs text-muted-foreground">
                Tunjukkan kode ini kepada staf cabang saat pengambilan.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => copy(order.pickupCode!, "Kode disalin")}
            >
              <Copy aria-hidden />
              Salin kode
            </Button>
          </CardContent>
        </Card>
      )}

      {order.fulfillmentMethod === "delivery" && (
        <div className="mb-6">
          <OrderFulfillmentPanel
            shipment={order.shipment}
            deliverySnapshot={order.deliverySnapshot}
          />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <h2 className="flex items-center gap-2 text-base font-semibold leading-none tracking-tight">
              <ShoppingBag className="h-5 w-5 text-primary" aria-hidden />
              Barang pesanan ({order.items.length})
            </h2>
          </CardHeader>
          <CardContent>
            {order.items.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Detail barang belum tersedia.
              </p>
            ) : (
              <ul className="divide-y">
                {order.items.map((item) => (
                  <li
                    key={item.id}
                    className="flex gap-4 py-4 first:pt-0 last:pb-0"
                  >
                    <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted text-muted-foreground">
                      {item.imageUrl ? (
                        <Image
                          src={item.imageUrl}
                          alt={item.productName}
                          width={80}
                          height={80}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <Package className="h-8 w-8" aria-hidden />
                      )}
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:justify-between">
                      <div className="min-w-0 space-y-1">
                        <p className="break-words font-medium">
                          {item.productName}
                        </p>
                        {item.variantInfo && (
                          <p className="text-sm text-muted-foreground">
                            {item.variantInfo}
                          </p>
                        )}
                        <p className="text-sm text-muted-foreground">
                          {item.quantity} × {formatRupiah(item.price)}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-2 sm:shrink-0 sm:flex-col sm:items-end sm:justify-between">
                        <p className="whitespace-nowrap font-semibold">
                          {formatRupiah(
                            (parseFloat(item.price) * item.quantity).toString()
                          )}
                        </p>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            router.push(
                              `/products/${item.slug ?? item.productId}`
                            )
                          }
                        >
                          Beli lagi
                        </Button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          {isPickup && (
            <Card>
              <CardHeader className="pb-3">
                <h2 className="flex items-center gap-2 text-base font-semibold leading-none tracking-tight">
                  <MapPin className="h-5 w-5 text-primary" aria-hidden />
                  Pengambilan
                </h2>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {order.branch ? (
                  <>
                    <div className="flex items-start gap-2">
                      <MapPin
                        className="mt-0.5 h-4 w-4 shrink-0 text-primary"
                        aria-hidden
                      />
                      <div>
                        <p className="font-medium">{order.branch.name}</p>
                        <p className="text-muted-foreground">
                          {order.branch.address}, {order.branch.city}
                        </p>
                      </div>
                    </div>
                    {order.pickupDate && (
                      <div className="flex items-center gap-2">
                        <Calendar
                          className="h-4 w-4 text-muted-foreground"
                          aria-hidden
                        />
                        <span>{formatDate(order.pickupDate)}</span>
                      </div>
                    )}
                    {order.pickupTime && (
                      <div className="flex items-center gap-2">
                        <Clock
                          className="h-4 w-4 text-muted-foreground"
                          aria-hidden
                        />
                        <span>{order.pickupTime}</span>
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-muted-foreground">
                    Lokasi pickup tidak tersedia
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          <OrderPaymentSummary
            order={order}
            onPay={() => {
              if (order.snapRedirectUrl) {
                window.location.href = order.snapRedirectUrl;
              }
            }}
            onCheckPayment={() => setReloadKey((key) => key + 1)}
          />
        </div>
      </div>
    </div>
  );
}

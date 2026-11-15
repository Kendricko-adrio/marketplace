"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Image from "next/image";
import {
  AlertCircle,
  ArrowLeft,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Copy,
  Loader2,
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
import type {
  OrderDetail,
  PaymentCheckState,
} from "@/components/orders/order-detail-types";
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

const PICKUP_ARCHIVE_ID = "pickup-code-archive";

/** Kelas penempatan sidebar desktop (statis agar terbaca Tailwind). */
const PICKUP_COL_CLASS = "lg:col-start-3";
const PICKUP_ROW_CLASS: Record<1 | 2 | 3, string> = {
  1: "lg:row-start-1",
  2: "lg:row-start-2",
  3: "lg:row-start-3",
};

/**
 * Sidik jari field yang relevan bagi customer. Metadata teknis (requestId,
 * timestamp internal) sengaja tidak ikut supaya pesan "diperbarui" tidak
 * pernah palsu.
 */
function orderSignature(order: OrderDetail): string {
  return JSON.stringify({
    status: order.status,
    paymentStatus: order.paymentStatus,
    blocked: order.fulfillmentBlockedReason,
    failureReason: order.paymentFailureReason,
    snap: order.snapRedirectUrl,
    recovery: order.paymentRecovery
      ? [
          order.paymentRecovery.state,
          order.paymentRecovery.paymentAvailable,
          order.paymentRecovery.redirectUrl,
          order.paymentRecovery.expiresAt,
        ]
      : null,
    shipment: order.shipment
      ? [
          order.shipment.awb,
          order.shipment.latestStatus,
          order.shipment.delivered,
          order.shipment.deliveredAt,
          order.shipment.podUrl,
        ]
      : null,
    money: [
      order.subtotal,
      order.discount,
      order.shippingCost,
      order.serviceFee,
      order.ppnAmount,
      order.total,
    ],
    promo: order.promo
      ? [order.promo.status, order.promo.benefitAmount]
      : null,
    method: order.paymentMethod,
  });
}

export default function OrderDetailPage() {
  const params = useParams();
  const router = useRouter();
  const orderId = params.id as string;

  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [checking, setChecking] = useState(false);
  const [paymentCheck, setPaymentCheck] = useState<PaymentCheckState>("idle");
  const [showPickupArchive, setShowPickupArchive] = useState(false);
  const signatureRef = useRef<string | null>(null);
  const checkingRef = useRef(false);
  // Dua state terpisah: pesan salin ID dan pesan salin kode pickup tidak boleh
  // muncul bersamaan di dua live region (pembaca layar mengumumkan ganda).
  const { feedback: idFeedback, copy: copyId } = useCopyFeedback();
  const { feedback: codeFeedback, copy: copyCode } = useCopyFeedback();

  useEffect(() => {
    let ignore = false;

    async function fetchOrder() {
      setInitialLoading(true);
      setError(null);
      setNotFound(false);
      try {
        const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}`);
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
        const detail = data.data as OrderDetail;
        signatureRef.current = orderSignature(detail);
        setOrder(detail);
      } catch {
        if (!ignore) setError(LOAD_ERROR_MESSAGE);
      } finally {
        if (!ignore) setInitialLoading(false);
      }
    }

    fetchOrder();

    return () => {
      ignore = true;
    };
  }, [orderId, reloadKey]);

  /**
   * Pemeriksaan status read-only: GET pesanan yang sama, tanpa POST, tanpa
   * transaksi pengganti. Detail dan fokus tetap di layar; hasilnya
   * checking/unchanged/updated/error, bukan klaim sukses/gagal.
   */
  const checkPaymentStatus = useCallback(async () => {
    if (checkingRef.current) return;
    checkingRef.current = true;
    setChecking(true);
    setPaymentCheck("checking");
    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}`, {
        cache: "no-store",
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success || !data?.data) {
        setPaymentCheck("error");
        return;
      }
      const next = data.data as OrderDetail;
      if (String(next.id) !== String(orderId)) {
        setPaymentCheck("error");
        return;
      }
      const previous = signatureRef.current;
      const nextSignature = orderSignature(next);
      signatureRef.current = nextSignature;
      setOrder(next);
      setPaymentCheck(
        previous !== null && previous !== nextSignature ? "updated" : "unchanged"
      );
    } catch {
      setPaymentCheck("error");
    } finally {
      checkingRef.current = false;
      setChecking(false);
    }
  }, [orderId]);

  const goToHistory = useCallback(() => router.push("/account"), [router]);

  if (initialLoading) {
    return (
      <div
        className="container mx-auto max-w-6xl px-4 py-8"
        role="status"
        aria-live="polite"
      >
        {/* Loading harus benar-benar terlihat: teks + indikator, dan skeleton
            memakai `bg-border` (bukan `bg-muted` yang setara background). */}
        <div className="mb-6 flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          <span className="text-sm font-medium">Memuat detail pesanan…</span>
        </div>
        <div className="animate-pulse space-y-6" aria-hidden>
          <div className="space-y-2">
            <div className="h-4 w-32 rounded bg-border" />
            <div className="h-8 w-56 rounded bg-border" />
            <div className="h-4 w-40 rounded bg-border" />
          </div>
          <div className="h-24 rounded-xl bg-border" />
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="h-64 rounded-xl bg-border lg:col-span-2" />
            <div className="h-64 rounded-xl bg-border" />
          </div>
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="h-48 rounded-xl bg-border lg:col-span-2" />
            <div className="h-48 rounded-xl bg-border" />
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

  const knownStatus = Boolean(ORDER_STATUS_LABELS[order.status]);
  const statusLabel = ORDER_STATUS_LABELS[order.status] ?? UNKNOWN_STATUS_LABEL;
  const statusToneKey: StatusTone = getStatusTone("order", order.status);
  const isBlocked =
    order.paymentStatus === "paid" && Boolean(order.fulfillmentBlockedReason);
  const isFailedPayment = order.status === "failed_payment";
  const isCancelled = order.status === "cancelled";
  const isPickup = order.fulfillmentMethod !== "delivery";
  const hasPickupCode = Boolean(order.pickupCode);
  const activePickupCode = hasPickupCode && order.status === "ready_for_pickup";
  const archivedPickupCode = hasPickupCode && order.status === "completed";
  // Tracking kosong tidak boleh mendahului pembayaran pada pesanan pending.
  const showTracking = !(order.status === "pending_payment" && !order.shipment);
  const needsNextAction = isFailedPayment || isCancelled || !knownStatus;
  const isDelivery = order.fulfillmentMethod === "delivery";
  const sidebarHasPickup = isPickup && Boolean(order.branch);
  // Penempatan desktop eksplisit (kelas statis, bukan template string) supaya
  // urutan DOM tetap urutan mobile: bayar → pickup/alamat → barang.
  const pickupHasCodeCard = activePickupCode || archivedPickupCode;
  const branchRow: 1 | 2 | 3 = pickupHasCodeCard ? 2 : 1;
  const paymentRow: 1 | 2 | 3 = isDelivery
    ? 2
    : !sidebarHasPickup
      ? 1
      : pickupHasCodeCard
        ? 3
        : 2;

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

  // Ready: instruksi pengambilan + kode existing dipertahankan apa adanya.
  const activePickupCodeCard = activePickupCode && (
    <Card className="lg:col-start-3 lg:row-start-1">
      <CardHeader className="pb-3">
        <h2 className="flex items-center gap-2 text-base font-semibold leading-none tracking-tight">
          <Package className="h-5 w-5 text-primary" aria-hidden />
          Kode Pickup Anda
        </h2>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="break-all font-mono text-2xl font-bold tracking-widest text-primary">
          {order.pickupCode}
        </p>
        <p className="text-xs text-muted-foreground">
          Tunjukkan kode ini kepada staf cabang saat pengambilan.
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => copyCode(order.pickupCode!, "Kode disalin")}
        >
          <Copy aria-hidden />
          Salin kode
        </Button>
        <p role="status" aria-live="polite" className="text-xs">
          {codeFeedback && (
            <span
              className={
                codeFeedback.ok ? "text-green-700" : "text-destructive"
              }
            >
              {codeFeedback.message}
            </span>
          )}
        </p>
      </CardContent>
    </Card>
  );

  // Completed: tanpa instruksi pengambilan aktif; kode hanya arsip tertutup.
  const archivedPickupCodeCard = archivedPickupCode && (
    <Card className={`${PICKUP_COL_CLASS} lg:row-start-1`}>
      <CardHeader className="pb-3">
        <h2 className="flex items-center gap-2 text-base font-semibold leading-none tracking-tight">
          <Package className="h-5 w-5 text-primary" aria-hidden />
          Arsip pengambilan
        </h2>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          Pesanan sudah selesai. Kode pengambilan hanya disimpan sebagai arsip.
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setShowPickupArchive((value) => !value)}
          aria-expanded={showPickupArchive}
          aria-controls={PICKUP_ARCHIVE_ID}
        >
          {showPickupArchive ? "Sembunyikan kode" : "Lihat kode pengambilan"}
          {showPickupArchive ? <ChevronUp aria-hidden /> : <ChevronDown aria-hidden />}
        </Button>
        {showPickupArchive && (
          <div
            id={PICKUP_ARCHIVE_ID}
            role="region"
            aria-label="Arsip kode pengambilan"
            className="rounded-lg border bg-muted/30 p-3"
          >
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Arsip kode pengambilan
            </p>
            <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
              <p className="break-all font-mono text-lg font-bold">
                {order.pickupCode}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => copyCode(order.pickupCode!, "Kode disalin")}
              >
                <Copy aria-hidden />
                Salin kode
              </Button>
            </div>
          </div>
        )}
        <p role="status" aria-live="polite" className="text-xs">
          {codeFeedback && (
            <span
              className={
                codeFeedback.ok ? "text-green-700" : "text-destructive"
              }
            >
              {codeFeedback.message}
            </span>
          )}
        </p>
      </CardContent>
    </Card>
  );

  const pickupBranchCard = isPickup && (
    <Card className={isPickup ? `${PICKUP_COL_CLASS} ${PICKUP_ROW_CLASS[branchRow]}` : undefined}>
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
              <div className="min-w-0">
                <p className="break-words font-medium">{order.branch.name}</p>
                <p className="break-words text-muted-foreground">
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
                <Clock className="h-4 w-4 text-muted-foreground" aria-hidden />
                <span>{order.pickupTime}</span>
              </div>
            )}
          </>
        ) : (
          <p className="text-muted-foreground">Lokasi pickup tidak tersedia</p>
        )}
      </CardContent>
    </Card>
  );

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
          onClick={() => copyId(order.id, "ID disalin")}
        >
          <Copy aria-hidden />
          Salin ID
        </Button>
        <p role="status" aria-live="polite" className="text-xs">
          {idFeedback && (
            <span
              className={idFeedback.ok ? "text-green-700" : "text-destructive"}
            >
              {idFeedback.message}
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
        {needsNextAction && (
          <CardContent className="pt-0">
            <div className="flex flex-wrap gap-2">
              {knownStatus ? (
                <Button onClick={goToHistory}>Lihat Pesanan Saya</Button>
              ) : (
                <Button
                  className="gap-2"
                  aria-busy={checking}
                  aria-disabled={checking}
                  onClick={() => void checkPaymentStatus()}
                >
                  {checking && (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  )}
                  {checking ? "Memeriksa status…" : "Periksa status"}
                </Button>
              )}
            </div>
          </CardContent>
        )}
      </Card>

      {/*
        Satu grid dengan urutan DOM mobile: pembayaran → pickup/alamat → barang.
        Desktop memakai penempatan eksplisit supaya susunan multi-kolom lama
        (barang di kiri, pickup/pembayaran di sidebar kanan) tetap sama.
      */}
      <div className="grid gap-6 lg:grid-cols-3 lg:items-start">
        <div className={`${PICKUP_COL_CLASS} ${PICKUP_ROW_CLASS[paymentRow]}`}>
          <OrderPaymentSummary
            order={order}
            paymentCheck={{ state: paymentCheck }}
            onCheckPayment={() => void checkPaymentStatus()}
            onPay={() => {
              if (order.snapRedirectUrl) {
                window.location.href = order.snapRedirectUrl;
              }
            }}
          />
        </div>

        {activePickupCodeCard}
        {archivedPickupCodeCard}
        {pickupBranchCard}

        {isDelivery && (
          <div className="lg:col-span-3 lg:row-start-1">
            <OrderFulfillmentPanel
              shipment={order.shipment}
              deliverySnapshot={order.deliverySnapshot}
              showTracking={showTracking}
            />
          </div>
        )}

        <Card
          className={
            isDelivery
              ? "lg:col-span-2 lg:col-start-1 lg:row-span-2 lg:row-start-2"
              : "lg:col-span-2 lg:col-start-1 lg:row-span-3 lg:row-start-1"
          }
        >
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
      </div>
    </div>
  );
}

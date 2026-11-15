"use client";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Loader2,
  Package,
  PackageSearch,
  XCircle,
} from "lucide-react";
import { getStatusToneClassName } from "@marketplace/ui/src/lib/status-styles";

/**
 * Halaman hasil membaca status SEBENARNYA dari DTO pesanan milik customer.
 *
 * Redirect gateway hanya membawa `order_id`, `status_code`, dan
 * `transaction_status`. Nilai query itu bukan bukti sukses/pending/gagal, jadi
 * halaman ini memanggil GET detail pesanan (owner-scoped, read only) dan
 * menyusun presentasi dari DTO. Query status tidak pernah mengalahkan DTO.
 *
 * GET tidak membuat order, tidak memulai sesi pembayaran, dan tidak memaksa
 * sinkronisasi provider: pemeriksaan cukup membaca data yang ada.
 */

type ResultKind =
  | "loading"
  | "paid"
  | "paid-blocked"
  | "pending"
  | "failed"
  | "cancelled"
  | "unknown"
  | "missing"
  | "not-found"
  | "unauthorized"
  | "forbidden"
  | "error";

interface ResultPresentation {
  tone: "success" | "waiting" | "progress" | "error" | "cancelled" | "neutral";
  title: string;
  body: string;
}

const PRESENTATION: Record<Exclude<ResultKind, "loading">, ResultPresentation> = {
  paid: {
    tone: "success",
    title: "Pembayaran diterima",
    body: "Buka detail pesanan untuk melihat langkah berikutnya.",
  },
  "paid-blocked": {
    tone: "progress",
    title: "Pembayaran diterima, pesanan menunggu verifikasi",
    body: "Pembayaran sudah tercatat. Tidak perlu membayar ulang.",
  },
  pending: {
    tone: "waiting",
    title: "Menunggu pembayaran",
    body: "Buka detail pesanan untuk melihat status dan pilihan pembayaran.",
  },
  failed: {
    tone: "error",
    title: "Pembayaran gagal",
    body: "Buka detail pesanan untuk melihat status pesanan dan langkah berikutnya.",
  },
  cancelled: {
    tone: "cancelled",
    title: "Pesanan dibatalkan",
    body: "Buka detail pesanan untuk melihat informasi pembayaran.",
  },
  unknown: {
    tone: "neutral",
    title: "Status pembayaran belum dapat dipastikan",
    body: "Buka detail pesanan untuk memeriksa informasi terbaru.",
  },
  missing: {
    tone: "neutral",
    title: "Pesanan belum dapat ditentukan",
    body: "Buka riwayat pesanan untuk mencari pesanan yang ingin diperiksa.",
  },
  "not-found": {
    tone: "neutral",
    title: "Pesanan tidak ditemukan",
    body: "Periksa pesanan melalui riwayat akun Anda.",
  },
  unauthorized: {
    tone: "neutral",
    title: "Masuk untuk memeriksa pesanan",
    body: "Masuk dengan akun pemesan agar status pembayaran pesanan ini dapat diperiksa.",
  },
  forbidden: {
    tone: "progress",
    title: "Akses pesanan belum tersedia",
    body: "Akun Anda belum dapat mengakses detail pesanan.",
  },
  error: {
    tone: "neutral",
    title: "Status pembayaran belum dapat diperiksa",
    body: "Coba lagi untuk memeriksa pesanan yang sama.",
  },
};

const TERMINAL_ORDER_STATUSES = new Set(["cancelled", "failed_payment"]);

/** Presentasi status dari DTO, bukan dari query URL. */
function presentOrder(order: {
  status?: unknown;
  paymentStatus?: unknown;
  fulfillmentBlockedReason?: unknown;
}): Exclude<ResultKind, "loading" | "missing" | "not-found" | "unauthorized" | "forbidden" | "error"> {
  const paymentStatus = typeof order.paymentStatus === "string" ? order.paymentStatus : "";
  const orderStatus = typeof order.status === "string" ? order.status : "";
  const blocked =
    paymentStatus === "paid" &&
    typeof order.fulfillmentBlockedReason === "string" &&
    order.fulfillmentBlockedReason.length > 0;

  // A verified payment stays verified even when the order is cancelled/blocked;
  // the lifecycle is explained separately instead of erasing the payment fact.
  if (paymentStatus === "paid") return blocked ? "paid-blocked" : "paid";
  if (paymentStatus === "failed") return "failed";
  if (orderStatus === "cancelled") return "cancelled";
  if (paymentStatus === "pending" && !TERMINAL_ORDER_STATUSES.has(orderStatus)) {
    return "pending";
  }
  // Foreign/contradictory combinations (e.g. failed order + pending payment)
  // are never presented as a proven settlement or failure.
  return "unknown";
}

function ResultContent() {
  const searchParams = useSearchParams();
  const orderId = searchParams.get("order_id")?.trim() ?? "";
  const [attempt, setAttempt] = useState(0);
  // Hasil disimpan bersama identitas permintaannya: status loading diturunkan
  // dari ketidakcocokan key, bukan di-set di dalam effect.
  const [result, setResult] = useState<{ key: string; kind: ResultKind } | null>(null);
  const requestKey = `${orderId}#${attempt}`;
  const kind: ResultKind = !orderId
    ? "missing"
    : result?.key === requestKey
      ? result.kind
      : "loading";

  useEffect(() => {
    if (!orderId) return;
    let ignore = false;
    const controller = new AbortController();
    const key = requestKey;

    async function check() {
      const settle = (next: ResultKind) => {
        if (!ignore) setResult({ key, kind: next });
      };
      try {
        const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (ignore) return;
        if (res.status === 401) return settle("unauthorized");
        if (res.status === 403) return settle("forbidden");
        if (res.status === 404) return settle("not-found");
        if (!res.ok) return settle("error");
        const body = await res.json().catch(() => null);
        if (ignore) return;
        const data = body?.data;
        // Only an envelope carrying THIS order id proves anything. Anything
        // else (missing envelope, foreign identity) stays "unverified".
        if (!body?.success || !data || String(data.id) !== orderId) {
          return settle("error");
        }
        settle(presentOrder(data));
      } catch {
        settle("error");
      }
    }

    void check();
    return () => {
      ignore = true;
      controller.abort();
    };
  }, [orderId, requestKey]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  const detailHref = `/account/orders/${encodeURIComponent(orderId)}`;
  const loginHref = `/login?callbackUrl=${encodeURIComponent(
    `/checkout/result?order_id=${encodeURIComponent(orderId)}`
  )}`;

  if (kind === "loading") {
    return (
      <div className="container mx-auto max-w-2xl px-4 py-16">
        <Card>
          <CardContent className="space-y-4 p-8 text-center" role="status" aria-live="polite">
            <Loader2 className="mx-auto h-10 w-10 animate-spin text-primary" aria-hidden />
            <p className="text-lg font-semibold">Memeriksa status pembayaran…</p>
            <p className="text-sm text-muted-foreground">
              Mohon tunggu, status diambil dari pesanan Anda.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const copy = PRESENTATION[kind];
  const Icon =
    kind === "paid"
      ? CheckCircle2
      : kind === "pending"
        ? Clock
        : kind === "failed"
          ? XCircle
          : kind === "cancelled"
            ? XCircle
            : kind === "paid-blocked" || kind === "forbidden"
              ? AlertCircle
              : orderId
                ? Package
                : PackageSearch;

  return (
    <div className="container mx-auto max-w-2xl px-4 py-16">
      <Card>
        <CardContent className="p-8 text-center">
          <div
            className={`mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full border ${getStatusToneClassName(copy.tone)}`}
            data-status-tone={copy.tone}
          >
            <Icon className="h-8 w-8" aria-hidden />
          </div>
          <h1 className="mb-2 text-2xl font-bold">{copy.title}</h1>
          <p className="mb-6 text-muted-foreground">{copy.body}</p>
          {orderId && (
            <p className="mb-6 text-sm text-muted-foreground">
              ID Pesanan:{" "}
              <code className="break-all rounded bg-muted px-2 py-1 font-mono">
                {orderId}
              </code>
            </p>
          )}
          <div className="flex flex-col justify-center gap-3 sm:flex-row">
            {kind === "error" ? (
              <Button className="w-full gap-2 sm:w-auto" onClick={retry}>
                <Package className="h-4 w-4" aria-hidden /> Coba lagi
              </Button>
            ) : kind === "unauthorized" ? (
              <Button asChild className="w-full gap-2 sm:w-auto">
                <Link href={loginHref}>Masuk</Link>
              </Button>
            ) : kind === "missing" ||
              kind === "not-found" ||
              kind === "forbidden" ? (
              <Button asChild className="w-full gap-2 sm:w-auto">
                <Link href="/account">
                  <Package className="h-4 w-4" aria-hidden /> Lihat Pesanan Saya
                </Link>
              </Button>
            ) : (
              <Button asChild className="w-full gap-2 sm:w-auto">
                <Link href={detailHref}>
                  <Package className="h-4 w-4" aria-hidden /> Lihat Detail Pesanan
                </Link>
              </Button>
            )}
            {/* Tindakan sekunder tidak bersaing dengan aksi utama status: hanya
                "Belanja Lagi" yang tetap ada di samping aksi status/recovery. */}
            <Button asChild variant="outline" className="w-full sm:w-auto">
              <Link href="/products">Belanja Lagi</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function CheckoutResultPage() {
  return (
    <Suspense
      fallback={
        <div className="container mx-auto px-4 py-16 flex justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      }
    >
      <ResultContent />
    </Suspense>
  );
}

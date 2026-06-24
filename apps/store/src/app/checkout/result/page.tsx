"use client";
import { Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  Package,
} from "lucide-react";

function ResultContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const orderId = searchParams.get("order_id");
  const transactionStatus = searchParams.get("transaction_status");

  // Derive order status directly from query params (no effect needed).
  const orderStatus: "success" | "pending" | "cancel" = !orderId
    ? "cancel"
    : transactionStatus === "settlement" || transactionStatus === "capture"
    ? "success"
    : transactionStatus === "pending"
    ? "pending"
    : "cancel";

  return (
    <div className="container mx-auto px-4 py-16 max-w-2xl">
      {orderStatus === "success" && (
        <Card>
          <CardContent className="p-8 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
              <CheckCircle2 className="h-8 w-8 text-green-600" />
            </div>
            <h1 className="text-2xl font-bold mb-2">Pembayaran Berhasil!</h1>
            <p className="text-muted-foreground mb-6">
              Pembayaran Anda telah diterima. Pesanan Anda sedang disiapkan dan
              kode pickup akan dikirim ke email Anda sebentar lagi.
            </p>
            {orderId && (
              <p className="text-sm text-muted-foreground mb-6">
                ID Pesanan:{" "}
                <code className="rounded bg-muted px-2 py-1 font-mono">
                  {orderId.slice(0, 8)}
                </code>
              </p>
            )}
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              {orderId && (
                <Link href={`/account/orders/${orderId}`}>
                  <Button className="w-full gap-2">
                    <Package className="h-4 w-4" /> Lihat Detail Pesanan
                  </Button>
                </Link>
              )}
              <Link href="/products">
                <Button variant="outline" className="w-full">
                  Belanja Lagi
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      )}

      {orderStatus === "pending" && (
        <Card>
          <CardContent className="p-8 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-amber-100">
              <Clock className="h-8 w-8 text-amber-600" />
            </div>
            <h1 className="text-2xl font-bold mb-2">Menunggu Pembayaran</h1>
            <p className="text-muted-foreground mb-6">
              Pembayaran Anda sedang diproses. Selesaikan pembayaran QRIS Anda
              dan pesanan akan dikonfirmasi otomatis.
            </p>
            {orderId && (
              <Link href={`/account/orders/${orderId}`}>
                <Button className="gap-2">
                  <Package className="h-4 w-4" /> Lihat Detail Pesanan
                </Button>
              </Link>
            )}
          </CardContent>
        </Card>
      )}

      {orderStatus === "cancel" && (
        <Card>
          <CardContent className="p-8 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
              <XCircle className="h-8 w-8 text-destructive" />
            </div>
            <h1 className="text-2xl font-bold mb-2">Pembayaran Gagal</h1>
            <p className="text-muted-foreground mb-6">
              Pembayaran tidak diselesaikan atau dibatalkan. Pesanan Anda telah
              dibatalkan. Silakan coba lagi.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Link href="/products">
                <Button>Belanja Lagi</Button>
              </Link>
              <Button variant="outline" onClick={() => router.push("/account")}>
                Lihat Pesanan Saya
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
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
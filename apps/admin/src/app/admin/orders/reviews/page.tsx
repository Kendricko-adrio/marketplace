"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ShieldQuestion, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type SalesOperation = {
  id: string;
  orderId: string;
  type: "create" | "cancel" | "invoice" | "payment";
  status: string;
  reference: string;
  salesOrderId: number | null;
  invoiceId: number | null;
  paymentId: number | null;
  attemptCount: number;
  dispatchedAt: string | null;
  confirmedAt: string | null;
  lastError: string | null;
  updatedAt: string;
  orderStatus: string;
  orderPaymentStatus: string;
  orderTotal: string;
  branchName: string | null;
  customerName: string;
  customerEmail: string;
};

type BlockedOrder = {
  orderId: string;
  status: string;
  paymentStatus: string;
  paymentMethod: string | null;
  paymentFailureReason: string | null;
  total: string;
  jubelioSalesOrderId: number | null;
  jubelioInvoiceId: number | null;
  jubelioPaymentId: number | null;
  fulfillmentBlockedReason: string | null;
  updatedAt: string;
  branchName: string | null;
  customerName: string;
  customerEmail: string;
};

const TYPE_LABEL: Record<string, string> = {
  create: "Sales Order",
  cancel: "Pembatalan SO",
  invoice: "Konversi Invoice",
  payment: "Pembayaran Invoice",
};

function formatRupiah(value: string): string {
  return `Rp ${parseFloat(value).toLocaleString("id-ID")}`;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
}

export default function SalesReviewQueuePage() {
  const [operations, setOperations] = useState<SalesOperation[]>([]);
  const [blockedOrders, setBlockedOrders] = useState<BlockedOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/reviews/sales-operations");
      const body = await res.json();
      if (!res.ok || !body.success) {
        throw new Error(body.error || "Gagal memuat antrean review");
      }
      setOperations(body.data.operations);
      setBlockedOrders(body.data.blockedOrders);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat antrean review");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="container mx-auto space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <ShieldQuestion className="h-6 w-6" /> Antrean Review Jubelio
          </h1>
          <p className="text-sm text-muted-foreground">
            Operasi Sales Order/Invoice/Pembayaran yang butuh konfirmasi manual,
            dan pesanan paid yang diblokir dari pengambilan.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Muat ulang
        </Button>
      </div>

      {error && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="flex items-center gap-2 py-3 text-sm text-red-700">
            <AlertTriangle className="h-4 w-4" /> {error}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Operasi dalam status manual review</CardTitle>
          <CardDescription>
            Hasil operasi Jubelio tidak diketahui (timeout/gagal verifikasi).
            Investigasi read-only — jangan pernah menulis ulang ke Jubelio
            secara manual tanpa cek ID remote berikut.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {operations.length === 0 && !loading ? (
            <p className="text-sm text-muted-foreground">Tidak ada antrean.</p>
          ) : (
            <div className="space-y-3">
              {operations.map((op) => (
                <div
                  key={op.id}
                  className="rounded-lg border p-4 text-sm space-y-2"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="destructive">{TYPE_LABEL[op.type] ?? op.type}</Badge>
                    <span className="font-mono text-xs text-muted-foreground">
                      {op.reference}
                    </span>
                  </div>
                  <div className="grid gap-1 md:grid-cols-2">
                    <div>
                      Order:{" "}
                      <a
                        className="underline"
                        href={`/admin/orders/${op.orderId}`}
                      >
                        {op.orderId.slice(0, 8).toUpperCase()}
                      </a>{" "}
                      — {op.customerName} ({op.customerEmail})
                      {op.branchName ? ` — ${op.branchName}` : ""}
                    </div>
                    <div>
                      Total: {formatRupiah(op.orderTotal)} · status pesanan{" "}
                      {op.orderStatus} / pembayaran {op.orderPaymentStatus}
                    </div>
                    <div>
                      ID remote: SO {op.salesOrderId ?? "—"} · Invoice{" "}
                      {op.invoiceId ?? "—"} · Payment {op.paymentId ?? "—"}
                    </div>
                    <div>
                      Percobaan: {op.attemptCount} · dikirim{" "}
                      {op.dispatchedAt ? formatDate(op.dispatchedAt) : "—"} ·
                      diperbarui {formatDate(op.updatedAt)}
                    </div>
                  </div>
                  {op.lastError && (
                    <div className="rounded bg-amber-50 p-2 text-xs text-amber-800">
                      {op.lastError}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pesanan paid tapi diblokir pengambilan</CardTitle>
          <CardDescription>
            Status pembayaran mengikuti Midtrans (authoritative), tetapi
            settlement Jubelio belum terverifikasi sehingga pesanan tidak
            mendapat kode pickup.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {blockedOrders.length === 0 && !loading ? (
            <p className="text-sm text-muted-foreground">Tidak ada antrean.</p>
          ) : (
            <div className="space-y-3">
              {blockedOrders.map((order) => (
                <div
                  key={order.orderId}
                  className="rounded-lg border p-4 text-sm space-y-1"
                >
                  <div className="flex items-center gap-2">
                    <a
                      className="font-medium underline"
                      href={`/admin/orders/${order.orderId}`}
                    >
                      {order.orderId.slice(0, 8).toUpperCase()}
                    </a>
                    <Badge variant="outline">paid</Badge>
                    <Badge variant="outline">{order.status}</Badge>
                    {order.paymentMethod && (
                      <Badge variant="secondary">{order.paymentMethod}</Badge>
                    )}
                  </div>
                  <div>
                    {order.customerName} ({order.customerEmail})
                    {order.branchName ? ` — ${order.branchName}` : ""} ·{" "}
                    {formatRupiah(order.total)} · diperbarui{" "}
                    {formatDate(order.updatedAt)}
                  </div>
                  <div>
                    ID remote: SO {order.jubelioSalesOrderId ?? "—"} · Invoice{" "}
                    {order.jubelioInvoiceId ?? "—"} · Payment{" "}
                    {order.jubelioPaymentId ?? "—"}
                  </div>
                  <div className="rounded bg-amber-50 p-2 text-xs text-amber-800">
                    {order.fulfillmentBlockedReason ??
                      "Settlement belum diverifikasi (invoice/pembayaran belum dikonfirmasi)."}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
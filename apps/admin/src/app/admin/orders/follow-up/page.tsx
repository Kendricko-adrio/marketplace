"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// =========================================================
// Ticket 07 — the delivery follow-up AREA: one scoped list (orders:view +
// the Branch Scope from Current Policy) with the "Jenis Kendala" filter,
// covering the settlement (paid-but-blocked), the packing failures, the
// settled ambiguous bookings and the RETURNED/SHIPMENT_ISSUE shipments — all
// BEFORE the order completes. The resolutions live on the order DETAIL page
// (the linked cards below); this page never mutates anything by itself.
// =========================================================

const KIND_LABELS: Record<string, string> = {
  all: "Semua kendala",
  settlement: "Settlement tertahan",
  packing: "Packing gagal",
  booking: "Booking ambigu",
  shipment: "Kendala pengiriman",
};

const FAILURE_CODE_LABELS: Record<string, string> = {
  physical_stock_unavailable: "Stok fisik habis",
  damaged_goods: "Barang rusak",
  paid_service_limits_exceeded: "Melebihi batas layanan yang dibayar",
};

interface FollowUpRow {
  orderId: string;
  kind: string;
  status: string;
  paymentStatus: string;
  deliveryFailureCode: string | null;
  fulfillmentBlockedReason: string | null;
  shipmentState: string | null;
  latestStatus: string | null;
  serviceName: string | null;
  destinationSummary: string | null;
}

export default function DeliveryFollowUpPage() {
  const [kind, setKind] = useState("all");
  const [rows, setRows] = useState<FollowUpRow[] | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (currentKind: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/orders/follow-up?kind=${currentKind}`);
      const data = (await res.json()) as { data?: FollowUpRow[] };
      setRows(data.data ?? []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(kind);
  }, [kind, load]);

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => history.back()}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-2xl font-bold tracking-tight">Tindak lanjut pengiriman</h1>
      </div>

      <div className="flex items-center gap-3">
        <span className="text-sm text-muted-foreground shrink-0">Jenis Kendala</span>
        <Select
          value={kind}
          onValueChange={(value) => setKind(value)}
        >
          <SelectTrigger
            id="jenisKendala"
            aria-label="Jenis Kendala"
            className="w-72"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(KIND_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      )}

      {!loading && rows && rows.length === 0 && (
        <Card>
          <CardContent className="p-6 text-center text-muted-foreground">
            Tidak ada tindak lanjut pengiriman untuk scope Anda.
          </CardContent>
        </Card>
      )}

      {!loading &&
        (rows ?? []).map((row) => (
          <Card key={`${row.kind}-${row.orderId}`}>
            <CardContent className="p-5">
              <div className="flex items-center gap-3 flex-wrap">
                <span className="rounded-full border bg-muted px-3 py-0.5 text-xs font-medium">
                  {KIND_LABELS[row.kind] ?? row.kind}
                </span>
                {row.deliveryFailureCode && (
                  <span className="text-sm font-medium text-destructive">
                    Tidak dapat dipenuhi: {
                      FAILURE_CODE_LABELS[row.deliveryFailureCode] ??
                      row.deliveryFailureCode
                    }
                  </span>
                )}
                {row.fulfillmentBlockedReason && (
                  <span className="text-sm text-amber-700">
                    Settlement belum terverifikasi
                  </span>
                )}
                {row.latestStatus && (
                  <span className="text-sm text-muted-foreground">
                    Status pengiriman: {row.latestStatus}
                  </span>
                )}
                {row.shipmentState === "booking_unknown" && (
                  <span className="text-sm text-amber-700">Booking ambigu (ditahan)</span>
                )}
                <span className="ml-auto text-xs font-mono text-muted-foreground">
                  {row.status} · {row.paymentStatus}
                </span>
              </div>
              {row.destinationSummary && (
                <p className="mt-2 text-sm text-muted-foreground line-clamp-1">
                  {row.destinationSummary}
                </p>
              )}
              {row.serviceName && (
                <p className="mt-1 text-sm text-muted-foreground">
                  Layanan: {row.serviceName}
                </p>
              )}
              <div className="mt-3">
                <Link
                  href={`/admin/orders/${row.orderId}`}
                  className="text-sm text-primary hover:underline"
                >
                  Buka detail pesanan
                </Link>
              </div>
            </CardContent>
          </Card>
        ))}
    </div>
  );
}
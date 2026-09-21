"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowUpRight,
  RefreshCw,
  ShoppingCart,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import RevenueTrendChart from "./revenue-trend-chart";
import {
  formatRupiah,
  statusLabel,
} from "./format";

// =========================================================
// Analytics dashboard — the only consumer of GET /api/admin/analytics.
//
// Fetches ONCE on mount (no polling): skeleton while in flight, error card
// with Coba Lagi on failure, full dashboard on success. The server layout
// already guarantees the analytics:view grant for anyone reaching this page.
// =========================================================

interface AnalyticsData {
  totalRevenue: number;
  monthlyRevenue: number;
  totalOrders: number;
  weeklyOrders: number;
  totalCustomers: number;
  averageOrderValue: number;
  ordersByStatus: { status: string; count: number }[];
  recentOrders: {
    id: string;
    total: string;
    status: string;
    createdAt: string;
    customer: string;
  }[];
  trend: { date: string; revenue: number; orders: number }[];
}

type DashboardState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; data: AnalyticsData };

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function AnalyticsDashboard() {
  const [state, setState] = useState<DashboardState>({ status: "loading" });
  // Fetch exactly once on mount: React StrictMode (dev) runs effects twice,
  // and the guard keeps the request count at one. Manual retries go through
  // the Coba Lagi button, never through re-mounting effects.
  const startedRef = useRef(false);

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const res = await fetch("/api/admin/analytics", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      if (!body.success) throw new Error("analytics request failed");
      setState({ status: "ready", data: body.data as AnalyticsData });
    } catch {
      setState({ status: "error" });
    }
  }, []);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void load();
  }, [load]);

  if (state.status === "loading") {
    return (
      <div data-testid="analytics-skeleton" className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-lg border bg-card p-6">
              <div className="h-4 w-28 animate-pulse rounded bg-muted" />
              <div className="mt-4 h-8 w-36 animate-pulse rounded bg-muted" />
              <div className="mt-3 h-3 w-24 animate-pulse rounded bg-muted" />
            </div>
          ))}
        </div>
        <div className="rounded-lg border bg-card p-6">
          <div className="h-5 w-44 animate-pulse rounded bg-muted" />
          <div className="mt-6 h-72 animate-pulse rounded bg-muted" />
        </div>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <Card data-testid="analytics-error" className="border-destructive/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            Gagal memuat analitik
          </CardTitle>
          <CardDescription>
            Data analitik tidak dapat diambil. Periksa koneksi Anda, lalu coba
            lagi.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button data-testid="analytics-retry" onClick={() => void load()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Coba Lagi
          </Button>
        </CardContent>
      </Card>
    );
  }

  const { data } = state;

  const kpis: {
    label: string;
    value: string;
    hint: string;
    icon: React.ComponentType<{ className?: string }>;
  }[] = [
    {
      label: "Total Pendapatan",
      value: formatRupiah(data.totalRevenue),
      hint: "Pesanan lunas (tidak dibatalkan), semua waktu",
      icon: Wallet,
    },
    {
      label: "Pendapatan 30 Hari",
      value: formatRupiah(data.monthlyRevenue),
      hint: "Rolling 30 × 24 jam terakhir",
      icon: TrendingUp,
    },
    {
      label: "Total Pesanan",
      value: data.totalOrders.toLocaleString("id-ID"),
      hint: "Semua status, semua waktu",
      icon: ShoppingCart,
    },
    {
      label: "Pesanan 7 Hari",
      value: data.weeklyOrders.toLocaleString("id-ID"),
      hint: "Rolling 7 × 24 jam terakhir",
      icon: ArrowUpRight,
    },
    {
      label: "Customer",
      value: data.totalCustomers.toLocaleString("id-ID"),
      hint: "Customer yang pernah bertransaksi",
      icon: Users,
    },
    {
      label: "Rata-rata Nilai Pesanan",
      value: formatRupiah(data.averageOrderValue),
      hint: "Pendapatan ÷ jumlah pesanan lunas",
      icon: Wallet,
    },
  ];

  return (
    <div data-testid="analytics-dashboard" className="space-y-6">
      {/* KPI cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {kpis.map((kpi) => {
          const Icon = kpi.icon;
          return (
            <Card key={kpi.label}>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-muted-foreground">
                    {kpi.label}
                  </p>
                  <Icon className="h-4 w-4 text-muted-foreground" />
                </div>
                <p className="mt-2 text-2xl font-bold tabular-nums">
                  {kpi.value}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{kpi.hint}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Revenue trend (30 WIB calendar days) */}
      <Card>
        <CardHeader>
          <CardTitle>Tren Pendapatan</CardTitle>
          <CardDescription>
            30 hari kalender terakhir (zona waktu WIB, diakhiri hari ini).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RevenueTrendChart trend={data.trend} />
        </CardContent>
      </Card>

      {/* Status breakdown + recent orders */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Pesanan per Status</CardTitle>
            <CardDescription>Semua pesanan dalam cakupan Anda.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.ordersByStatus.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Belum ada pesanan.
              </p>
            ) : (
              data.ordersByStatus.map((row) => (
                <div
                  key={row.status}
                  className="flex items-center justify-between text-sm"
                >
                  <span className="text-muted-foreground">
                    {statusLabel(row.status)}
                  </span>
                  <span className="font-medium tabular-nums">
                    {row.count.toLocaleString("id-ID")}
                  </span>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Pesanan Terbaru</CardTitle>
            <CardDescription>5 pesanan terakhir.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pelanggan</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Waktu</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead aria-label="Detail" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.recentOrders.map((order) => (
                  <TableRow key={order.id}>
                    <TableCell className="font-medium">
                      {order.customer}
                    </TableCell>
                    <TableCell>{statusLabel(order.status)}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDateTime(order.createdAt)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatRupiah(order.total)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Link
                        href={`/admin/orders/${order.id}`}
                        className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                      >
                        Detail
                        <ArrowUpRight className="h-3.5 w-3.5" />
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
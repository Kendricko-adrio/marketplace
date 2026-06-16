"use client";
import { useState, useEffect } from "react";
import {
  DollarSign,
  ShoppingBag,
  Package,
  Users,
  ArrowUpRight,
  Loader2,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

interface AnalyticsData {
  totalRevenue: number;
  monthlyRevenue: number;
  totalOrders: number;
  weeklyOrders: number;
  totalCustomers: number;
  ordersByStatus: { status: string; count: number }[];
  recentOrders: {
    id: string;
    total: string;
    status: string;
    createdAt: string;
    customer: string;
  }[];
}

export default function AdminDashboard() {
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchAnalytics() {
      try {
        const res = await fetch("/api/admin/analytics");
        const data = await res.json();
        if (data.success) {
          setAnalytics(data.data);
        }
      } catch (error) {
        console.error("Error fetching analytics:", error);
      } finally {
        setLoading(false);
      }
    }
    fetchAnalytics();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!analytics) {
    return (
      <div className="text-center py-16">
        <p className="text-muted-foreground">Gagal memuat data analytics</p>
      </div>
    );
  }

  const stats = [
    {
      title: "Total Pendapatan",
      value: `Rp ${analytics.totalRevenue.toLocaleString("id-ID")}`,
      subValue: `Rp ${analytics.monthlyRevenue.toLocaleString(
        "id-ID"
      )} bulan ini`,
      icon: DollarSign,
    },
    {
      title: "Total Pesanan",
      value: analytics.totalOrders.toLocaleString(),
      subValue: `${analytics.weeklyOrders} minggu ini`,
      icon: ShoppingBag,
    },
    {
      title: "Total Pelanggan",
      value: analytics.totalCustomers.toLocaleString(),
      subValue: "Pelanggan terdaftar",
      icon: Users,
    },
  ];

  const getStatusBadge = (status: string) => {
    const variants: Record<
      string,
      "default" | "secondary" | "destructive" | "outline"
    > = {
      selesai: "default",
      dikirim: "secondary",
      proses: "secondary",
      batal: "destructive",
      pending: "outline",
    };
    return variants[status] || "secondary";
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("id-ID", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-3xl font-bold tracking-tight">
          Dashboard Overview
        </h2>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        {stats.map((stat, index) => (
          <Card key={index}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {stat.title}
              </CardTitle>
              <stat.icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stat.value}</div>
              <p className="text-xs text-muted-foreground flex items-center mt-1">
                <ArrowUpRight className="h-3 w-3 mr-1 text-green-600" />
                {stat.subValue}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        {/* Orders by Status */}
        <Card className="col-span-4">
          <CardHeader>
            <CardTitle>Status Pesanan</CardTitle>
            <CardDescription>
              Distribusi pesanan berdasarkan status
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {analytics.ordersByStatus.map((item) => (
                <div
                  key={item.status}
                  className="p-4 border rounded-lg text-center"
                >
                  <div className="text-2xl font-bold">{item.count}</div>
                  <div className="text-sm text-muted-foreground capitalize">
                    {item.status}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Recent Orders */}
        <Card className="col-span-3">
          <CardHeader>
            <CardTitle>Pesanan Terbaru</CardTitle>
            <CardDescription>5 pesanan terakhir</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pelanggan</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {analytics.recentOrders.map((order) => (
                  <TableRow key={order.id}>
                    <TableCell>
                      <div className="font-medium">
                        {order.customer || "Guest"}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {formatDate(order.createdAt)}
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      Rp {parseFloat(order.total).toLocaleString("id-ID")}
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge
                        variant={getStatusBadge(order.status)}
                        className="text-xs capitalize"
                      >
                        {order.status}
                      </Badge>
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

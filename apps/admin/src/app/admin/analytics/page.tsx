"use client";
import { Activity, CreditCard, TrendingUp, Users } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function AdminAnalyticsPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight">Analitik</h2>
        <Button variant="outline">Download Report</Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
            <CreditCard className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">Rp 150.2M</div>
            <p className="text-xs text-muted-foreground">
              +20.1% from last month
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Subscriptions</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">+2350</div>
            <p className="text-xs text-muted-foreground">
              +180.1% from last month
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Sales</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">+12,234</div>
            <p className="text-xs text-muted-foreground">
              +19% from last month
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Now</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">+573</div>
            <p className="text-xs text-muted-foreground">
              +201 since last hour
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Traffic Sources Placeholder */}
        <Card className="col-span-1">
          <CardHeader>
            <CardTitle>Sumber Trafik</CardTitle>
            <CardDescription>
              Asal pengunjung toko dalam 30 hari terakhir.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {[
                { source: "Direct", value: 40, color: "bg-primary" },
                { source: "Social Media", value: 30, color: "bg-blue-500" },
                { source: "Organic Search", value: 20, color: "bg-green-500" },
                { source: "Referral", value: 10, color: "bg-yellow-500" },
              ].map((item) => (
                <div key={item.source} className="flex items-center">
                  <div className="w-32 text-sm">{item.source}</div>
                  <div className="flex-1 h-2 bg-secondary rounded-full overflow-hidden">
                    <div
                      className={`h-full ${item.color}`}
                      style={{ width: `${item.value}%` }}
                    ></div>
                  </div>
                  <div className="w-12 text-right text-sm font-medium">
                    {item.value}%
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Audit Log */}
        <Card className="col-span-1">
          <CardHeader>
            <CardTitle>Audit Log Aktivitas</CardTitle>
            <CardDescription>
              Aktivitas terbaru admin dan sistem.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-6 border-l-2 border-muted ml-2 pl-6">
              {[
                {
                  user: "Admin Toko",
                  action: "Memupdate stok produk AirRunner Pro Running Shoes",
                  time: "2 menit lalu",
                },
                {
                  user: "System",
                  action: "Backup database otomatis berhasil",
                  time: "1 jam lalu",
                },
                {
                  user: "Staff Gudang",
                  action: "Memproses pesanan #ORD-2024002",
                  time: "2 jam lalu",
                },
              ].map((log, i) => (
                <div key={i} className="relative">
                  <div className="absolute -left-[31px] top-1 h-3 w-3 rounded-full bg-primary ring-4 ring-background" />
                  <div className="text-sm font-medium">{log.action}</div>
                  <div className="text-xs text-muted-foreground mb-1">
                    Oleh: <span className="font-semibold">{log.user}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {log.time}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

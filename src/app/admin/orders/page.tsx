"use client";
import { useState, useEffect } from "react";
import { Eye, Search, MoreHorizontal, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface Order {
  id: string;
  total: string;
  status: string;
  paymentStatus: string;
  createdAt: string;
  customer: {
    name: string;
    email: string;
  };
  itemCount: number;
}

export default function AdminOrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    fetchOrders();
  }, [activeTab]);

  async function fetchOrders() {
    setLoading(true);
    try {
      const statusParam = activeTab !== "all" ? `?status=${activeTab}` : "";
      const res = await fetch(`/api/admin/orders${statusParam}`);
      const data = await res.json();
      if (data.success) {
        setOrders(data.data);
      }
    } catch (error) {
      console.error("Error fetching orders:", error);
    } finally {
      setLoading(false);
    }
  }

  async function updateOrderStatus(orderId: string, newStatus: string) {
    try {
      const res = await fetch(`/api/admin/orders/${orderId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) {
        fetchOrders(); // Refresh list
      }
    } catch (error) {
      console.error("Error updating order:", error);
    }
  }

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

  const filteredOrders = orders.filter((order) => {
    if (!searchQuery) return true;
    const search = searchQuery.toLowerCase();
    return (
      order.id.toLowerCase().includes(search) ||
      order.customer.name.toLowerCase().includes(search) ||
      order.customer.email.toLowerCase().includes(search)
    );
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight">Pesanan</h2>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Daftar Pesanan</CardTitle>
          <CardDescription>
            Pantau dan kelola pesanan pelanggan Anda.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col md:flex-row gap-4 mb-6 justify-between">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Cari ID pesanan, nama pelanggan..."
                className="pl-8"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>

          <Tabs
            defaultValue="all"
            onValueChange={setActiveTab}
            className="w-full"
          >
            <TabsList className="mb-4">
              <TabsTrigger value="all">Semua</TabsTrigger>
              <TabsTrigger value="proses">Perlu Diproses</TabsTrigger>
              <TabsTrigger value="dikirim">Sedang Dikirim</TabsTrigger>
              <TabsTrigger value="selesai">Selesai</TabsTrigger>
              <TabsTrigger value="batal">Dibatalkan</TabsTrigger>
            </TabsList>

            <TabsContent value={activeTab}>
              {loading ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
              ) : (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[140px]">Order ID</TableHead>
                        <TableHead>Pelanggan</TableHead>
                        <TableHead>Tanggal</TableHead>
                        <TableHead className="text-center">Items</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Aksi</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredOrders.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={7} className="h-24 text-center">
                            Tidak ada pesanan ditemukan.
                          </TableCell>
                        </TableRow>
                      ) : (
                        filteredOrders.map((order) => (
                          <TableRow key={order.id}>
                            <TableCell className="font-mono text-xs">
                              {order.id.slice(0, 8)}...
                            </TableCell>
                            <TableCell>
                              <div className="font-medium">
                                {order.customer.name}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {order.customer.email}
                              </div>
                            </TableCell>
                            <TableCell>{formatDate(order.createdAt)}</TableCell>
                            <TableCell className="text-center">
                              {order.itemCount}
                            </TableCell>
                            <TableCell className="text-right font-medium">
                              Rp{" "}
                              {parseFloat(order.total).toLocaleString("id-ID")}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant={getStatusBadge(order.status)}
                                className="capitalize"
                              >
                                {order.status}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right">
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    className="h-8 w-8 p-0"
                                  >
                                    <MoreHorizontal className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuLabel>Aksi</DropdownMenuLabel>
                                  <DropdownMenuItem className="cursor-pointer gap-2">
                                    <Eye className="h-4 w-4" /> Detail Pesanan
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    className="cursor-pointer"
                                    onClick={() =>
                                      updateOrderStatus(order.id, "proses")
                                    }
                                    disabled={order.status === "proses"}
                                  >
                                    Set Proses
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    className="cursor-pointer"
                                    onClick={() =>
                                      updateOrderStatus(order.id, "dikirim")
                                    }
                                    disabled={order.status === "dikirim"}
                                  >
                                    Set Dikirim
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    className="cursor-pointer"
                                    onClick={() =>
                                      updateOrderStatus(order.id, "selesai")
                                    }
                                    disabled={order.status === "selesai"}
                                  >
                                    Set Selesai
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}

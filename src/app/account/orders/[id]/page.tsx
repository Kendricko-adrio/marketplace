"use client";
import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Image from "next/image";
import {
  ArrowLeft,
  Package,
  Truck,
  CreditCard,
  MapPin,
  Loader2,
  ShoppingBag,
  Copy,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

interface OrderItem {
  id: string;
  orderId: string;
  variantId: string;
  productName: string;
  variantInfo: string | null;
  price: string;
  quantity: number;
  createdAt: string;
  productId: string;
  imageUrl: string | null;
}

interface Address {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  fullAddress: string;
  city: string;
  district: string;
  postalCode: string;
}

interface OrderDetail {
  id: string;
  userId: string;
  status: string;
  paymentMethod: string | null;
  paymentStatus: string;
  subtotal: string;
  shippingCost: string;
  discount: string;
  serviceFee: string;
  total: string;
  shippingCarrier: string | null;
  trackingNumber: string | null;
  createdAt: string;
  address: Address | null;
  items: OrderItem[];
}

const statusMap: Record<
  string,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  proses: { label: "Diproses", variant: "secondary" },
  dikirim: { label: "Dikirim", variant: "outline" },
  selesai: { label: "Selesai", variant: "default" },
  batal: { label: "Dibatalkan", variant: "destructive" },
};

const paymentMethodMap: Record<string, string> = {
  qris: "QRIS",
  va: "Virtual Account",
};

const paymentStatusMap: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  pending: { label: "Menunggu", variant: "outline" },
  paid: { label: "Lunas", variant: "default" },
  failed: { label: "Gagal", variant: "destructive" },
};

function formatRupiah(value: string) {
  return `Rp ${parseFloat(value).toLocaleString("id-ID")}`;
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function OrderDetailPage() {
  const params = useParams();
  const router = useRouter();
  const orderId = params.id as string;

  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    async function fetchOrder() {
      try {
        const res = await fetch(`/api/orders/${orderId}`);
        const data = await res.json();
        if (data.success) {
          setOrder(data.data);
        } else {
          setError(data.error || "Pesanan tidak ditemukan");
        }
      } catch {
        setError("Terjadi kesalahan. Silakan coba lagi.");
      } finally {
        setLoading(false);
      }
    }
    fetchOrder();
  }, [orderId]);

  async function copyOrderId() {
    if (!order) return;
    await navigator.clipboard.writeText(order.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="flex items-center justify-center py-32">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="text-center py-32 space-y-4">
          <Package className="h-16 w-16 mx-auto text-muted-foreground" />
          <p className="text-lg text-muted-foreground">
            {error ?? "Pesanan tidak ditemukan"}
          </p>
          <Button variant="outline" onClick={() => router.push("/account")}>
            Kembali ke Akun
          </Button>
        </div>
      </div>
    );
  }

  const status = statusMap[order.status] ?? {
    label: order.status,
    variant: "secondary" as const,
  };
  const payStatus = paymentStatusMap[order.paymentStatus] ?? {
    label: order.paymentStatus,
    variant: "outline" as const,
  };

  const discountNum = parseFloat(order.discount);

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => router.push("/account")}
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold">Detail Pesanan</h1>
          <p className="text-sm text-muted-foreground">
            {formatDate(order.createdAt)}
          </p>
        </div>
        <Badge variant={status.variant} className="ml-auto text-sm">
          {status.label}
        </Badge>
      </div>

      {/* Order ID */}
      <div className="flex items-center gap-2 mb-6 text-sm">
        <span className="text-muted-foreground">ID Pesanan:</span>
        <span className="font-mono">{order.id}</span>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={copyOrderId}>
          {copied ? (
            <Check className="h-3.5 w-3.5 text-green-600" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Items + Summary */}
        <div className="lg:col-span-2 space-y-6">
          {/* Items */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <ShoppingBag className="h-4 w-4" />
                Barang Pesanan ({order.items.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {order.items.map((item) => (
                <div
                  key={item.id}
                  className="flex gap-4 p-3 rounded-lg border bg-card"
                >
                  <div className="h-20 w-20 bg-muted rounded-md overflow-hidden flex items-center justify-center text-muted-foreground shrink-0">
                    {item.imageUrl ? (
                      <Image
                        src={item.imageUrl}
                        alt={item.productName}
                        width={80}
                        height={80}
                        className="object-cover w-full h-full"
                      />
                    ) : (
                      <Package className="h-8 w-8" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="font-medium truncate">{item.productName}</h4>
                    {item.variantInfo && (
                      <p className="text-sm text-muted-foreground">
                        {item.variantInfo}
                      </p>
                    )}
                    <p className="text-sm text-muted-foreground">
                      {item.quantity} x {formatRupiah(item.price)}
                    </p>
                  </div>
                  <div className="text-right shrink-0 flex flex-col justify-between">
                    <p className="font-semibold">
                      {formatRupiah(
                        (parseFloat(item.price) * item.quantity).toString()
                      )}
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-2"
                      onClick={() => router.push(`/products/${item.productId}`)}
                    >
                      <ShoppingBag className="h-3.5 w-3.5 mr-1.5" />
                      Beli Lagi
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Price Summary */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Ringkasan Pembayaran</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Subtotal</span>
                <span>{formatRupiah(order.subtotal)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Ongkos Kirim</span>
                <span>{formatRupiah(order.shippingCost)}</span>
              </div>
              {discountNum > 0 && (
                <div className="flex justify-between text-sm text-green-600">
                  <span>Diskon</span>
                  <span>-{formatRupiah(order.discount)}</span>
                </div>
              )}
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Biaya Layanan</span>
                <span>{formatRupiah(order.serviceFee)}</span>
              </div>
              <Separator />
              <div className="flex justify-between font-bold text-lg">
                <span>Total</span>
                <span className="text-primary">{formatRupiah(order.total)}</span>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right: Shipping & Payment */}
        <div className="space-y-6">
          {/* Shipping Info */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Truck className="h-4 w-4" />
                Pengiriman
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {order.shippingCarrier && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Kurir</span>
                  <span className="font-medium">{order.shippingCarrier}</span>
                </div>
              )}
              {order.trackingNumber && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">No. Resi</span>
                  <span className="font-mono text-xs">
                    {order.trackingNumber}
                  </span>
                </div>
              )}
              {order.address && (
                <>
                  <Separator />
                  <div className="flex items-start gap-2">
                    <MapPin className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                    <div>
                      <p className="font-medium">
                        {order.address.firstName} {order.address.lastName}
                      </p>
                      <p className="text-muted-foreground">
                        {order.address.phone}
                      </p>
                      <p className="text-muted-foreground mt-1">
                        {order.address.fullAddress}, {order.address.district},{" "}
                        {order.address.city} {order.address.postalCode}
                      </p>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Payment Info */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <CreditCard className="h-4 w-4" />
                Pembayaran
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {order.paymentMethod && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Metode</span>
                  <span className="font-medium">
                    {paymentMethodMap[order.paymentMethod] ??
                      order.paymentMethod}
                  </span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-muted-foreground">Status</span>
                <Badge variant={payStatus.variant}>{payStatus.label}</Badge>
              </div>
            </CardContent>
          </Card>

          {/* Back Button */}
          <Button
            variant="outline"
            className="w-full"
            onClick={() => router.push("/account")}
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Kembali ke Riwayat Pesanan
          </Button>
        </div>
      </div>
    </div>
  );
}

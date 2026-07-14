"use client";
import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Image from "next/image";
import {
  ArrowLeft,
  Package,
  CreditCard,
  MapPin,
  Calendar,
  Clock,
  Loader2,
  ShoppingBag,
  Copy,
  Check,
  AlertCircle,
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

interface Branch {
  id: string;
  name: string;
  address: string;
  city: string;
  operatingHours: Record<string, unknown>;
}

interface OrderDetail {
  id: string;
  userId: string;
  status: string;
  paymentMethod: string | null;
  paymentStatus: string;
  pickupCode: string | null;
  pickupDate: string | null;
  pickupTime: string | null;
  contactPhone: string;
  contactEmail: string;
  subtotal: string;
  shippingCost: string;
  discount: string;
  serviceFee: string;
  total: string;
  createdAt: string;
  snapRedirectUrl: string | null;
  branch: Branch | null;
  items: OrderItem[];
}

const statusMap: Record<
  string,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  pending_payment: { label: "Pending Payment", variant: "outline" },
  processing: { label: "Processing", variant: "secondary" },
  ready_for_pickup: { label: "Ready for Pickup", variant: "default" },
  completed: { label: "Completed", variant: "default" },
  cancelled: { label: "Cancelled", variant: "destructive" },
};

const paymentStatusMap: Record<
  string,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  pending: { label: "Menunggu", variant: "outline" },
  paid: { label: "Lunas", variant: "default" },
  failed: { label: "Gagal", variant: "destructive" },
};

const STATUS_STEPS = [
  { key: "pending_payment", label: "Order Placed" },
  { key: "processing", label: "Paid" },
  { key: "ready_for_pickup", label: "Ready for Pickup" },
  { key: "completed", label: "Completed" },
];

function formatRupiah(value: string) {
  return `Rp ${parseFloat(value).toLocaleString("id-ID")}`;
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatDateTime(dateStr: string) {
  return new Date(dateStr).toLocaleString("id-ID", {
    day: "numeric",
    month: "short",
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
  const [copiedCode, setCopiedCode] = useState(false);

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

  function copyPickupCode() {
    if (order?.pickupCode) {
      navigator.clipboard.writeText(order.pickupCode);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    }
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

  const currentStepIndex = STATUS_STEPS.findIndex(
    (s) => s.key === order.status
  );
  const isCancelled = order.status === "cancelled";

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
            {formatDateTime(order.createdAt)}
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

      {/* Status Stepper */}
      {!isCancelled && (
        <Card className="mb-6">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              {STATUS_STEPS.map((step, i) => {
                const isComplete = currentStepIndex > i;
                const isCurrent = currentStepIndex === i;
                return (
                  <div
                    key={step.key}
                    className="flex items-center flex-1 last:flex-none"
                  >
                    <div className="flex flex-col items-center gap-1">
                      <div
                        className={`flex h-10 w-10 items-center justify-center rounded-full border-2 ${
                          isComplete
                            ? "border-green-600 bg-green-600 text-white"
                            : isCurrent
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-muted bg-background text-muted-foreground"
                        }`}
                      >
                        {isComplete ? (
                          <Check className="h-5 w-5" />
                        ) : (
                          <span className="text-sm font-medium">{i + 1}</span>
                        )}
                      </div>
                      <span
                        className={`text-xs text-center ${
                          isCurrent ? "font-semibold" : "text-muted-foreground"
                        }`}
                      >
                        {step.label}
                      </span>
                    </div>
                    {i < STATUS_STEPS.length - 1 && (
                      <div
                        className={`flex-1 h-0.5 mx-2 ${
                          isComplete ? "bg-green-600" : "bg-muted"
                        }`}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {isCancelled && (
        <Card className="mb-6">
          <CardContent className="p-6 text-center">
            <AlertCircle className="h-10 w-10 mx-auto text-destructive mb-2" />
            <p className="font-semibold text-destructive">
              Pesanan ini telah dibatalkan
            </p>
          </CardContent>
        </Card>
      )}

      {/* Pickup Code Block */}
      {order.pickupCode &&
        (order.status === "ready_for_pickup" ||
          order.status === "completed") && (
          <Card className="mb-6">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground mb-1">
                    Kode Pickup Anda
                  </p>
                  <p className="font-mono text-3xl font-bold tracking-widest text-primary">
                    {order.pickupCode}
                  </p>
                  <p className="text-xs text-muted-foreground mt-2">
                    Tunjukkan kode ini kepada staf cabang saat pengambilan.
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={copyPickupCode}
                  className="gap-1"
                >
                  {copiedCode ? (
                    <>
                      <Check className="h-4 w-4" /> Copied
                    </>
                  ) : (
                    <>
                      <Copy className="h-4 w-4" /> Copy
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

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
                <span className="text-green-600">Gratis (Pickup)</span>
              </div>
              <Separator />
              <div className="flex justify-between font-bold text-lg">
                <span>Total</span>
                <span className="text-primary">{formatRupiah(order.total)}</span>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right: Pickup + Payment Info */}
        <div className="space-y-6">
          {/* Pickup Info */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <MapPin className="h-4 w-4" />
                Pengambilan
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {order.branch ? (
                <>
                  <div className="flex items-start gap-2">
                    <MapPin className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                    <div>
                      <p className="font-medium">{order.branch.name}</p>
                      <p className="text-muted-foreground">
                        {order.branch.address}, {order.branch.city}
                      </p>
                    </div>
                  </div>
                  {order.pickupDate && (
                    <div className="flex items-center gap-2">
                      <Calendar className="h-4 w-4 text-muted-foreground" />
                      <span>{formatDate(order.pickupDate)}</span>
                    </div>
                  )}
                  {order.pickupTime && (
                    <div className="flex items-center gap-2">
                      <Clock className="h-4 w-4 text-muted-foreground" />
                      <span>{order.pickupTime}</span>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-muted-foreground">
                  Lokasi pickup tidak tersedia
                </p>
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
              <div className="flex justify-between">
                <span className="text-muted-foreground">Metode</span>
                <span className="font-medium uppercase">
                  {order.paymentMethod || "—"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Status</span>
                <Badge variant={payStatus.variant}>{payStatus.label}</Badge>
              </div>
              {order.status === "pending_payment" &&
                order.snapRedirectUrl && (
                  <>
                    <Separator />
                    <div className="pt-1">
                      <Button
                        className="w-full"
                        onClick={() =>
                          (window.location.href = order.snapRedirectUrl!)
                        }
                      >
                        <CreditCard className="h-4 w-4 mr-2" />
                        Bayar Sekarang
                      </Button>
                      <p className="text-xs text-muted-foreground mt-2 text-center">
                        Selesaikan pembayaran Anda sebelum link kedaluwarsa.
                      </p>
                    </div>
                  </>
                )}
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
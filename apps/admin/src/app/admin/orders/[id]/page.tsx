"use client";
import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Image from "next/image";
import {
  ArrowLeft,
  MapPin,
  Calendar,
  Clock,
  Phone,
  Mail,
  Package,
  Loader2,
  Copy,
  Check,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

interface OrderItem {
  id: string;
  productName: string;
  variantInfo: string | null;
  price: string;
  quantity: number;
  imageUrl: string | null;
  productId: string;
}

interface OrderDetail {
  id: string;
  status: string;
  paymentStatus: string;
  paymentMethod: string | null;
  pickupCode: string | null;
  pickupDate: string | null;
  pickupTime: string | null;
  contactPhone: string;
  contactEmail: string;
  subtotal: string;
  serviceFee: string;
  total: string;
  createdAt: string;
  updatedAt: string;
  customer: { id: string; name: string; email: string };
  branch: {
    id: string;
    name: string;
    address: string;
    city: string;
    operatingHours: Record<string, unknown>;
  } | null;
  items: OrderItem[];
}

const STATUS_STEPS = [
  { key: "pending_payment", label: "Order Placed" },
  { key: "processing", label: "Paid" },
  { key: "ready_for_pickup", label: "Ready for Pickup" },
  { key: "completed", label: "Completed" },
];

const STATUS_LABELS: Record<string, string> = {
  pending_payment: "Pending Payment",
  processing: "Processing",
  ready_for_pickup: "Ready for Pickup",
  completed: "Completed",
  cancelled: "Cancelled",
};

const STATUS_BADGES: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
  pending_payment: "outline",
  processing: "secondary",
  ready_for_pickup: "default",
  completed: "default",
  cancelled: "destructive",
};

export default function AdminOrderDetailPage() {
  const params = useParams();
  const router = useRouter();
  const orderId = params.id as string;

  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [userRole, setUserRole] = useState<string>("admin");
  const [userBranchId, setUserBranchId] = useState<string | null>(null);
  const [codeInput, setCodeInput] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    async function fetchSession() {
      try {
        const res = await fetch("/api/auth/getSession");
        const data = await res.json();
        if (data?.user) {
          setUserRole(data.user.role || "admin");
          setUserBranchId(data.user.branchId || null);
        }
      } catch {
        // ignore
      }
    }
    fetchSession();
  }, []);

  useEffect(() => {
    async function fetchOrder() {
      try {
        const res = await fetch(`/api/admin/orders/${orderId}`);
        const data = await res.json();
        if (data.success) {
          setOrder(data.data);
        }
      } catch (error) {
        console.error("Error fetching order:", error);
      } finally {
        setLoading(false);
      }
    }
    fetchOrder();
  }, [orderId]);

  const isBranchAdmin =
    userRole === "admin" && !!userBranchId;

  const canVerifyPickup =
    order?.status === "ready_for_pickup" && isBranchAdmin;

  const handleVerify = async () => {
    if (!codeInput.trim()) return;
    setVerifying(true);
    setVerifyError("");
    try {
      const res = await fetch(`/api/admin/orders/${orderId}/verify-pickup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pickupCodeInput: codeInput }),
      });
      const data = await res.json();
      if (data.success) {
        // Refetch order to show updated status
        const refetch = await fetch(`/api/admin/orders/${orderId}`);
        const refetchData = await refetch.json();
        if (refetchData.success) {
          setOrder(refetchData.data);
        }
        setCodeInput("");
      } else {
        setVerifyError(data.error || "Verification failed");
      }
    } catch {
      setVerifyError("An error occurred. Please try again.");
    } finally {
      setVerifying(false);
    }
  };

  const copyCode = () => {
    if (order?.pickupCode) {
      navigator.clipboard.writeText(order.pickupCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("id-ID", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!order) {
    return (
      <div className="text-center py-20">
        <h2 className="text-xl font-bold mb-2">Order not found</h2>
        <Button onClick={() => router.push("/admin/orders")}>
          Back to Orders
        </Button>
      </div>
    );
  }

  const currentStepIndex = STATUS_STEPS.findIndex(
    (s) => s.key === order.status
  );
  const isCancelled = order.status === "cancelled";

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Back link */}
      <Button
        variant="ghost"
        size="sm"
        className="gap-1"
        onClick={() => router.push("/admin/orders")}
      >
        <ArrowLeft className="h-4 w-4" /> Back to Orders
      </Button>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">
            Order #{order.id.slice(0, 8).toUpperCase()}
          </h2>
          <p className="text-sm text-muted-foreground">
            {formatDate(order.createdAt)}
          </p>
        </div>
        <div className="flex gap-2">
          <Badge variant={STATUS_BADGES[order.status] || "secondary"}>
            {STATUS_LABELS[order.status] || order.status}
          </Badge>
          <Badge variant="outline">{order.paymentStatus}</Badge>
        </div>
      </div>

      {/* Status Stepper */}
      {!isCancelled && (
        <Card>
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
        <Card>
          <CardContent className="p-6 text-center">
            <AlertCircle className="h-10 w-10 mx-auto text-destructive mb-2" />
            <p className="font-semibold text-destructive">
              This order was cancelled
            </p>
          </CardContent>
        </Card>
      )}

      {/* Pickup Code Block */}
      {order.pickupCode &&
        (order.status === "ready_for_pickup" ||
          order.status === "completed") && (
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground mb-1">
                    Pickup Code
                  </p>
                  <p className="font-mono text-3xl font-bold tracking-widest text-primary">
                    {order.pickupCode}
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={copyCode} className="gap-1">
                  {copied ? (
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

      {/* Verify Pickup Code (branch admin only, when ready_for_pickup) */}
      {canVerifyPickup && (
        <Card>
          <CardContent className="p-6">
            <h3 className="font-semibold mb-1">Verify Customer Pickup Code</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Ask the customer for their 6-digit pickup code and enter it below
              to complete the order.
            </p>
            <div className="flex gap-3">
              <div className="flex-1">
                <Label htmlFor="pickupCodeInput" className="sr-only">
                  Pickup Code
                </Label>
                <Input
                  id="pickupCodeInput"
                  placeholder="e.g. A8X3K9"
                  value={codeInput}
                  onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
                  maxLength={6}
                  className="font-mono text-lg tracking-widest"
                />
              </div>
              <Button
                onClick={handleVerify}
                disabled={verifying || !codeInput.trim()}
                className="gap-2"
              >
                {verifying ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Check className="h-4 w-4" />
                )}
                Verify & Complete
              </Button>
            </div>
            {verifyError && (
              <p className="mt-3 text-sm text-destructive flex items-center gap-1">
                <AlertCircle className="h-4 w-4" /> {verifyError}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Status info for non-interactive states */}
      {order.status === "pending_payment" && (
        <Card>
          <CardContent className="p-6 text-center text-muted-foreground">
            <Clock className="h-8 w-8 mx-auto mb-2" />
            Waiting for customer payment...
          </CardContent>
        </Card>
      )}
      {order.status === "processing" && (
        <Card>
          <CardContent className="p-6 text-center text-muted-foreground">
            <Package className="h-8 w-8 mx-auto mb-2" />
            Order is being prepared. Pickup code will be generated automatically.
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Customer Info */}
        <Card>
          <CardContent className="p-6">
            <h3 className="font-semibold mb-4">Customer</h3>
            <div className="space-y-2 text-sm">
              <div className="font-medium">{order.customer.name}</div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <Mail className="h-4 w-4" /> {order.customer.email}
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <Phone className="h-4 w-4" /> {order.contactPhone}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Branch + Pickup Info */}
        <Card>
          <CardContent className="p-6">
            <h3 className="font-semibold mb-4">Pickup Location</h3>
            {order.branch ? (
              <div className="space-y-2 text-sm">
                <div className="flex items-start gap-2">
                  <MapPin className="h-4 w-4 mt-0.5 text-primary" />
                  <div>
                    <div className="font-medium">{order.branch.name}</div>
                    <div className="text-muted-foreground">
                      {order.branch.address}, {order.branch.city}
                    </div>
                  </div>
                </div>
                {order.pickupDate && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Calendar className="h-4 w-4" />
                    {formatDate(order.pickupDate)}
                  </div>
                )}
                {order.pickupTime && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Clock className="h-4 w-4" /> {order.pickupTime}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No branch assigned</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Order Items */}
      <Card>
        <CardContent className="p-6">
          <h3 className="font-semibold mb-4">Order Items</h3>
          <div className="space-y-3">
            {order.items.map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-4 rounded-lg border p-3"
              >
                <div className="h-16 w-16 rounded-md bg-secondary/50 flex-shrink-0 relative overflow-hidden">
                  {item.imageUrl && (
                    <Image
                      src={item.imageUrl}
                      alt={item.productName}
                      fill
                      className="object-cover"
                    />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium line-clamp-1">{item.productName}</div>
                  {item.variantInfo && (
                    <div className="text-sm text-muted-foreground">
                      {item.variantInfo}
                    </div>
                  )}
                  <div className="text-sm text-muted-foreground">
                    Qty: {item.quantity}
                  </div>
                </div>
                <div className="font-medium">
                  Rp{" "}
                  {(parseFloat(item.price) * item.quantity).toLocaleString(
                    "id-ID"
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Price breakdown */}
          <div className="mt-6 space-y-2 border-t pt-4">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Subtotal</span>
              <span>Rp {parseFloat(order.subtotal).toLocaleString("id-ID")}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Service Fee</span>
              <span>
                Rp {parseFloat(order.serviceFee).toLocaleString("id-ID")}
              </span>
            </div>
            <div className="flex justify-between font-bold pt-2 border-t">
              <span>Total</span>
              <span className="text-primary">
                Rp {parseFloat(order.total).toLocaleString("id-ID")}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
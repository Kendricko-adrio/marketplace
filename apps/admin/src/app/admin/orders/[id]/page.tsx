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
  Check,
  AlertCircle,
  PackageCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/providers/auth-provider";
import { toStoreUrl } from "@/lib/store-url";

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
  paymentFailureReason: string | null;
  midtransFailureStatus: string | null;
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
  failed_payment: "Payment Failed",
};

const STATUS_BADGES: Record<string, string> = {
  pending_payment:
    "bg-amber-100 text-amber-700 border-amber-200 hover:bg-amber-100",
  processing: "bg-blue-100 text-blue-700 border-blue-200 hover:bg-blue-100",
  ready_for_pickup:
    "bg-violet-100 text-violet-700 border-violet-200 hover:bg-violet-100",
  completed: "bg-green-100 text-green-700 border-green-200 hover:bg-green-100",
  cancelled: "bg-red-100 text-red-700 border-red-200 hover:bg-red-100",
  failed_payment:
    "bg-orange-100 text-orange-700 border-orange-200 hover:bg-orange-100",
};

const PAYMENT_BADGES: Record<string, string> = {
  pending:
    "bg-amber-100 text-amber-700 border-amber-200 hover:bg-amber-100",
  paid: "bg-emerald-100 text-emerald-700 border-emerald-200 hover:bg-emerald-100",
  failed: "bg-red-100 text-red-700 border-red-200 hover:bg-red-100",
};

export default function AdminOrderDetailPage() {
  const params = useParams();
  const router = useRouter();
  const orderId = params.id as string;
  const { hasPermission } = useAuth();

  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [userRole, setUserRole] = useState<string>("admin");
  const [userBranchId, setUserBranchId] = useState<string | null>(null);
  const [codeInput, setCodeInput] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState("");
  const [pickupModalOpen, setPickupModalOpen] = useState(false);

  useEffect(() => {
    async function fetchMe() {
      try {
        const res = await fetch("/api/admin/me");
        const data = await res.json();
        if (data?.success && data?.user) {
          setUserRole(data.user.role || "admin");
          setUserBranchId(data.user.branchId || null);
        }
      } catch {
        // ignore
      }
    }
    fetchMe();
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
    order?.status === "ready_for_pickup" && isBranchAdmin && hasPermission("orders", "edit");

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
        setPickupModalOpen(false);
        toast.success("Order completed successfully");
      } else {
        setVerifyError(data.error || "Verification failed");
        toast.error(data.error || "Verification failed");
      }
    } catch {
      setVerifyError("An error occurred. Please try again.");
      toast.error("An error occurred. Please try again.");
    } finally {
      setVerifying(false);
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
  const isFailedPayment = order.status === "failed_payment";

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
        <div className="flex gap-2 items-center">
          {canVerifyPickup && (
            <Button
              className="gap-2"
              onClick={() => {
                setVerifyError("");
                setPickupModalOpen(true);
              }}
            >
              <PackageCheck className="h-4 w-4" />
              Customer Pick Up
            </Button>
          )}
          <Badge className={STATUS_BADGES[order.status]}>
            {STATUS_LABELS[order.status] || order.status}
          </Badge>
          <Badge className={PAYMENT_BADGES[order.paymentStatus]}>
            {order.paymentStatus}
          </Badge>
        </div>
      </div>

      {/* Status Stepper */}
      {!isCancelled && !isFailedPayment && (
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

      {isFailedPayment && (
        <Card>
          <CardContent className="p-6 text-center">
            <AlertCircle className="h-10 w-10 mx-auto text-destructive mb-2" />
            <p className="font-semibold text-destructive">
              Payment Failed
            </p>
            {order.paymentFailureReason && (
              <p className="text-sm text-muted-foreground mt-2">
                {order.paymentFailureReason}
              </p>
            )}
            {order.midtransFailureStatus && (
              <p className="text-xs text-muted-foreground mt-1">
                Midtrans status:{" "}
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono">
                  {order.midtransFailureStatus}
                </code>
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
                      src={toStoreUrl(item.imageUrl)}
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
            <div className="flex justify-between font-bold pt-2 border-t">
              <span>Total</span>
              <span className="text-primary">
                Rp {parseFloat(order.total).toLocaleString("id-ID")}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Customer Pick Up Modal */}
      <Dialog
        open={pickupModalOpen}
        onOpenChange={(v) => {
          setPickupModalOpen(v);
          if (!v) {
            setVerifyError("");
            setCodeInput("");
          }
        }}
      >
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>Customer Pick Up</DialogTitle>
            <DialogDescription>
              Ask the customer for their 6-digit pickup code and enter it below
              to complete the order.
            </DialogDescription>
          </DialogHeader>

          {verifyError && (
            <div className="bg-destructive/10 text-destructive text-sm p-3 rounded-md flex items-center gap-2">
              <AlertCircle className="h-4 w-4 flex-shrink-0" /> {verifyError}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="pickupCodeInput">Pickup Code</Label>
            <Input
              id="pickupCodeInput"
              placeholder="e.g. A8X3K9"
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
              maxLength={6}
              className="font-mono text-lg tracking-widest text-center"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && codeInput.trim() && !verifying) {
                  handleVerify();
                }
              }}
            />
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setPickupModalOpen(false);
                setVerifyError("");
                setCodeInput("");
              }}
              disabled={verifying}
            >
              Cancel
            </Button>
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
              Verify &amp; Complete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
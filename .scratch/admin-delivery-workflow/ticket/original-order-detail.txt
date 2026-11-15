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
  Truck,
  DatabaseZap,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
  PACKING_FAILURE_REASONS,
} from "@/lib/delivery-follow-up-contract";

 const PACKING_FAILURE_REASON_LABELS: Record<string, string> = {
  physical_stock_unavailable: "Stok fisik habis",
  damaged_goods: "Barang rusak",
  paid_service_limits_exceeded: "Melebihi batas layanan yang dibayar",
};

interface OrderItem {
  id: string;
  productName: string;
  variantInfo: string | null;
  price: string;
  quantity: number;
  imageUrl: string | null;
  productId: string;
}

interface StockOperation {
  id: string;
  type: "reserve" | "release" | "reacquire";
  status: string;
  remoteAdjustmentId: number | null;
  attemptCount: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ShipmentLedgerRow {
  state: string;
  awb: string | null;
  trackingUrl: string | null;
  quoteRates: string | null;
  bookedPrice: string | null;
  billedPrice: string | null;
  attemptCount: number;
  dispatchedAt: string | null;
  bookedAt: string | null;
  // Ticket 06 — the handoff stamp + the verified tracking.
  handedOverAt: string | null;
  handedOverBy: string | null;
  latestStatus: string | null;
  latestEventAt: string | null;
  deliveredAt: string | null;
  podUrl: string | null;
}

interface TrackingTimelineRow {
  id: string;
  latestStatus: string | null;
  statusDetail: string | null;
  receivedAt: string;
  providerEventAt: string | null;
  applied: boolean;
  ignoredReason: string | null;
  source: string;
}

interface OrderDetail {
  id: string;
  status: string;
  paymentStatus: string;
  paymentMethod: string | null;
  paymentFailureReason: string | null;
  midtransFailureStatus: string | null;
  pickupCode: string | null;
  jubelioSalesOrderId: number | null;
  jubelioInvoiceId: number | null;
  jubelioPaymentId: number | null;
  fulfillmentBlockedReason: string | null;
  // Ticket 07 — the packing-failure/manual-finish evidence (admin display).
  deliveryFailureCode: string | null;
  deliveryFailureAt: string | null;
  deliveryFailureBy: string | null;
  deliveryManualReason: string | null;
  deliveryManualAt: string | null;
  deliveryManualBy: string | null;
  // Ticket 04/05 — the fulfillment method + the immutable snapshot + the
  // shipment ledger row + the actor-allowed boolean from the server policy.
  fulfillmentMethod: string;
  deliverySnapshot: {
    address: {
      recipientName: string;
      phone: string;
      fullAddress: string;
      province: string;
      city: string;
      district: string;
      area: string;
      postalCode: string;
    };
    service: { courierId: number; serviceId: number; name: string; shippingCost: number | string };
  } | null;
  shipment: ShipmentLedgerRow | null;
  actor?: { allowed: boolean };
  trackingTimeline?: TrackingTimelineRow[];
  pickupDate: string | null;
  pickupTime: string | null;
  contactPhone: string;
  contactEmail: string;
  subtotal: string;
  shippingCost: string;
  discount: string;
  serviceFee: string;
  ppnRate: string;
  ppnAmount: string;
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
  stockOperations: StockOperation[];
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
  const [recheckingOperationId, setRecheckingOperationId] = useState<string | null>(null);
  // Ticket 05 — packing/booking state for DELIVERY orders.
  const [shippingActionPending, setShippingActionPending] = useState(false);
  const [shippingError, setShippingError] = useState<string>("");
  // Ticket 07 — the guided manual-action forms (the reason/reference) state.
  const [shippingFormKind, setShippingFormOpenKind] = useState<
    "packing-failure" | "release-booking" | "finish-manually" | null
  >(null);
  const [shippingReasonInput, setShippingReasonInput] = useState("");
  const [shippingReferenceInput, setShippingReferenceInput] = useState("");

  const isDeliveryOrder = order?.fulfillmentMethod === "delivery";
  const deliveryFailed = !!order?.deliveryFailureCode;
  const canFulfillDelivery =
    !!order &&
    isDeliveryOrder &&
    order.actor?.allowed === true &&
    hasPermission("orders", "edit") &&
    order.paymentStatus === "paid" &&
    order.status === "processing" &&
    !order.fulfillmentBlockedReason &&
    // Ticket 07 — the packing-failure flag blocks the normal CTAs.
    !deliveryFailed;
  const shipmentState = order?.shipment?.state ?? null;
  // Pack once: the CTA is offered for a NEW shipment AND (visible but
  // disabled) for an already-packed shipment; book exactly once (a packed
  // order with no outstanding action); an ambiguous booking NEVER offers an
  // enabled repeat (the UI holds and shows the banner instead).
  const canPackDelivery = canFulfillDelivery && (shipmentState === null || shipmentState === "packed");
  const packLocked = shipmentState === "packed";
  const canBookDelivery =
    canFulfillDelivery && shipmentState === "packed" && !shippingActionPending;
  // Ticket 07 — the packing failure is only markable BEFORE a booking
  // (no ledger yet, or the merely-packed shipment).
  const canMarkPackingFailure =
    canFulfillDelivery && (shipmentState === null || shipmentState === "packed");
  const bookingAmbiguous =
    shipmentState === "booking_unknown" || shipmentState === "booking_dispatched";
  // Manual finish: a known BOOKED order whose tracking shows RETURNED/
  // SHIPMENT_ISSUE, or with the physical handoff recorded; the AWB alone is
  // not evidence; the ambiguous bookings are never the finish surface.
  const canFinishManually =
    canFulfillDelivery &&
    shipmentState === "booked" &&
    (["RETURNED", "SHIPMENT_ISSUE", "PICKED_UP", "ON_DELIVERY"].includes(order?.shipment?.latestStatus ?? "") ||
      !!order?.shipment?.handedOverAt);
  const deliverySnapshot = order?.deliverySnapshot ?? null;
  const shippingFormOpen = shippingFormKind !== null;

  function openShippingForm(kind: "packing-failure" | "release-booking" | "finish-manually") {
    setShippingFormOpenKind(kind);
    setShippingReasonInput("");
    setShippingReferenceInput("");
    setShippingError("");
  }

  async function runShipmentAction(action: "packing" | "book" | "handoff" | "reconcile" | "packing-failure" | "release-booking" | "finish-manually") {
    if (!order) return;
    setShippingActionPending(true);
    setShippingError("");
    try {
      // Ticket 07 — the manual-resolution bodies (the reason is mandatory;
      // the release carries the trusted attestation; the plain actions stay {}).
      const bodies: Record<string, unknown> = {
        packing: {},
        book: {},
        handoff: {},
        reconcile: {},
        "packing-failure": { reasonCode: shippingFormKind === "packing-failure" ? shippingReasonInput : "" },
        "release-booking": {
          proof: {
            source: "jubelio_confirmation",
            reference: shippingReferenceInput.trim(),
            reason: shippingReasonInput.trim(),
            attemptNumber: order.shipment?.attemptCount ?? 0,
            absenceConfirmed: true,
            operationClosed: true,
          },
        },
        "finish-manually": { reason: shippingReasonInput.trim() },
      };
      const res = await fetch(`/api/admin/orders/${orderId}/delivery/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bodies[action] ?? {}),
      });
      const data = (await res.json()) as { success?: boolean; error?: string };
      if (!data.success) {
        setShippingError(data.error || "Gagal memproses pemenuhan pengiriman.");
        return;
      }
      setShippingFormOpenKind(null);
    } catch {
      setShippingError("Gagal memproses pemenuhan pengiriman.");
    } finally {
      setShippingActionPending(false);
      // The ledger/metadata re-reads after packing/booking actions.
      try {
        const fresh = await fetch(`/api/admin/orders/${orderId}`);
        const freshData = await fresh.json();
        if (freshData.success) setOrder(freshData.data);
      } catch {
        // leave the stale view; the next navigation re-reads
      }
    }
  }

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

  const handleStockRecheck = async (operationId: string) => {
    setRecheckingOperationId(operationId);
    try {
      const response = await fetch(`/api/admin/orders/${orderId}/stock-review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operationId }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Recheck failed");
      const refreshed = await fetch(`/api/admin/orders/${orderId}`);
      const refreshedData = await refreshed.json();
      if (refreshedData.success) setOrder(refreshedData.data);
      toast.success("Safe Jubelio reconciliation queued");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Recheck failed");
    } finally {
      setRecheckingOperationId(null);
    }
  };

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

  const statusSteps = order.fulfillmentMethod === "delivery"
    ? STATUS_STEPS.filter((step) => step.key !== "ready_for_pickup")
    : STATUS_STEPS;
  const currentStepIndex = statusSteps.findIndex(
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
          <Badge aria-label="Status pesanan" className={STATUS_BADGES[order.status]}>
            {STATUS_LABELS[order.status] || order.status}
          </Badge>
          <Badge className={PAYMENT_BADGES[order.paymentStatus]}>
            {order.paymentStatus}
          </Badge>
        </div>
      </div>

      {/* Delivery fulfillment panel (ticket 05 — packing + booking; NOT a
          physical handoff: the order stays Processing until ticket 06). */}
      {isDeliveryOrder && (
        <section
          aria-label="Pemenuhan delivery"
          className="rounded-lg border bg-card p-6"
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2 font-semibold">
              <Truck className="h-5 w-5 text-primary" /> Pemenuhan Delivery
            </div>
            <div className="flex gap-2 items-center">
              <button
                type="button"
                className="rounded-full border px-3 py-0.5 text-xs font-medium bg-muted"
              >
                Kirim ke alamat
              </button>
              {shipmentState && (
                <span className="text-xs font-medium text-muted-foreground">
                  {shipmentState === "booked"
                    ? "Sudah di-book"
                    : shipmentState === "packed"
                      ? "Sudah di-pack"
                      : "Booking tidak pasti"}
                </span>
              )}
            </div>
          </div>

          {deliverySnapshot && (
            <div className="grid gap-4 sm:grid-cols-2 mb-3 text-sm">
              <div className="rounded-lg border p-3">
                <div className="text-xs text-muted-foreground mb-1">
                  Tujuan (snapshot kanonis)
                </div>
                <div className="font-medium">
                  {deliverySnapshot.address.recipientName} · {
                    deliverySnapshot.address.phone
                  }
                </div>
                <div className="text-muted-foreground">
                  {deliverySnapshot.address.fullAddress} — {
                    deliverySnapshot.address.province
                  } · {deliverySnapshot.address.city} · {
                    deliverySnapshot.address.district
                  } · {deliverySnapshot.address.area} · Kode Pos {
                    deliverySnapshot.address.postalCode
                  }
                </div>
              </div>
              <div className="rounded-lg border p-3">
                <div className="text-xs text-muted-foreground mb-1">
                  Asal kirim (pengirim = nama cabang)
                </div>
                <div className="font-medium">{order.branch?.name}</div>
                <div className="text-muted-foreground">
                  {deliverySnapshot.service.name}
                </div>
              </div>
            </div>
          )}

          {shippingError && (
            <p className="mb-3 text-sm text-destructive">{shippingError}</p>
          )}

          {canPackDelivery && (
            <Button
              className="gap-2"
              disabled={shippingActionPending || packLocked}
              onClick={() => runShipmentAction("packing")}
            >
              {shippingActionPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <PackageCheck className="h-4 w-4" />
              )}
              Tandai selesai packing
            </Button>
          )}
          {canBookDelivery && (
            <Button
              className="gap-2 ml-2"
              disabled={shippingActionPending}
              onClick={() => runShipmentAction("book")}
            >
              {shippingActionPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <PackageCheck className="h-4 w-4" />
              )}
              Pesan pengiriman
            </Button>
          )}

          {/* Ticket 07 — the manual resolutions. A packing failure is
              markable BEFORE a booking exists; the failure blocks the normal
              CTAs (they require the unflagged state). */}
          {deliveryFailed && (
            <p role="status" className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              Tidak dapat dipenuhi: {PACKING_FAILURE_REASON_LABELS[order.deliveryFailureCode ?? ''] ?? 'Kendala packing'}. Pesanan tetap paid; tindak lanjut dan komunikasi dilakukan staf di luar aplikasi.
            </p>
          )}
          {canMarkPackingFailure && (
            <Button
              variant="outline"
              className="gap-2 mt-3"
              disabled={shippingActionPending}
              onClick={() => openShippingForm("packing-failure")}
            >
              <TriangleAlert className="h-4 w-4" /> Tandai tidak dapat dipenuhi
            </Button>
          )}
          {shippingFormOpen && shippingFormKind === "packing-failure" && (
            <div className="mt-3 space-y-2 rounded-lg border p-4 text-sm">
              <p className="text-xs text-muted-foreground">
                Pilih alasan baku (wajib) — pesanan tetap processing/paid dan
                masuk daftar tindak lanjut.
              </p>
              <div role="listbox" aria-label="Alasan pemenuhan" className="flex flex-wrap gap-2">
                {PACKING_FAILURE_REASONS.map((reasonCode) => (
                  <button
                    key={reasonCode}
                    type="button"
                    role="option"
                    aria-selected={shippingReasonInput === reasonCode}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${
                      shippingReasonInput === reasonCode ? "border-primary bg-primary/5" : "hover:bg-muted/40"
                    }`}
                    onClick={() => setShippingReasonInput(reasonCode)}
                  >
                    {PACKING_FAILURE_REASON_LABELS[reasonCode]}
                  </button>
                ))}
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={shippingActionPending}
                  onClick={() => setShippingFormOpenKind(null)}
                >
                  Batalkan
                </Button>
                <Button
                  size="sm"
                  disabled={shippingActionPending || !shippingReasonInput}
                  onClick={() => runShipmentAction("packing-failure")}
                >
                  Konfirmasi penandai gagal
                </Button>
              </div>
            </div>
          )}

          {bookingAmbiguous && canFulfillDelivery && shipmentState === "booking_unknown" && (
            <div className="mt-3 space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
              <p className="font-medium">
                Booking ambigu — lepaskan hanya dengan konfirmasi Jubelio.
              </p>
              <p className="text-xs">
                Saya telah mengonfirmasi ke Jubelio bahwa operasi pertama
                DITUTUP dan TIDAK ADA booking terbentuk untuk attempt saat ini
                (bukan tebakan dari timeout/404/waktu). Jika belum pasti,
                jangan lepaskan — tahan dan eskalasi di luar aplikasi.
              </p>
              {shippingFormKind === "release-booking" ? (
                <div className="space-y-2">
                  <div>
                    <Label htmlFor="releaseReference">Referensi konfirmasi</Label>
                    <Input
                      id="releaseReference"
                      value={shippingReferenceInput}
                      onChange={(e) => setShippingReferenceInput(e.target.value)}
                      placeholder="cth. JUBELIO-CONF-2026-0001"
                    />
                  </div>
                  <div>
                    <Label htmlFor="releaseReason">Alasan</Label>
                    <Input
                      id="releaseReason"
                      value={shippingReasonInput}
                      onChange={(e) => setShippingReasonInput(e.target.value)}
                      placeholder="Alasan singkat rilis"
                    />
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={shippingActionPending}
                      onClick={() => setShippingFormOpenKind(null)}
                    >
                      Batalkan
                    </Button>
                    <Button
                      size="sm"
                      disabled={
                        shippingActionPending ||
                        !shippingReferenceInput.trim() ||
                        !shippingReasonInput.trim()
                      }
                      onClick={() => runShipmentAction("release-booking")}
                    >
                      Konfirmasi rilis
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  variant="outline"
                  className="gap-2"
                  disabled={shippingActionPending}
                  onClick={() => openShippingForm("release-booking")}
                >
                  Lepas tahanan booking
                </Button>
              )}
            </div>
          )}

          {canFinishManually && (
            <div className="mt-3 space-y-2 rounded-lg border p-4 text-sm">
              <p className="text-xs text-muted-foreground">
                Selesaikan manual dengan alasan wajib (kendala pengiriman atau
                bukti serah-terima); tanpa kode pickup dan tanpa komunikasi
                otomatis.
              </p>
              {shippingFormKind === "finish-manually" ? (
                <div className="space-y-2">
                  <div>
                    <Label htmlFor="manualReason">Alasan</Label>
                    <Input
                      id="manualReason"
                      value={shippingReasonInput}
                      onChange={(e) => setShippingReasonInput(e.target.value)}
                      placeholder="Alasan selesai manual"
                    />
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={shippingActionPending}
                      onClick={() => setShippingFormOpenKind(null)}
                    >
                      Batalkan
                    </Button>
                    <Button
                      size="sm"
                      disabled={shippingActionPending || !shippingReasonInput.trim()}
                      onClick={() => runShipmentAction("finish-manually")}
                    >
                      Konfirmasi selesai manual
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  variant="outline"
                  className="gap-2"
                  disabled={shippingActionPending}
                  onClick={() => openShippingForm("finish-manually")}
                >
                  Selesaikan manual
                </Button>
              )}
            </div>
          )}

          {/* Ambiguity banner: the booking is uncertain — the repeat CTA is
              withheld entirely (no enabled Pesan pengiriman repeat). */}
          {bookingAmbiguous && (
            <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              Status booking tidak pasti (dispatch terkirim tanpa AWB
              terkonfirmasi). Menunggu rekonsiliasi — tidak ada POST ulang.
            </div>
          )}

          {/* Ticket 06 — the physical serah-terima stamp + the reactive
              tracking reconciliation; the badge/stepper stay the same and
              the order is NEVER completed by handoff. */}
          {shipmentState === "booked" && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {order.shipment?.handedOverAt ? (
                <span className="text-sm font-medium text-emerald-700">
                  Serah terima dicatat: {new Date(order.shipment.handedOverAt).toLocaleString("id-ID")}
                </span>
              ) : (
                <Button
                  className="gap-2"
                  disabled={shippingActionPending || !canFulfillDelivery}
                  onClick={() => runShipmentAction("handoff")}
                >
                  {shippingActionPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <PackageCheck className="h-4 w-4" />
                  )}
                  Catat serah-terima
                </Button>
              )}
              {order.shipment?.latestStatus && (
                <span className="rounded-full border bg-muted px-3 py-0.5 text-xs font-medium">
                  Status pengiriman: {order.shipment.latestStatus}
                </span>
              )}
              <Button
                variant="outline"
                className="gap-2 ml-auto"
                disabled={shippingActionPending || !canFulfillDelivery}
                onClick={() => runShipmentAction("reconcile")}
              >
                {shippingActionPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <PackageCheck className="h-4 w-4" />
                )}
                Perbarui tracking
              </Button>
            </div>
          )}

          {/* The applied tracking timeline (orders:view scope) — the ignored
              late receipts stay internal diagnostics with their reason. */}
          {(order.trackingTimeline?.length ?? 0) > 0 && (
            <div className="mt-3 space-y-1 rounded-lg border bg-muted/30 p-3 text-sm">
              {(order.trackingTimeline ?? []).map((event) => (
                <div key={event.id} className="flex gap-2">
                  <span className="font-medium">{
                    event.latestStatus ?? "—"
                  }</span>
                  {event.statusDetail && (
                    <span className="text-muted-foreground">{event.statusDetail}</span>
                  )}
                  {!event.applied && (
                    <span className="text-xs text-amber-700">
                      dilewati ({event.ignoredReason ?? "—"})
                    </span>
                  )}
                  <span className="ml-auto text-xs text-muted-foreground">
                    {event.receivedAt ? new Date(event.receivedAt).toLocaleString("id-ID") : ""}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Booked: the AWB + the THREE cost figures (billed stays unknown
              until ticket 06 verifies the AWB detail — never rendered 0). */}
          {shipmentState === "booked" && order.shipment && (
            <div className="mt-3 space-y-1.5 rounded-lg border bg-muted/30 p-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">No. AWB</span>
                <span className="font-mono font-medium">{order.shipment.awb}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Ongkir Quote (rates)</span>
                <span>Rp {Number(order.shipment.quoteRates ?? 0).toLocaleString("id-ID")}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Harga Booking (price)</span>
                <span>Rp {Number(order.shipment.bookedPrice ?? 0).toLocaleString("id-ID")}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Harga Tagihan</span>
                {order.shipment.billedPrice == null ? (
                  <span className="text-muted-foreground">Belum ada tagihan (menunggu verifikasi)</span>
                ) : (
                  <span>Rp {Number(order.shipment.billedPrice).toLocaleString("id-ID")}</span>
                )}
              </div>
            </div>
          )}
        </section>
      )}

      {/* Status Stepper */}
      {!isCancelled && !isFailedPayment && (
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              {statusSteps.map((step, i) => {
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
                    {i < statusSteps.length - 1 && (
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

      {order.stockOperations.length > 0 && (
        <Card className={
          order.stockOperations.some((operation) => operation.status === "manual_review")
            ? "overflow-hidden border-red-300 bg-red-50/40"
            : "overflow-hidden"
        }>
          <CardContent className="p-0">
            <div className="flex items-center justify-between border-b bg-slate-950 px-5 py-3 text-slate-50">
              <div className="flex items-center gap-2">
                <DatabaseZap className="h-4 w-4 text-amber-400" />
                <span className="text-sm font-semibold tracking-wide">
                  Jubelio stock lifecycle
                </span>
              </div>
              <span className="font-mono text-[11px] text-slate-400">
                {order.stockOperations.length} operation{order.stockOperations.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="divide-y">
              {order.stockOperations.map((operation) => {
                const needsReview = operation.status === "manual_review";
                return (
                  <div key={operation.id} className="grid gap-3 px-5 py-4 md:grid-cols-[1fr_auto]">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs font-bold uppercase tracking-wider">
                          {operation.type}
                        </span>
                        <Badge
                          className={needsReview
                            ? "border-red-300 bg-red-100 text-red-800 hover:bg-red-100"
                            : "border-slate-200 bg-slate-100 text-slate-700 hover:bg-slate-100"}
                        >
                          {needsReview && <TriangleAlert className="mr-1 h-3 w-3" />}
                          {operation.status.replaceAll("_", " ")}
                        </Badge>
                      </div>
                      {operation.lastError && (
                        <p className="mt-2 text-sm text-red-800">{operation.lastError}</p>
                      )}
                      <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                        {operation.id}
                      </p>
                    </div>
                    <div className="text-left text-xs text-muted-foreground md:text-right">
                      <p>Attempts: {operation.attemptCount}</p>
                      <p>
                        Adjustment: {operation.remoteAdjustmentId ?? "not confirmed"}
                      </p>
                      {needsReview && hasPermission("orders", "edit") && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="mt-2 h-8 border-red-300 bg-white text-red-800 hover:bg-red-100"
                          disabled={recheckingOperationId === operation.id}
                          onClick={() => handleStockRecheck(operation.id)}
                        >
                          {recheckingOperationId === operation.id && (
                            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                          )}
                          Recheck safely
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
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
            {order.fulfillmentMethod === "delivery"
              ? "Pesanan delivery siap diproses — booking pengiriman dilakukan staf cabang dari panel pemenuhan di atas."
              : "Order is being prepared. Pickup code will be generated automatically."}
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
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Diskon</span>
              <span>-Rp {parseFloat(order.discount).toLocaleString("id-ID")}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">PPN ({parseFloat(order.ppnRate)}%)</span>
              <span>Rp {parseFloat(order.ppnAmount).toLocaleString("id-ID")}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Ongkos Kirim</span>
              <span>Rp {parseFloat(order.shippingCost).toLocaleString("id-ID")}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Biaya Layanan</span>
              <span>Rp {parseFloat(order.serviceFee).toLocaleString("id-ID")}</span>
            </div>
            <div className="flex justify-between font-bold pt-2 border-t">
              <span>Total Pembayaran</span>
              <span className="text-primary">
                Rp {parseFloat(order.total).toLocaleString("id-ID")}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Jubelio Sales-Order settlement status (remote ids + block reason) */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Status Jubelio (Sales Order)</CardTitle>
          <CardDescription>
            Referensi ID transaksi Jubelio.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex flex-wrap gap-x-8 gap-y-1">
            <span>
              Sales Order ID:{" "}
              <span className="font-mono">{order.jubelioSalesOrderId ?? "—"}</span>
            </span>
            <span>
              Invoice ID:{" "}
              <span className="font-mono">{order.jubelioInvoiceId ?? "—"}</span>
            </span>
            <span>
              Payment ID:{" "}
              <span className="font-mono">{order.jubelioPaymentId ?? "—"}</span>
            </span>
          </div>
          {order.fulfillmentBlockedReason && (
            <div className="rounded-md bg-amber-50 p-3 text-xs text-amber-800 border border-amber-200">
              Pengambilan diblokir: {order.fulfillmentBlockedReason}
            </div>
          )}
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
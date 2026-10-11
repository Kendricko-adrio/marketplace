"use client";
import { useState, useEffect, useRef } from "react";
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
import type { DeliveryAccess, DeliveryStage } from "@/lib/delivery-workflow";

 const PACKING_FAILURE_REASON_LABELS: Record<string, string> = {
  physical_stock_unavailable: "Stok tidak tersedia",
  damaged_goods: "Barang rusak",
  paid_service_limits_exceeded: "Batas layanan terlampaui",
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
  packedAt?: string | null;
  packedBy?: string | null;
  bookedBy?: string | null;
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
  workflow?: { stage: DeliveryStage; access: DeliveryAccess; eligibility: { eligible: boolean; known: boolean; blocker?: string }; tracking?: { reconcile: boolean; handoff: boolean }; special?: { failure: boolean; release: boolean; finish: boolean } };
  trackingTimeline?: TrackingTimelineRow[];
  bookingReviews?: Array<{ attemptNumber: number; reference: string; reason: string; createdAt: string }>;
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
  const { hasPermission, policyStatus, refreshPolicy } = useAuth();

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
  const shippingSubmission = useRef(false);
  const normalOpener = useRef<HTMLButtonElement | null>(null);
  const specialOpener = useRef<HTMLButtonElement | null>(null);
  const [shippingStale, setShippingStale] = useState(false);
  const [normalConfirmation, setNormalConfirmation] = useState<"packing" | "book" | "handoff" | null>(null);
  const [shippingError, setShippingError] = useState<string>("");
  // Ticket 07 — the guided manual-action forms (the reason/reference) state.
  const [shippingFormKind, setShippingFormOpenKind] = useState<
    "packing-failure" | "release-booking" | "finish-manually" | null
  >(null);
  const [shippingReasonInput, setShippingReasonInput] = useState("");
  const [shippingReferenceInput, setShippingReferenceInput] = useState("");
  const [proofAttempt, setProofAttempt] = useState<number | null>(null);
  const [absenceConfirmed, setAbsenceConfirmed] = useState(false);
  const [operationClosed, setOperationClosed] = useState(false);

  const isDeliveryOrder = order?.fulfillmentMethod === "delivery";
  const deliveryFailed = !!order?.deliveryFailureCode;
  const canFulfillDelivery =
    !!order &&
    !shippingStale &&
    !shippingActionPending &&
    isDeliveryOrder &&
    order.workflow?.access.allowed === true &&
    order.workflow?.eligibility.known === true &&
    order.workflow?.eligibility.eligible === true &&
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
  const canPackDelivery = canFulfillDelivery && shipmentState === null;
  const packLocked = shipmentState === "packed";
  const canBookDelivery =
    canFulfillDelivery && shipmentState === "packed" && !shippingActionPending;
  // Ticket 07 — the packing failure is only markable BEFORE a booking
  // (no ledger yet, or the merely-packed shipment).
  const canUseSpecial = !shippingStale && !shippingActionPending && order?.workflow?.eligibility.known === true && order?.workflow?.access.allowed === true && hasPermission("orders", "edit");
  const canMarkPackingFailure = canUseSpecial && order?.workflow?.special?.failure === true;
  const bookingAmbiguous =
    shipmentState === "booking_unknown" || shipmentState === "booking_dispatched";
  // Manual finish: a known BOOKED order whose tracking shows RETURNED/
  // SHIPMENT_ISSUE, or with the physical handoff recorded; the AWB alone is
  // not evidence; the ambiguous bookings are never the finish surface.
  const canFinishManually = canUseSpecial && order?.workflow?.special?.finish === true;
  const deliverySnapshot = order?.deliverySnapshot ?? null;
  const shippingFormOpen = shippingFormKind !== null;

  function openNormalConfirmation(action: "packing" | "book" | "handoff") {
    normalOpener.current = document.activeElement instanceof HTMLButtonElement ? document.activeElement : null;
    setNormalConfirmation(action);
  }
  function restoreDeliveryFocus(opener: HTMLButtonElement | null) {
    if (opener?.isConnected) opener.focus();
    else document.querySelector<HTMLButtonElement>("[data-detail-reload]")?.focus();
  }
  function openShippingForm(kind: "packing-failure" | "release-booking" | "finish-manually") {
    specialOpener.current = document.activeElement instanceof HTMLButtonElement ? document.activeElement : null;
    setShippingFormOpenKind(kind);
    setShippingReasonInput("");
    setShippingReferenceInput("");
    setProofAttempt(order?.shipment?.attemptCount ?? null);
    setAbsenceConfirmed(false);
    setOperationClosed(false);
    setShippingError("");
  }

  async function runShipmentAction(action: "packing" | "book" | "handoff" | "reconcile" | "packing-failure" | "release-booking" | "finish-manually") {
    if (!order || shippingSubmission.current || shippingStale) return;
    shippingSubmission.current = true;
    setShippingStale(true);
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
            attemptNumber: proofAttempt,
            absenceConfirmed,
            operationClosed,
          },
        },
        "finish-manually": { reason: shippingReasonInput.trim() },
      };
      const res = await fetch(`/api/admin/orders/${orderId}/delivery/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bodies[action] ?? {}),
      });
      if (res.status === 401 || res.status === 403) await refreshPolicy();
      const data = (await res.json()) as { success?: boolean; error?: string; code?: string; data?: { status?: string } };
      if (!res.ok || !data.success) {
        setShippingError(data.code === "BOOKING_AMBIGUOUS" ? "Hasil booking belum pasti. Jangan pesan ulang." : res.status === 409 ? "Kondisi order telah berubah. Muat ulang detail sebelum melanjutkan." : "Hasil tindakan belum dapat dipastikan. Muat ulang detail sebelum melanjutkan.");
      } else {
        setShippingFormOpenKind(null);
        setNormalConfirmation(null);
        const results: Record<string, string> = { packing: "Barang ditandai siap.", book: "Pengiriman berhasil dipesan.", handoff: "Serah terima dicatat.", "packing-failure": "Kendala barang dicatat.", "release-booking": "Tahanan booking dilepas.", "finish-manually": "Order ditutup manual." };
        if (results[action] && (action !== "book" || data.data?.status === "booked")) toast.success(results[action]);
      }
    } catch {
      setShippingError(action === "book" ? "Hasil booking belum pasti. Jangan pesan ulang." : "Hasil tindakan belum dapat dipastikan. Muat ulang detail sebelum melanjutkan.");
    } finally {
      setNormalConfirmation(null);
      setShippingFormOpenKind(null);
      try {
        const fresh = await fetch(`/api/admin/orders/${orderId}`);
        const freshData = await fresh.json();
        if (!fresh.ok || !freshData.success) throw new Error("reload");
        setOrder(freshData.data);
        setShippingStale(false);
      } catch {
        setShippingError("Detail belum berhasil diperbarui. Muat ulang detail untuk memastikan hasil.");
      }
      shippingSubmission.current = false;
      setShippingActionPending(false);
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

  useEffect(() => {
    if (order && window.location.hash === "#special-handling") {
      const section = document.getElementById("special-handling");
      if (section instanceof HTMLDetailsElement) section.open = true;
    }
  }, [order]);

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

  if (policyStatus !== "ready" || !hasPermission("orders", "view")) return null;

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
    <div className="min-w-0 space-y-5 max-w-5xl break-words">
      {/* Back link */}
      <Button
        variant="ghost"
        size="sm"
        className="gap-1"
        onClick={() => {
          const previous = new URLSearchParams(window.location.search).get("returnTo");
          router.push(previous && /^\/admin\/orders(?:\/follow-up)?(?:\?|$)/.test(previous) ? previous : "/admin/orders");
        }}
      >
        <ArrowLeft className="h-4 w-4" /> Back to Orders
      </Button>

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
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
          {isDeliveryOrder && order.workflow && <Badge className="border-teal-200 bg-teal-50 text-teal-900">{order.workflow.stage.label}</Badge>}
          <Badge aria-label="Status pesanan" className={STATUS_BADGES[order.status]}>
            {STATUS_LABELS[order.status] || order.status}
          </Badge>
          <Badge className={PAYMENT_BADGES[order.paymentStatus]}>
            {order.paymentStatus}
          </Badge>
        </div>
      </div>

      {isDeliveryOrder && (
        <section aria-label="Langkah berikutnya" className="rounded-lg border border-teal-200 bg-teal-50/60 p-4 text-sm text-slate-900">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-teal-800">Langkah berikutnya</h3>
              <p className="font-semibold">{order.workflow?.stage.guidance}</p>
              {order.workflow?.stage.label === "Siapkan barang" && <p>Periksa barang, jumlah, kondisi, dan kemasan sesuai layanan yang dipilih.</p>}
              {order.workflow?.stage.label === "Verifikasi tertunda" && <p>Barang belum dapat diproses karena verifikasi transaksi Jubelio belum selesai. Koordinasikan dengan Jubelio support; jangan meminta pembayaran ulang hanya karena blocker ini. Pemulihan dilakukan sistem, bukan verifikasi manual oleh admin.</p>}
              {order.deliveryFailureCode && <p>Kendala ini memblokir proses pemenuhan berikutnya. Koordinasikan penyelesaian bisnis dan komunikasi pelanggan bersama staff cabang di luar aplikasi.</p>}
              {shipmentState === "booking_unknown" && <p>Booking mungkin sudah terbentuk. Memesan ulang dapat membuat pengiriman ganda. Konfirmasi ke Jubelio apakah booking terbentuk dan operasi awal sudah ditutup. Jika belum pasti atau booking ada, tetap tahan; koordinasikan di luar aplikasi.</p>}
              {shipmentState === "booking_dispatched" && <p>Permintaan sudah dikirim; hasilnya belum tercatat. Koordinasikan dengan Jubelio support. Tidak ada retry, pelepasan, atau pemulihan otomatis berdasarkan waktu tunggu.</p>}
              {!order.workflow?.stage.terminal && order.shipment?.latestStatus === "CANCELED" && <p>Pembatalan pengiriman bukan pembatalan order. Konfirmasi ke kurir dan koordinasikan penyelesaian bisnis di luar aplikasi.</p>}
              {order.workflow?.stage.label === "Selesai manual" && <p>Penutupan manual bukan konfirmasi barang diterima pelanggan.</p>}
              {order.workflow?.access.reasons.map((reason) => <p key={reason}>{reason}</p>)}
              {order.workflow?.eligibility.blocker && !order.workflow.stage.terminal && <p>{order.workflow.eligibility.blocker}</p>}
              {(shippingStale || !order.workflow || !order.workflow.eligibility.known) && <p>Kelayakan tindakan belum dapat dipastikan. Muat ulang detail sebelum melanjutkan.</p>}
            </div>
            <Button data-detail-reload variant="outline" disabled={shippingActionPending} onClick={async () => {
              try {
                const response = await fetch(`/api/admin/orders/${orderId}`);
                if (response.status === 401 || response.status === 403) await refreshPolicy();
                const body = await response.json();
                if (!response.ok || !body.success) throw new Error("reload");
                setOrder(body.data);
                setShippingStale(false);
                setShippingError("");
              } catch {
                setShippingStale(true);
                setOrder((current) => current ? { ...current, workflow: current.workflow ? { ...current.workflow, eligibility: { known: false, eligible: false } } : undefined } : null);
                setShippingError("Detail belum berhasil diperbarui. Muat ulang detail untuk memastikan hasil.");
              }
            }}>Muat ulang detail</Button>
          </div>
        </section>
      )}

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
                      : order.workflow?.stage.label ?? "Kelayakan belum tersedia"}
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
              onClick={() => openNormalConfirmation("packing")}
            >
              {shippingActionPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <PackageCheck className="h-4 w-4" />
              )}
              Tandai siap
            </Button>
          )}
          {canBookDelivery && (
            <Button
              className="gap-2 ml-2"
              disabled={shippingActionPending}
              onClick={() => openNormalConfirmation("book")}
            >
              {shippingActionPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <PackageCheck className="h-4 w-4" />
              )}
              Pesan pengiriman
            </Button>
          )}

          <details id="special-handling" className="mt-4 rounded-lg border p-3"><summary className="cursor-pointer font-semibold">Penanganan khusus</summary>
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
              <TriangleAlert className="h-4 w-4" /> Laporkan kendala barang
            </Button>
          )}
          {shippingFormOpen && shippingFormKind === "packing-failure" && (
            <Dialog open onOpenChange={(open) => { if (!open && !shippingActionPending) setShippingFormOpenKind(null); }}><DialogContent className="max-h-[90vh] overflow-y-auto" onCloseAutoFocus={(event) => { event.preventDefault(); restoreDeliveryFocus(specialOpener.current); }}><DialogHeader><DialogTitle>Laporkan kendala barang?</DialogTitle><DialogDescription>Alasan baku dan konsekuensi pemenuhan.</DialogDescription></DialogHeader>
            <div className="space-y-2 text-sm">
              <p className="text-xs text-muted-foreground">
                Laporkan kendala barang? Pilih alasan baku (wajib).
              </p>
              <p>Kendala ini memblokir proses pemenuhan berikutnya.</p><p>Order tetap dalam proses dan pembayaran tetap lunas.</p><p>Tindakan ini tidak melakukan refund, membatalkan SO, mengembalikan stok, atau mengirim komunikasi otomatis. Koordinasikan penyelesaian dan komunikasi pelanggan bersama staff cabang di luar aplikasi.</p>
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
                  Laporkan kendala
                </Button>
              </div>
            </div>
            </DialogContent></Dialog>
          )}

          {canUseSpecial && order.workflow?.special?.release && shipmentState === "booking_unknown" && (
            <div className="mt-3 space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
              <p className="font-medium">Booking belum pasti — lepaskan hanya dengan konfirmasi Jubelio.</p>
              <p>Percobaan: {order.shipment?.attemptCount ?? "Belum tersedia"} · Dikirim: {order.shipment?.dispatchedAt ? new Date(order.shipment.dispatchedAt).toLocaleString("id-ID") : "Belum tercatat"}</p>
              <p className="text-xs">
                Saya telah mengonfirmasi ke Jubelio bahwa operasi pertama
                DITUTUP dan TIDAK ADA booking terbentuk untuk attempt saat ini
                (bukan tebakan dari timeout/404/waktu). Jika belum pasti,
                jangan lepaskan — tahan dan eskalasi di luar aplikasi.
              </p>
              {shippingFormKind === "release-booking" ? (
                <Dialog open onOpenChange={(open) => { if (!open && !shippingActionPending) setShippingFormOpenKind(null); }}><DialogContent className="max-h-[90vh] overflow-y-auto" onCloseAutoFocus={(event) => { event.preventDefault(); restoreDeliveryFocus(specialOpener.current); }}><DialogHeader><DialogTitle>Lepas tahanan booking?</DialogTitle><DialogDescription>Bukti untuk percobaan saat ini, bukan izin booking otomatis.</DialogDescription></DialogHeader><div className="space-y-2 text-sm">
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
                    <Label htmlFor="releaseReason">Alasan / ringkasan konfirmasi</Label>
                    <Input
                      id="releaseReason"
                      value={shippingReasonInput}
                      onChange={(e) => setShippingReasonInput(e.target.value)}
                      placeholder="Alasan singkat rilis"
                    />
                  </div>
                  <p>Order: {order.id} · Percobaan bukti: {proofAttempt ?? "Belum tersedia"} · Sumber bukti: Konfirmasi Jubelio</p>
                  <label className="flex items-start gap-2"><input type="checkbox" checked={absenceConfirmed} onChange={(event) => setAbsenceConfirmed(event.target.checked)} />Jubelio mengonfirmasi booking tidak terbentuk untuk percobaan ini.</label>
                  <label className="flex items-start gap-2"><input type="checkbox" checked={operationClosed} onChange={(event) => setOperationClosed(event.target.checked)} />Jubelio mengonfirmasi operasi permintaan awal untuk percobaan ini sudah ditutup.</label>
                  <p>Timeout, 404, hasil pencarian kosong, dan waktu tunggu bukan bukti bahwa booking tidak terbentuk. Jika belum ada kepastian, jangan lepaskan tahanan.</p>
                  <p>Tindakan ini mencatat bukti dan mengembalikan pengiriman ke tahap Barang siap. Tidak memesan pengiriman baru. Booking berikutnya memerlukan review dan persetujuan terpisah.</p>
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
                        !shippingReasonInput.trim() || !absenceConfirmed || !operationClosed || proofAttempt !== order.shipment?.attemptCount
                      }
                      onClick={() => runShipmentAction("release-booking")}
                    >
                      Konfirmasi rilis
                    </Button>
                  </div>
                </div></DialogContent></Dialog>
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
                <Dialog open onOpenChange={(open) => { if (!open && !shippingActionPending) setShippingFormOpenKind(null); }}><DialogContent className="max-h-[90vh] overflow-y-auto" onCloseAutoFocus={(event) => { event.preventDefault(); restoreDeliveryFocus(specialOpener.current); }}><DialogHeader><DialogTitle>Selesaikan order secara manual?</DialogTitle><DialogDescription>Penutupan khusus, bukan bukti penerimaan pelanggan.</DialogDescription></DialogHeader><div className="space-y-2 text-sm">
                  <h3 className="font-semibold">Selesaikan order secara manual?</h3><p>Order: {order.id} · Resi: {order.shipment?.awb ?? "Belum tersedia"}</p><p>Bukti saat ini: {order.shipment?.latestStatus ?? "Belum tersedia"} · Serah terima: {order.shipment?.handedOverAt ? new Date(order.shipment.handedOverAt).toLocaleString("id-ID") : "Belum tercatat"}</p>
                  <p>Order akan ditutup dengan hasil Selesai manual. Pembayaran tetap lunas.</p>
                  <ul className="list-disc space-y-1 pl-5"><li>Tidak mengonfirmasi barang diterima pelanggan dan tidak membuat status DELIVERED atau bukti penerimaan.</li><li>Tidak melakukan refund.</li><li>Tidak menyesuaikan stok.</li><li>Tidak membatalkan Sales Order (SO).</li><li>Tidak mengirim komunikasi otomatis.</li></ul>
                  <p>Penyelesaian bisnis dan komunikasi pelanggan, jika masih diperlukan, tetap dilakukan di luar aplikasi.</p>
                  <div>
                    <Label htmlFor="manualReason">Alasan penutupan</Label>
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
                </div></DialogContent></Dialog>
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

          {order.deliveryManualReason && <p className="mt-3 text-sm">Alasan penutupan manual: {order.deliveryManualReason} · Actor: {order.deliveryManualBy ?? "Belum tersedia"} · Waktu: {order.deliveryManualAt ? new Date(order.deliveryManualAt).toLocaleString("id-ID") : "Belum tercatat"}</p>}
          {(order.bookingReviews ?? []).map((review) => <p key={`${review.attemptNumber}-${review.reference}`} className="mt-3 text-sm">Bukti Jubelio disimpan · Percobaan {review.attemptNumber} · Referensi {review.reference} · {review.reason} · Waktu disimpan: {new Date(review.createdAt).toLocaleString("id-ID")}</p>)}
          </details>
          {/* Ambiguity banner: the booking is uncertain — the repeat CTA is
              withheld entirely (no enabled Pesan pengiriman repeat). */}
          {bookingAmbiguous && (
            <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              {order.workflow?.stage.guidance} Tidak ada POST ulang.
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
              ) : canUseSpecial && order.workflow?.tracking?.handoff && !["PICKED_UP", "ON_DELIVERY", "DELIVERED", "ON_HOLD", "RETURNED", "CANCELED", "SHIPMENT_ISSUE"].includes(order.shipment?.latestStatus ?? "") ? (
                <Button
                  className="gap-2"
                  disabled={shippingActionPending}
                  onClick={() => openNormalConfirmation("handoff")}
                >
                  {shippingActionPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <PackageCheck className="h-4 w-4" />
                  )}
                  Catat serah terima
                </Button>
              ) : null}
              {order.shipment?.latestStatus && (
                <span className="rounded-full border bg-muted px-3 py-0.5 text-xs font-medium">
                  Status pengiriman: {order.shipment.latestStatus}
                </span>
              )}
              {canUseSpecial && order.workflow?.tracking?.reconcile && <Button
                variant="outline"
                className="gap-2 ml-auto"
                disabled={shippingActionPending}
                onClick={() => runShipmentAction("reconcile")}
              >
                {shippingActionPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <PackageCheck className="h-4 w-4" />
                )}
                Perbarui tracking
              </Button>}
            </div>
          )}

          {/* The applied tracking timeline (orders:view scope) — the ignored
              late receipts stay internal diagnostics with their reason. */}
          <section aria-label="Activity delivery" className="mt-3 space-y-2 rounded-lg border bg-muted/30 p-3 text-sm">
            <h3 className="font-semibold">Activity delivery</h3>
            {[
              { label: "Barang siap", at: order.shipment?.packedAt, actor: order.shipment?.packedBy },
              { label: "Booking dicatat", at: order.shipment?.bookedAt, actor: order.shipment?.bookedBy },
              { label: "Serah terima manual", at: order.shipment?.handedOverAt, actor: order.shipment?.handedOverBy },
              { label: "Kendala barang dicatat", at: order.deliveryFailureAt, actor: order.deliveryFailureBy },
              { label: "Order ditutup manual", at: order.deliveryManualAt, actor: order.deliveryManualBy },
            ].filter((fact) => fact.at).map((fact) => <p key={fact.label}>{fact.label} · Sumber: Admin · Actor: {fact.actor ?? "Belum tersedia"} · Waktu tercatat: {new Date(fact.at!).toLocaleString("id-ID")}</p>)}
            <p>Serah terima manual: {order.shipment?.handedOverAt ? new Date(order.shipment.handedOverAt).toLocaleString("id-ID") : "Belum tercatat"}</p>
            {(order.trackingTimeline ?? []).filter((event) => event.applied).map((event) => (
                <div key={event.id} className="flex flex-wrap gap-2">
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
                  <div className="text-xs text-muted-foreground">Sumber: Kurir ({event.source})<p>Waktu kejadian: {event.providerEventAt ? new Date(event.providerEventAt).toLocaleString("id-ID") : "Belum tersedia"}</p><p>Update diterima sistem: {event.receivedAt ? new Date(event.receivedAt).toLocaleString("id-ID") : "Belum tersedia"}</p></div>
                </div>
              ))}
          </section>
          <details className="mt-3 rounded-lg border p-3 text-sm"><summary className="cursor-pointer font-medium">Diagnostik tracking</summary>{(order.trackingTimeline ?? []).filter((event) => !event.applied).map((event) => <p key={event.id}>Receipt diabaikan · {event.ignoredReason ?? "Belum tersedia"} · Diterima: {event.receivedAt ? new Date(event.receivedAt).toLocaleString("id-ID") : "Belum tersedia"}</p>)}</details>

          {/* Booked: the AWB + the THREE cost figures (billed stays unknown
              until ticket 06 verifies the AWB detail — never rendered 0). */}
          <section aria-label="Resi dan tracking" className="mt-3 space-y-2 rounded-lg border p-3 text-sm">
            <h3 className="font-semibold">Resi dan tracking</h3><p>No. AWB: <span className="font-mono font-medium">{order.shipment?.awb ?? "Belum tersedia"}</span></p>
            <p>Tracking: {order.shipment?.trackingUrl && /^https?:\/\//i.test(order.shipment.trackingUrl) ? <a className="text-teal-800 underline" href={order.shipment.trackingUrl} target="_blank" rel="noopener noreferrer">Lihat tracking kurir</a> : "Belum tersedia"}</p>
            <p>Bukti penerimaan: {order.shipment?.podUrl && /^https?:\/\//i.test(order.shipment.podUrl) ? <a className="text-teal-800 underline" href={order.shipment.podUrl} target="_blank" rel="noopener noreferrer">Lihat bukti penerimaan</a> : "Belum tersedia"}</p>
          </section>
          <section aria-label="Keuangan pengiriman" className="mt-3 space-y-2 rounded-lg border bg-muted/30 p-3 text-sm">
            <h3 className="font-semibold">Keuangan pengiriman</h3>
            <div className="flex flex-wrap justify-between gap-2"><span>Ongkir checkout</span><span>Rp {Number(order.shippingCost).toLocaleString("id-ID")}</span></div>
            <div className="flex flex-wrap justify-between gap-2"><span>Biaya booking</span><span>{order.shipment?.bookedPrice == null ? "Belum tersedia" : `Rp ${Number(order.shipment.bookedPrice).toLocaleString("id-ID")}`}</span></div>
            <div className="flex flex-wrap justify-between gap-2"><span>Tagihan courier</span><span>{order.shipment?.billedPrice == null ? "Belum ada tagihan" : `Rp ${Number(order.shipment.billedPrice).toLocaleString("id-ID")}`}</span></div>
            <details><summary className="cursor-pointer font-medium">Rincian selisih</summary><p>Selisih biaya tidak menambah pembayaran pelanggan dan tidak memblokir pemenuhan.</p>{order.shipment?.bookedPrice != null && <p>Selisih booking terhadap checkout: Rp {(Number(order.shipment.bookedPrice) - Number(order.shippingCost)).toLocaleString("id-ID")}</p>}{order.shipment?.billedPrice != null && <p>Selisih tagihan terhadap checkout: Rp {(Number(order.shipment.billedPrice) - Number(order.shippingCost)).toLocaleString("id-ID")}</p>}</details>
          </section>
        </section>
      )}

      {/* Status Stepper */}
      {!isDeliveryOrder && !isCancelled && !isFailedPayment && (
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
        <details open={!isDeliveryOrder} className="rounded-lg border p-3"><summary className="cursor-pointer font-medium">Diagnostik stok Jubelio</summary>
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
                      {operation.lastError && !isDeliveryOrder && (
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
                      {needsReview && hasPermission("orders", "edit") && (!isDeliveryOrder || canFulfillDelivery) && (
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
        </Card></details>
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
      {!isDeliveryOrder && order.status === "processing" && (
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
            <h3 className="font-semibold mb-4">{isDeliveryOrder ? "Asal kirim" : "Pickup Location"}</h3>
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
      <details open={!isDeliveryOrder} className="rounded-lg border p-3"><summary className="cursor-pointer font-medium">Diagnostik transaksi Jubelio</summary><Card>
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
      </Card></details>

      <Dialog open={normalConfirmation !== null} onOpenChange={(open) => { if (!open && !shippingActionPending) setNormalConfirmation(null); }}>
        <DialogContent className={normalConfirmation === "book" ? "max-h-[90vh] w-[calc(100%-2rem)] overflow-y-auto rounded-xl sm:max-w-xl" : "max-h-[90vh] overflow-y-auto sm:max-w-lg"} onCloseAutoFocus={(event) => { event.preventDefault(); restoreDeliveryFocus(normalOpener.current); }}>
          <DialogHeader><DialogTitle>{normalConfirmation === "packing" ? "Tandai barang siap?" : normalConfirmation === "handoff" ? "Catat serah terima?" : "Pesan pengiriman?"}</DialogTitle><DialogDescription>{normalConfirmation === "packing" ? "Pastikan barang, jumlah, kondisi, dan kemasan sudah diperiksa sesuai layanan yang dipilih." : normalConfirmation === "handoff" ? "Konfirmasi serah terima fisik kepada kurir." : "Data mengikuti order saat checkout."}</DialogDescription></DialogHeader>
          {normalConfirmation === "packing" ? <p className="text-sm">Tindakan ini mencatat barang siap. Pengiriman belum dipesan.</p> : normalConfirmation === "handoff" ? <div className="space-y-3 text-sm"><p>Kurir / service: {deliverySnapshot?.service.name ?? "Belum tersedia"}</p><p>Resi: {order.shipment?.awb ?? "Belum tersedia"}</p><p>Lakukan hanya setelah barang benar-benar Anda serahkan kepada kurir.</p><p>Ini bukan bukti barang diterima pelanggan.</p></div> : <div className="space-y-3 text-sm">
            <section aria-labelledby="booking-goods-title" className="overflow-hidden rounded-lg border">
              <h3 id="booking-goods-title" className="flex items-center gap-2 border-b bg-muted/50 px-4 py-2.5 font-semibold">
                <Package className="h-4 w-4 text-muted-foreground" aria-hidden="true" /> Barang
              </h3>
              <ul className="divide-y px-4">
                {order.items.map((item) => (
                  <li key={item.id} className="flex items-start justify-between gap-3 py-3">
                    <div className="min-w-0 break-words">
                      <p className="font-medium leading-5">{item.productName}</p>
                      {item.variantInfo && <p className="mt-1 text-xs text-muted-foreground">{item.variantInfo}</p>}
                    </div>
                    <span className="shrink-0 rounded-md bg-muted px-2 py-1 text-xs font-medium tabular-nums">Jumlah {item.quantity}</span>
                  </li>
                ))}
              </ul>
            </section>

            <section aria-labelledby="booking-destination-title" className="overflow-hidden rounded-lg border">
              <h3 id="booking-destination-title" className="flex items-center gap-2 border-b bg-muted/50 px-4 py-2.5 font-semibold">
                <MapPin className="h-4 w-4 text-muted-foreground" aria-hidden="true" /> Tujuan pengiriman
              </h3>
              <div className="space-y-2 break-words px-4 py-3">
                <p className="font-medium">{deliverySnapshot?.address.recipientName}</p>
                <p className="flex items-center gap-2 text-muted-foreground">
                  <Phone className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> {deliverySnapshot?.address.phone}
                </p>
                <div className="border-t pt-2 leading-relaxed">
                  <p>{deliverySnapshot?.address.fullAddress}</p>
                  <p className="text-muted-foreground">{deliverySnapshot?.address.province} · {deliverySnapshot?.address.city} · {deliverySnapshot?.address.district} · {deliverySnapshot?.address.area}</p>
                  <p className="text-muted-foreground">Kode pos {deliverySnapshot?.address.postalCode}</p>
                </div>
              </div>
            </section>

            <section aria-label="Layanan pengiriman" className="rounded-lg border bg-muted/30 px-4 py-3">
              <dl className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                <div className="min-w-0">
                  <dt className="flex items-center gap-2 text-xs text-muted-foreground"><Truck className="h-4 w-4" aria-hidden="true" /> Kurir / service</dt>
                  <dd className="mt-1.5 break-words font-medium">{deliverySnapshot?.service.name ?? "Belum tersedia"}</dd>
                </div>
                <div className="border-t pt-3 sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0 sm:text-right">
                  <dt className="text-xs text-muted-foreground">Ongkir checkout</dt>
                  <dd className="mt-1 text-lg font-semibold tabular-nums">Rp {Number(order.shippingCost).toLocaleString("id-ID")}</dd>
                </div>
              </dl>
            </section>

            <div role="note" aria-labelledby="booking-caution-title" className="flex gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
              <div className="min-w-0">
                <h3 id="booking-caution-title" className="font-semibold">Sebelum memesan</h3>
                <p className="mt-1 text-xs leading-relaxed">Konfirmasi mengirim permintaan booking ke provider.</p>
                <ul className="mt-2 list-disc space-y-1 pl-4 text-xs leading-relaxed">
                  <li>Booking belum berarti barang diserahkan ke kurir.</li>
                  <li>Jika hasil belum pasti, jangan pesan ulang.</li>
                </ul>
              </div>
            </div>
          </div>}
          <DialogFooter className={normalConfirmation === "book" ? "gap-2 border-t pt-4 sm:gap-0" : undefined}><Button variant="outline" disabled={shippingActionPending} onClick={() => setNormalConfirmation(null)}>Batal</Button><Button disabled={shippingActionPending || shippingStale} onClick={() => normalConfirmation && runShipmentAction(normalConfirmation)}>{shippingActionPending ? "Memproses…" : normalConfirmation === "packing" ? "Tandai siap" : normalConfirmation === "handoff" ? "Barang sudah diserahkan" : "Pesan pengiriman"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

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
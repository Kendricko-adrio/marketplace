"use client";
import { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { InfoHint } from "@/components/ui/info-hint";
import { ReadOnlyInput } from "@/components/ui/read-only-input";
import { getStatusToneClassName } from "@marketplace/ui/src/lib/status-styles";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  Clock,
  CreditCard,
  Loader2,
  MapPin,
  Calendar,
} from "lucide-react";
import { useSession } from "@/lib/auth-client";
import { useCart } from "@/providers/cart-provider";
import DeliveryQuotePanel, { type DeliveryAddressPreview } from "@/components/checkout/DeliveryQuotePanel";
import { CheckoutAttemptFeedback, type CheckoutCheckState } from "@/components/checkout/CheckoutAttemptFeedback";
import { CheckoutTaxFeedback } from "@/components/checkout/CheckoutTaxFeedback";
import type { CheckoutAttemptResult } from "@/features/checkout/checkout-attempt";
import { PromoSelector, type AvailableOffer, type PromoInvalidation } from "@/components/checkout/PromoSelector";
import { PromoSelectionDialog } from "@/components/checkout/PromoSelectionDialog";
import type { PromoCandidateResult, PromoDraft, PromoPageResult } from "@/features/discounts/promo-picker-contract";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { DeliveryQuoteService } from "@/lib/delivery-quote";
import { formatDeliveryEta } from "@/lib/delivery-options";
import {
  getDayHours,
  generateTimeSlots,
  formatDateLabel,
} from "@/lib/pickup-validation";
import type { OperatingHours } from "@/db";
import { calculateOrderPricing } from "@/lib/order-pricing";

// ===== Types =====
interface CartItem {
  id: string;
  quantity: number;
  variantId: string;
  branchId: string | null;
  variant: {
    id: string;
    color: string | null;
    size: string | null;
    price: string;
  };
  product: { id: string; name: string };
  image: string | null;
  branch: {
    id: string;
    name: string;
    city: string;
  } | null;
}

interface CartData {
  id: string;
  items: CartItem[];
  itemCount: number;
  subtotal: number;
  ppnRatePercent: number;
  pricingContractVersion: 0 | 1;
}

interface PendingCheckout {
  requestKey: string;
  body: Record<string, unknown>;
}

/**
 * Body checkout versi lama membawa tujuan inline (`newAddress`) + save-intent.
 * Kontrak baru hanya menerima `addressId`, jadi body seperti itu tidak pernah
 * dikirim ulang: ia hanya boleh dibaca (lookup) lalu diganti pilihan eksplisit.
 */
function legacyIntentInBody(body: Record<string, unknown> | null | undefined): boolean {
  return Boolean(body && ("newAddress" in body || "saveAddress" in body || "saveRequestId" in body));
}
interface CheckoutPricing extends ReturnType<typeof calculateOrderPricing> {
  /** Additive Markdown snapshot fields from the versioned preview. */
  sourceGoodsSubtotal?: string;
  markdownTotal?: string;
  /** Ongkir customer sebelum subsidi dan subsidi merchant (ticket 11). */
  shippingBeforeSubsidy?: string;
  shippingSubsidy?: string;
}

interface CheckoutReview {
  reviewToken: string;
  expiresAt: string;
  pricing: CheckoutPricing;
  intent: Record<string, unknown>;
  /** Fingerprint kandidat yang ditandatangani token; ack mengikat nilai ini. */
  contextFingerprint: string;
  promo: PromoIdentity;
  requiresIncreaseAcknowledgement: boolean;
  requiresContinueWithoutPromoAcknowledgement: boolean;
}

/** Pilihan yang dikirim ke preview/place: manual masih membawa literal kode. */
type PromoSelection =
  | { kind: "none" }
  | { kind: "public"; offerId: string }
  | { kind: "manual"; code: string };

/** Identitas pilihan tersimpan (token/previous): manual membawa codeId. */
type StoredPromoSelection =
  | { kind: "none" }
  | { kind: "public"; offerId: string }
  | { kind: "manual"; offerId: string; codeId: string };

interface PromoIdentity {
  kind: "none" | "public" | "manual";
  offerId?: string;
  codeId?: string;
  revisionId?: string;
  benefitId?: string;
  benefitAmount?: string;
}

interface AppliedManualCode {
  code: string;
  offerId: string;
  codeId: string;
}

/** Bentuk response preview penggantian (ticket 08). */
interface PromoReplacementView {
  previous: {
    status: "valid" | "invalid";
    promo: PromoSelection;
    total: string | null;
    reason?: string;
    message?: string;
  };
  candidate: { promo: PromoSelection; total: string };
  direction: "increase" | "same" | "decrease" | null;
  deltaTotal: string | null;
  requiresIncreaseConfirmation: boolean;
}

interface CheckoutPreviewData {
  pricing: CheckoutPricing;
  promo?: PromoIdentity;
  reviewToken: string;
  expiresAt: string;
  contextFingerprint: string;
  requiresIncreaseConfirmation?: boolean;
  requiresContinueWithoutPromoAcknowledgement?: boolean;
  replacement?: PromoReplacementView | null;
  deliveryService?: DeliveryQuoteService;
}

interface StockAdjustmentResponse {
  code?: string;
  error?: string;
  adjustments?: {
    cartItemId: string;
    availableQuantity: number;
  }[];
}

interface BranchWithHours {
  id: string;
  name: string;
  city: string;
  address: string;
  operatingHours: OperatingHours;
}

/** Error per field step 1 pickup; kunci kecil dan hanya untuk field wajib. */
type PickupFieldErrors = Partial<
  Record<"date" | "time" | "phone" | "email", string>
>;

/**
 * Penolakan slot dari server dipetakan ke field + bahasa Indonesia. Pesan
 * jaringan/asing tidak pernah tampil mentah ke customer.
 */
/**
 * Sidik jari field attempt yang ditampilkan. Perubahan requestId/attemptId saja
 * bukan perubahan status bagi customer, jadi tidak boleh memunculkan pesan
 * "diperbarui" palsu.
 */
function attemptSignature(attempt: CheckoutAttemptResult): string {
  return JSON.stringify([
    attempt.state,
    attempt.orderId,
    attempt.paymentAvailable,
    attempt.retryAllowed,
    attempt.message,
  ]);
}

function mapPickupSlotError(raw: string | undefined): {
  field: "date" | "time";
  message: string;
} {
  const range = raw?.match(/^Pickup time must be between (\d{2}:\d{2}) and (\d{2}:\d{2})/);
  if (range) {
    return {
      field: "time",
      message: `Waktu pickup harus antara ${range[1]} dan ${range[2]}.`,
    };
  }
  switch (raw) {
    case "Pickup date is required.":
      return { field: "date", message: "Pilih tanggal pickup." };
    case "Pickup time is required.":
      return { field: "time", message: "Pilih jam pickup." };
    case "Invalid pickup date.":
      return { field: "date", message: "Tanggal pickup tidak valid. Pilih tanggal lain." };
    case "Invalid pickup time.":
      return { field: "time", message: "Jam pickup tidak valid. Pilih jam lain." };
    case "Pickup date cannot be in the past.":
      return { field: "date", message: "Tanggal pickup sudah lewat. Pilih tanggal lain." };
    case "Pickup date and time must be in the future.":
      return { field: "time", message: "Tanggal dan jam pickup harus di masa depan." };
    case "Branch is closed on the selected day.":
      return { field: "date", message: "Cabang tutup pada tanggal ini. Pilih tanggal lain." };
    case "Branch is not available":
      return { field: "date", message: "Cabang ini belum tersedia untuk pickup." };
    default:
      return {
        field: "time",
        message: "Slot pickup belum dapat diverifikasi. Coba lagi.",
      };
  }
}

export default function CheckoutPage() {
  const router = useRouter();
  const { data: session, isPending: sessionPending } = useSession();
  const { refreshCart } = useCart();

  // ===== State =====
  const [cart, setCart] = useState<CartData | null>(null);
  const [branch, setBranch] = useState<BranchWithHours | null>(null);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState<1 | 2>(1);
  const [submitting, setSubmitting] = useState(false);
  const [stockAdjustmentMessage, setStockAdjustmentMessage] = useState<string | null>(null);

  // Selected item IDs — passed from the cart page via sessionStorage.
  // The cart page enforces single-branch selection before navigating here.
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(
    new Set()
  );

  // Step 2 — Contact
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  // Delivery tetap memakai satu pesan kontak; pickup memakai `fieldErrors`.
  const [contactError, setContactError] = useState("");

  // Step 2 — Coupon publik pickup (ticket 07). Read-only list; the server
  // re-evaluates capacity authoritatively at preview and place-order. Ticket 08
  // menambah penggantian (dialog hanya saat total naik) dan state gugur yang
  // tidak pernah menghapus pilihan diam-diam.
  const [promoData, setPromoData] = useState<PromoPageResult | null>(null);
  const [selectedPublicOffer, setSelectedPublicOffer] = useState<AvailableOffer | null>(null);
  const [promoOpen, setPromoOpen] = useState(false);
  const promoSession = useRef(0);
  const promoListGeneration = useRef(0);
  const promoKnownOffers = useRef(new Map<string, AvailableOffer>());
  const preparedPromo = useRef<{ data: CheckoutPreviewData; intent: Record<string, unknown>; selection: PromoSelection } | null>(null);
  const [promoLoading, setPromoLoading] = useState(false);
  const [promoError, setPromoError] = useState<string | null>(null);
  const [, setSelectedOfferId] = useState<string | null>(null);
  const selectedOfferIdRef = useRef<string | null>(null);
  // Manual Promo Code (ticket 09): literal hanya hidup di state browser ini dan
  // dikirim lewat Terapkan; setiap review menyimpan identitas codeId.
  const [appliedManualCode, setAppliedManualCode] = useState<AppliedManualCode | null>(null);
  const appliedManualCodeRef = useRef<AppliedManualCode | null>(null);
  const [promoInvalidation, setPromoInvalidation] = useState<PromoInvalidation | null>(null);
  // Delta total turun dari promo yang baru diterapkan: snapshot comparable saja.
  const [promoDelta, setPromoDelta] = useState<{ amount: number; total: number } | null>(null);
  const [promoPendingOfferId, setPromoPendingOfferId] = useState<string | null>(null);
  const [promoReplacement, setPromoReplacement] = useState<{
    data: CheckoutPreviewData;
    intent: Record<string, unknown>;
    selection: PromoSelection;
  } | null>(null);

  function selectOffer(offerId: string | null) {
    selectedOfferIdRef.current = offerId;
    setSelectedOfferId(offerId);
    // Satu slot: memilih Coupon publik atau melepas promo selalu melepas kode
    // manual yang sedang dipakai.
    appliedManualCodeRef.current = null;
    setAppliedManualCode(null);
  }

  function selectManualCode(next: AppliedManualCode | null) {
    appliedManualCodeRef.current = next;
    setAppliedManualCode(next);
    if (next) {
      selectedOfferIdRef.current = null;
      setSelectedOfferId(null);
    }
  }

  /** Pilihan request saat ini; satu slot: manual menang atas Coupon publik. */
  function requestPromoSelection(): PromoSelection {
    const manual = appliedManualCodeRef.current;
    if (manual) return { kind: "manual", code: manual.code };
    const offerId = selectedOfferIdRef.current;
    return offerId ? { kind: "public", offerId } : { kind: "none" };
  }

  // Step 1 — Pickup
  const [pickupDate, setPickupDate] = useState("");
  const [pickupTime, setPickupTime] = useState("");
  // Error per field (tanggal/jam/telepon/email) supaya perbaikannya dekat
  // dengan kontrolnya; kontak memakai pesan yang sama untuk pickup.
  const [fieldErrors, setFieldErrors] = useState<PickupFieldErrors>({});
  const pickupDateRef = useRef<HTMLInputElement>(null);
  const pickupTimeRef = useRef<HTMLButtonElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  // Only the latest validation of unchanged fulfillment inputs may advance.
  const pickupValidationGeneration = useRef(0);

  // Step 3 — Review
  const [confirmed, setConfirmed] = useState(false);
  const [review, setReview] = useState<CheckoutReview | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [pendingRequest, setPendingRequest] = useState<PendingCheckout | null>(null);
  const [attemptFeedback, setAttemptFeedback] = useState<CheckoutAttemptResult | null>(null);
  // Pemeriksaan status checkout adalah lookup read-only request yang sama.
  const [checkState, setCheckState] = useState<CheckoutCheckState>("idle");
  const [lookupNotice, setLookupNotice] = useState<string | null>(null);
  // Satu feedback submit inline yang terlihat dan dapat difokuskan.
  const [submitError, setSubmitError] = useState<string | null>(null);
  const submitErrorRef = useRef<HTMLDivElement>(null);
  const attemptSnapshot = useRef<string | null>(null);
  // Preflight pajak BUKAN attempt durable: pesan/copy saja, tanpa state order.
  const [taxFeedback, setTaxFeedback] = useState<string | null>(null);
  const requestInFlight = useRef(false);
  const requestStorageKey = session?.user.id ? `checkoutRequest:${session.user.id}` : null;

  // Step 1 chooses pickup or delivery before collecting the order contact.
  // Method changes invalidate delivery selection and approval.
  const [fulfillmentMethod, setFulfillmentMethod] = useState<
    "pickup" | "delivery"
  >("pickup");
  const [deliveryService, setDeliveryService] = useState<DeliveryQuoteService | null>(null);
  const [deliveryPending, setDeliveryPending] = useState(false);
  // Ticket 04: the approval needs the chosen address + the reprice sync.
  const [deliveryAddressId, setDeliveryAddressId] = useState<string | null>(null);
  // Alamat create/edit yang belum selesai: tidak boleh quote/Lanjut/submit
  // order sementara mutation alamat masih unresolved.
  const [deliveryAddressPending, setDeliveryAddressPending] = useState(false);
  const [deliveryAddressPreview, setDeliveryAddressPreview] = useState<DeliveryAddressPreview | null>(null);
  /**
   * Pending body versi lama (masih membawa `newAddress`/save-intent). Hanya
   * dibaca: setelah lookup definitif 404 sesudah cutover, customer memilih
   * alamat tersimpan dan me-review ulang dengan request key baru. Body lama
   * tidak pernah dikirim ulang.
   */
  const [legacyPendingBody, setLegacyPendingBody] = useState(false);
  const [repriceSync, setRepriceSync] = useState<{
    services: DeliveryQuoteService[];
    selected: DeliveryQuoteService | null;
  } | null>(null);
  const [repriceShown, setRepriceShown] = useState(false);
  const REPRICE_MESSAGE =
    "Ongkir telah berubah. Periksa kembali rincian pesanan sebelum melanjutkan.";

  function handleFulfillmentMethodChange(method: "pickup" | "delivery") {
    if (method === fulfillmentMethod) return;
    pickupValidationGeneration.current += 1;
    setFulfillmentMethod(method);
    setReview(null);
    setConfirmed(false);
    // Any method change invalidates the old service + money immediately.
    setDeliveryService(null);
    setDeliveryPending(false);
    setRepriceSync(null);
    setRepriceShown(false);
  }

  // ===== Fetch cart + read selected item IDs on mount =====
  useEffect(() => {
    if (sessionPending) return;
    let cancelled = false;
    // Read the selection made on the cart page from sessionStorage.
    let ids: string[] = [];
    try {
      const stored = sessionStorage.getItem("checkoutSelectedItemIds");
      if (stored) ids = JSON.parse(stored) as string[];
    } catch {
      // sessionStorage unavailable — fall back to empty selection
    }

    async function fetchCart() {
      try {
        // Recovery mendahului cart: accepted order tetap ada setelah cart kosong.
        let stored: PendingCheckout | null = null;
        try {
          const raw = requestStorageKey ? sessionStorage.getItem(requestStorageKey) : null;
          if (raw) {
            const value = JSON.parse(raw);
            if (typeof value.requestKey === "string" && /^[a-f0-9-]{36}$/i.test(value.requestKey) &&
                value.body && typeof value.body === "object") stored = value;
          }
        } catch { /* Storage tidak tersedia; jangan merekonstruksi request baru. */ }
        if (stored) {
          if (cancelled) return;
          setPendingRequest(stored);
          try {
            const lookup = await fetch(`/api/checkout/requests/${stored.requestKey}`, { cache: "no-store" });
            const result = await lookup.json();
            // Only a promoted attempt has an order to open; an unresolved or
            // rejected attempt must not navigate away from checkout.
            if (!cancelled && result.success && result.data?.version === 2 && result.data?.state === "promoted" && result.data?.orderId) {
              if (requestStorageKey) sessionStorage.removeItem(requestStorageKey);
              router.replace(`/account/orders/${result.data.orderId}`);
            } else if (!cancelled && result.success && result.data && result.data.version !== 2 && result.data.orderId) {
              if (requestStorageKey) sessionStorage.removeItem(requestStorageKey);
              router.replace(`/account/orders/${result.data.orderId}`);
            } else if (!cancelled && lookup.status === 404 && legacyIntentInBody(stored.body)) {
              // Lookup definitif tanpa hasil untuk body inline lama: jangan
              // mengirim ulang body itu, minta customer memilih alamat tersimpan.
              setLegacyPendingBody(true);
            }
          } catch { /* Panel recovery tetap memakai key yang sama. */ }
          return;
        }
        const res = await fetch("/api/cart");
        const data = await res.json();
        if (!cancelled && data.success) {
          setCart(data.data);
          // Build the selected-item set from sessionStorage, intersected
          // with the current cart contents (so stale IDs are dropped).
          const validIds = new Set((data.data.items as CartItem[]).map((i) => i.id));
          const filtered = new Set(
            ids.filter((id) => validIds.has(id))
          );
          setSelectedItemIds(filtered);

          if (data.data.items.length === 0 || filtered.size === 0) {
            // Nothing to checkout — send the user back to the cart page.
            router.push("/cart");
            return;
          }
        }
      } catch (error) {
        console.error("Error fetching cart:", error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchCart();
    return () => { cancelled = true; };
  }, [router, sessionPending, requestStorageKey]);

  // ===== Derived: selected items & branch =====
  const selectedItems = useMemo(() => {
    if (!cart) return [];
    return cart.items.filter((item) => selectedItemIds.has(item.id));
  }, [cart, selectedItemIds]);

  const selectedBranchId = useMemo(() => {
    if (selectedItems.length === 0) return null;
    const branchIds = new Set(
      selectedItems.map((i) => i.branchId).filter((b): b is string => !!b)
    );
    return branchIds.size === 1 ? Array.from(branchIds)[0] : null;
  }, [selectedItems]);

  // Feedback submit utama harus ditemukan juga oleh pengguna keyboard/screen
  // reader: pindahkan fokus ke pesan yang baru muncul, bukan ke toast.
  useEffect(() => {
    if (submitError) submitErrorRef.current?.focus();
  }, [submitError]);

  // Fetch full branch details (with operating hours) once the selected
  // items are loaded. The cart page already enforces single-branch selection.
  useEffect(() => {
    if (!selectedBranchId) {
      setBranch(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const branchRes = await fetch(`/api/branches/${selectedBranchId}`);
      const branchData = await branchRes.json();
      if (!cancelled && branchData.success) {
        setBranch(branchData.data);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedBranchId]);

  // Coupon publik pickup — read-only discovery for the picker. A capacity race
  // is still re-checked at place-order; this call never reserves anything.
  // Pilihan yang hilang/tidak eligible TIDAK dihapus: ia menjadi state gugur
  // dengan alasan aman (ticket 08) agar tidak ada diskon palsu yang dipertahankan.
  const promoContextKey = JSON.stringify([selectedItems, fulfillmentMethod, deliveryService, deliveryAddressId, phone, email, pickupDate, pickupTime]);
  const promoContextRef = useRef(promoContextKey);
  const loadPromos = useCallback(async (page = 1) => {
    if (cart?.pricingContractVersion !== 1 || selectedItems.length === 0) return;
    const generation = ++promoListGeneration.current;
    const contextKey = promoContextRef.current;
    const active = selectedOfferIdRef.current;
    setPromoLoading(true);
    setPromoError(null);
    try {
      const response = await fetch("/api/discounts/available", {
        method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
        body: JSON.stringify({
          page, selectedItemIds: selectedItems.map(item => item.id), fulfillmentMethod,
          ...(active ? { selectedOfferId: active } : {}),
          ...(fulfillmentMethod === "delivery" && deliveryService ? { shippingBeforeSubsidy: deliveryService.shippingCost } : {}),
        }),
      });
      const result = await response.json();
      if (generation !== promoListGeneration.current || contextKey !== promoContextRef.current) return;
      if (!response.ok || !result.success) { setPromoError(result.error ?? "Promo belum dapat dimuat."); return; }
      const data = result.data as PromoPageResult;
      setPromoData(data);
      for (const offer of data.items) promoKnownOffers.current.set(offer.offerId, offer);
      if (active && active === selectedOfferIdRef.current) {
        setSelectedPublicOffer(data.selectedOffer);
        if (data.selectedOfferUnavailable || (data.selectedOffer && !data.selectedOffer.eligible)) {
          setPromoInvalidation({
            offerId: active,
            message: data.selectedOffer?.reasonMessage ?? "Promo ini sudah tidak tersedia untuk pesanan kamu.",
            previousTotal: review?.pricing.total ?? null,
          });
        } else if (data.selectedOffer?.eligible) {
          // Promo kembali tersedia untuk konteks ini: state gugur lama boleh hilang.
          // Respons tanpa informasi pilihan (selectedOffer null) TIDAK menghapus
          // state gugur yang baru di-set oleh penolakan authoritative.
          setPromoInvalidation(null);
        }
      }
    } catch {
      if (generation === promoListGeneration.current) setPromoError("Promo belum dapat dimuat.");
    } finally {
      if (generation === promoListGeneration.current) setPromoLoading(false);
    }
  }, [fulfillmentMethod, deliveryService, cart?.pricingContractVersion, selectedItems]);

  useLayoutEffect(() => {
    if (promoContextRef.current === promoContextKey) return;
    promoContextRef.current = promoContextKey;
    promoSession.current++;
    promoListGeneration.current++;
    preparedPromo.current = null;
    promoKnownOffers.current.clear();
    if (step >= 2) void loadPromos(1);
  }, [promoContextKey, loadPromos, step]);
  useEffect(() => {
    if (step >= 2) void loadPromos(1);
  }, [step, loadPromos]);

  function changePromoOpen(open: boolean) {
    promoSession.current++;
    preparedPromo.current = null;
    setPromoOpen(open);
    if (open) void loadPromos(1);
  }

  // Order contact is required for both methods, independently of the
  // delivery recipient. Submit the same trimmed values that were validated.
  const validateContact = (): boolean => {
    const trimmedPhone = phone.trim();
    const phoneDigits = trimmedPhone.replace(/\D/g, "");
    const errors: PickupFieldErrors = {};
    if (
      !trimmedPhone ||
      phoneDigits.length < 8 ||
      phoneDigits.length > 15 ||
      trimmedPhone.length > 20
    ) {
      errors.phone = "Masukkan nomor telepon yang valid (8–15 angka).";
    }
    const trimmedEmail = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      errors.email = "Masukkan alamat email yang valid.";
    }
    setFieldErrors((previous) => ({
      date: previous.date,
      time: previous.time,
      ...errors,
    }));
    if (errors.phone) {
      phoneRef.current?.focus();
      return false;
    }
    if (errors.email) {
      emailRef.current?.focus();
      return false;
    }
    setPhone(trimmedPhone);
    setEmail(trimmedEmail);
    return true;
  };

  // Pre-fill contact from session.
  // Better Auth's client-side `useSession` type doesn't include custom
  // additional fields (phone) by default, so we cast to access it.
  const sessionUser = session?.user as
    | { name?: string; email?: string; phone?: string }
    | undefined;

  // Show the "fill from profile" button once the session is loaded and at
  // least one of phone/email is available from the profile. Previously the
  // button required both fields to be present, which hid it during the
  // initial session fetch after login and also for users with only an email
  // on file (e.g. Google sign-in before onboarding adds a phone number).
  const canFillFromProfile = useMemo(
    () =>
      !sessionPending &&
      !!sessionUser &&
      (!!sessionUser.phone || !!sessionUser.email),
    [sessionPending, sessionUser]
  );

  useEffect(() => {
    if (sessionUser) {
      if (!phone && sessionUser.phone) setPhone(sessionUser.phone);
      if (!email && sessionUser.email) setEmail(sessionUser.email);
    }
  }, [sessionUser, phone, email]);

  // ===== Derived values for Step 1 (pickup) =====
  const todayStr = new Date().toISOString().split("T")[0];

  const selectedDate = useMemo(() => {
    if (!pickupDate) return null;
    const [y, mo, d] = pickupDate.split("-").map(Number);
    return new Date(y, mo - 1, d);
  }, [pickupDate]);

  const dayHours = useMemo(() => {
    if (!branch || !selectedDate) return null;
    return getDayHours(branch.operatingHours, selectedDate);
  }, [branch, selectedDate]);

  const timeSlots = useMemo(() => {
    return generateTimeSlots(dayHours);
  }, [dayHours]);

  const subtotal = useMemo(
    () =>
      selectedItems.reduce(
        (sum, item) => sum + parseFloat(item.variant.price) * item.quantity,
        0
      ),
    [selectedItems]
  );
  const fallbackPricing = useMemo<CheckoutPricing>(
    () => fulfillmentMethod === "delivery" && deliveryService ? deliveryService.pricing : calculateOrderPricing({
      subtotal,
      // Delivery taxes the quoted ongkir (rates, never final_rates); the
      // pickup flow keeps the historical goods-only PPN.
      shippingCost:
        fulfillmentMethod === "delivery" && deliveryService
          ? deliveryService.shippingCost
          : 0,
      fulfillmentMethod,
      ppnRatePercent: cart?.ppnRatePercent ?? 11,
    }),
    [subtotal, fulfillmentMethod, deliveryService, cart?.ppnRatePercent]
  );
  // Promo yang gugur tidak boleh terus menampilkan total berdiskon: breakdown
  // kembali ke harga dasar + invalidation notice sampai customer memilih ulang
  // atau lanjut tanpa promo secara eksplisit.
  const pricing = review && !promoInvalidation ? review.pricing : fallbackPricing;
  const total = Number(pricing.total);
  // Promo yang benar-benar dipakai berasal dari review server, bukan dari
  // klik tombol: kegagalan jaringan tidak boleh tampak seperti applied state.
  const appliedPromo =
    review && !promoInvalidation && review.promo.kind === "public"
      ? {
          offerId: review.promo.offerId as string,
          name:
            (selectedPublicOffer && selectedPublicOffer.offerId === review.promo.offerId ? selectedPublicOffer.name : null) ??
            promoData?.items.find((offer) => offer.offerId === review.promo.offerId)?.name ??
            "Coupon",
          benefitAmount: review.promo.benefitAmount ?? review.pricing.discount,
        }
      : null;
  // Tanpa promo yang gugur, tombol bayar tetap bisa ditekan: acknowledgement
  // penggantian/invalidation dikirim bersama body place-order.
  const promoBlocked = promoInvalidation != null || promoPendingOfferId != null;
  // Review server wajib untuk kontrak berversi dan bisa gugur (promo ditolak,
  // ongkir berubah, konteks berubah). Customer me-review ulang di tempat tanpa
  // kehilangan alamat/layanan yang sudah dipilih.
  const needsRereview = cart?.pricingContractVersion === 1 && review == null;

  // Pickup validation — the server also revalidates at order placement.
  // Kontrak wajib mengikuti atribut required/aria-required; error yang sama
  // tampil dekat field masing-masing lalu fokus pindah ke field invalid pertama.
  const validatePickup = (): boolean => {
    const errors: PickupFieldErrors = {};
    let focusDate = false;
    // Tanggal adalah prasyarat jam: jangan menampilkan error pada kontrol
    // jam yang masih disabled saat tanggal belum dipilih.
    if (!pickupDate) {
      errors.date = "Pilih tanggal pickup.";
    } else if (!dayHours) {
      // Pesan tutup-cabang sudah tampil di bawah field tanggal.
      focusDate = true;
    } else if (!pickupTime) {
      errors.time = "Pilih jam pickup.";
    } else if (!timeSlots.includes(pickupTime)) {
      errors.time = `Waktu pickup harus antara ${dayHours.open} dan ${dayHours.close}.`;
    }
    setFieldErrors(errors);
    if (errors.date || focusDate) {
      pickupDateRef.current?.focus();
      return false;
    }
    if (errors.time) {
      pickupTimeRef.current?.focus();
      return false;
    }
    return true;
  };

  // Step 1 validates fulfillment AND the order contact before the review is
  // created. The existing pickup endpoint retains its name for compatibility;
  // delivery never sends slots.
  const handleNextFromFulfillment = async () => {
    if (fulfillmentMethod === "delivery") {
      if (deliveryPending || deliveryAddressPending || !deliveryService) return;
      // Delivery memakai email akun + telepon penerima alamat; tidak ada
      // langkah kontak terpisah, jadi validasinya di sini.
      if (!validateDeliveryContact()) return;
      await goToPayment();
      return;
    }
    if (!validatePickup() || !branch) return;
    const generation = ++pickupValidationGeneration.current;
    try {
      const res = await fetch("/api/checkout/validate-step-2", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branchId: branch.id,
          pickupDate,
          pickupTime,
        }),
      });
      const data = await res.json();
      if (generation !== pickupValidationGeneration.current) return;
      if (data.success) {
        if (!validateContact()) return;
        await goToPayment();
      } else {
        const mapped = mapPickupSlotError(data.error);
        setFieldErrors({ [mapped.field]: mapped.message });
        (mapped.field === "date"
          ? pickupDateRef.current
          : pickupTimeRef.current
        )?.focus();
      }
    } catch {
      if (generation !== pickupValidationGeneration.current) return;
      setFieldErrors({
        time: "Slot pickup belum dapat diverifikasi. Coba lagi.",
      });
      pickupTimeRef.current?.focus();
    }
  };

  // Kontak pemesan delivery: email dari akun, telepon dari penerima alamat.
  const validateDeliveryContact = (): boolean => {
    const recipientPhone = (deliveryAddressPreview?.phone ?? "").trim();
    const digits = recipientPhone.replace(/\D/g, "");
    if (!deliveryAddressPreview || digits.length < 8 || digits.length > 15) {
      setContactError(
        "Nomor telepon penerima pada alamat tidak valid (8–15 angka). Perbaiki nomor tersebut di Buku Alamat atau gunakan alamat baru."
      );
      return false;
    }
    const accountEmail = (email || sessionUser?.email || "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(accountEmail)) {
      setContactError("Email akun belum valid. Lengkapi email akun sebelum melanjutkan.");
      return false;
    }
    setPhone(recipientPhone);
    setEmail(accountEmail);
    setContactError("");
    return true;
  };

  function currentIntent(): Record<string, unknown> {
    return fulfillmentMethod === "delivery" && deliveryService ? {
      itemIds: selectedItems.map((item) => item.id),
      contactPhone: (deliveryAddressPreview?.phone ?? phone).trim(),
      contactEmail: (email || sessionUser?.email || "").trim(),
      fulfillmentMethod: "delivery",
      ...(deliveryAddressId ? { addressId: deliveryAddressId } : {}),
      courierId: deliveryService.courierId, serviceId: deliveryService.serviceId,
      // Approval = NET customer yang terakhir direview (subsidi sudah masuk);
      // service quote original tetap dibekukan di delivery snapshot server.
      approvedPricing: review?.pricing ?? deliveryService.pricing,
      originFingerprint: deliveryService.originFingerprint,
      // Satu slot promo yang sama dengan pickup (ticket 11).
      promoSelection: requestPromoSelection(),
    } : { phone: phone.trim(), email: email.trim(), pickupDate, pickupTime, selectedItemIds: Array.from(selectedItemIds),
      promoSelection: requestPromoSelection() };
  }

  /**
   * Proyeksi identitas tersimpan: manual memakai codeId (bukan literal), jadi
   * token/previous tidak pernah membawa kode.
   */
  function promoSelectionOf(promo: PromoIdentity): StoredPromoSelection {
    if (promo.kind === "manual" && promo.offerId && promo.codeId) {
      return { kind: "manual", offerId: promo.offerId, codeId: promo.codeId };
    }
    if (promo.kind === "public" && promo.offerId) {
      return { kind: "public", offerId: promo.offerId };
    }
    return { kind: "none" };
  }

  /**
   * Menyimpan review server sebagai satu-satunya sumber total/pilihan promo.
   * Hanya dipanggil setelah server sukses; kegagalan tidak pernah mengubah
   * state yang tampil.
   */
  function applyPromoReview(
    data: CheckoutPreviewData,
    intent: Record<string, unknown>,
    selection: PromoSelection
  ) {
    const previousTotal = review && !promoInvalidation ? Number(review.pricing.total) : null;
    const nextTotal = Number(data.pricing.total);
    // Delta hanya untuk snapshot comparable (review sebelumnya yang masih sah):
    // total turun dijelaskan inline, bukan dengan dialog baru.
    setPromoDelta(
      previousTotal !== null && Number.isFinite(previousTotal) && Number.isFinite(nextTotal) && nextTotal < previousTotal
        ? { amount: previousTotal - nextTotal, total: nextTotal }
        : null
    );
    setReview({
      reviewToken: data.reviewToken,
      expiresAt: data.expiresAt,
      pricing: data.pricing,
      intent: intent.fulfillmentMethod === "delivery"
        ? {
            ...intent,
            approvedPricing: data.pricing,
            originFingerprint: data.deliveryService?.originFingerprint ?? intent.originFingerprint,
          }
        : intent,
      contextFingerprint: data.contextFingerprint,
      promo: data.promo ?? { kind: selection.kind, ...("offerId" in selection ? { offerId: selection.offerId } : {}) },
      requiresIncreaseAcknowledgement: data.requiresIncreaseConfirmation === true,
      requiresContinueWithoutPromoAcknowledgement:
        data.requiresContinueWithoutPromoAcknowledgement === true,
    });
    if (selection.kind === "manual") {
      const resolved = data.promo;
      if (resolved?.kind === "manual" && resolved.offerId && resolved.codeId) {
        selectManualCode({
          code: selection.code,
          offerId: resolved.offerId,
          codeId: resolved.codeId,
        });
      }
    } else {
      selectOffer(selection.kind === "public" ? selection.offerId : null);
    }
    setPromoInvalidation(null);
    setPromoReplacement(null);
    setConfirmed(false);
    setStep(2);
  }

  async function postPreview(body: Record<string, unknown>) {
    const response = await fetch("/api/checkout/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { response, result: await response.json() };
  }

  /**
   * Pilih/Terapkan = penggantian. Bila sudah ada review, server membandingkan
   * total final lama vs kandidat: naik → dialog (pilihan lama tetap sampai
   * dikonfirmasi), sama/turun → langsung diganti. Kandidat gagal tidak pernah
   * menimpa pilihan lama yang masih valid.
   */
  async function handleSelectOffer(offerId: string | null) {
    if (promoPendingOfferId) return;
    const selection: PromoSelection = offerId ? { kind: "public", offerId } : { kind: "none" };
    if (!review || cart?.pricingContractVersion !== 1) {
      selectOffer(offerId);
      if (!offerId) setPromoInvalidation(null);
      return;
    }
    setPromoPendingOfferId(offerId ?? "none");
    try {
      const baseIntent = { ...review.intent, promoSelection: selection };
      const { result } = await postPreview({
        ...baseIntent,
        previous: {
          reviewToken: review.reviewToken,
          promoSelection: promoSelectionOf(review.promo),
        },
      });
      if (!result.success) {
        if (result.code === "CHECKOUT_REVIEW_REQUIRED") {
          // Konteks (cart/slot/harga) berubah: approval lama gugur, minta review
          // baru. Jangan membandingkan total dari konteks yang sudah tidak ada.
          setReview(null);
          setConfirmed(false);
          selectOffer(offerId);
          setPromoInvalidation(null);
          setStep(1);
          toast.error(result.error || "Rincian pesanan berubah. Periksa kembali total kamu.");
          return;
        }
        if (typeof result.code === "string" && result.code.startsWith("PROMO_")) {
          const invalidPrevious = result.data?.previous;
          if (
            invalidPrevious?.status === "invalid" &&
            invalidPrevious.promo?.kind !== "none" &&
            invalidPrevious.promo?.offerId
          ) {
            setPromoInvalidation({
              offerId: invalidPrevious.promo.offerId,
              message: invalidPrevious.message || result.error || "Promo tidak lagi berlaku.",
              previousTotal: review?.pricing.total ?? null,
            });
          }
          void loadPromos();
        }
        toast.error(result.error || "Promo belum dapat dipakai.");
        return;
      }
      const data = result.data as CheckoutPreviewData;
      if (data.requiresIncreaseConfirmation) {
        // Total naik: tahan kandidat, jangan ubah pilihan/total yang tampil.
        setPromoReplacement({ data, intent: baseIntent, selection });
        return;
      }
      applyPromoReview(data, baseIntent, selection);
    } catch {
      toast.error("Promo belum dapat diperiksa. Pilihan kamu tidak berubah.");
    } finally {
      setPromoPendingOfferId(null);
    }
  }

  /** Prepare without applying; commit only after the explicit modal action. */
  async function preparePromo(selection: PromoDraft, commit: boolean): Promise<PromoCandidateResult> {
    if (selection.kind === "none") return { kind: "error", message: "Pilih promo terlebih dahulu" };
    const sessionId = promoSession.current;
    const contextKey = promoContextRef.current;
    if (commit) setPromoPendingOfferId(selection.kind === "public" ? selection.offerId : "manual");
    try {
      const intent = { ...(review ? review.intent : currentIntent()), promoSelection: selection };
      const { result } = await postPreview({
        ...intent,
        ...(review ? { previous: { reviewToken: review.reviewToken, promoSelection: promoSelectionOf(review.promo) } } : {}),
      });
      if (sessionId !== promoSession.current || contextKey !== promoContextRef.current) {
        return { kind: "context_changed", message: "Pesanan berubah. Pilih promo kembali." };
      }
      if (!result.success) {
        if (result.code === "CHECKOUT_REVIEW_REQUIRED") {
          setReview(null); setConfirmed(false); setStep(1); changePromoOpen(false);
          return { kind: "context_changed", message: "Pesanan berubah. Pilih promo kembali." };
        }
        if (result.data?.previous?.status === "invalid" && result.data.previous.promo?.offerId) {
          setPromoInvalidation({
            offerId: result.data.previous.promo.offerId,
            message: result.data.previous.message || "Promo tidak lagi berlaku.",
            previousTotal: review?.pricing.total ?? null,
          });
        }
        if (String(result.code).startsWith("PROMO_")) void loadPromos(promoData?.page ?? 1);
        return { kind: "error", message: result.code === "RATE_LIMITED"
          ? "Terlalu banyak percobaan. Coba lagi beberapa saat lagi." : result.error || "Promo belum dapat diperiksa. Coba lagi." };
      }
      const data = result.data as CheckoutPreviewData;
      if (commit && data.requiresIncreaseConfirmation && data.replacement) {
        preparedPromo.current = { data, intent, selection };
        return { kind: "increase_confirmation", previousTotal: data.replacement.previous.total ?? "0",
          candidateTotal: data.replacement.candidate.total, deltaTotal: data.replacement.deltaTotal ?? "0" };
      }
      const name = selection.kind === "manual" ? selection.code.trim().toUpperCase()
        : promoKnownOffers.current.get(selection.offerId)?.name ?? selectedPublicOffer?.name ?? "Promo";
      if (commit) {
        if (selection.kind === "public") setSelectedPublicOffer(promoKnownOffers.current.get(selection.offerId) ?? selectedPublicOffer);
        applyPromoReview(data, intent, selection);
        toast.success("Promo diterapkan");
      }
      return { kind: "ready", name, benefitAmount: data.promo?.benefitAmount ?? String(data.pricing.discount) };
    } catch {
      return { kind: "error", message: "Promo belum dapat diperiksa. Coba lagi." };
    } finally {
      if (commit) setPromoPendingOfferId(null);
    }
  }

  function confirmPreparedPromo() {
    const candidate = preparedPromo.current;
    if (!candidate) return;
    const selection = candidate.selection;
    if (selection.kind === "public") setSelectedPublicOffer(promoKnownOffers.current.get(selection.offerId) ?? selectedPublicOffer);
    applyPromoReview(candidate.data, candidate.intent, selection);
    changePromoOpen(false);
    toast.success("Promo diterapkan");
  }

  function handleConfirmPromoReplacement() {
    if (!promoReplacement) return;
    applyPromoReview(
      promoReplacement.data,
      promoReplacement.intent,
      promoReplacement.selection
    );
  }

  /**
   * "Lanjut tanpa promo" eksplisit. Bila ada review sebelumnya, acknowledgement
   * mengikat candidate fingerprint token dan server menandai token dengan
   * persyaratan `continue_without_promo` untuk place-order.
   */
  async function handleContinueWithoutPromo() {
    if (promoPendingOfferId) return;
    if (!review) {
      selectOffer(null);
      setPromoInvalidation(null);
      setConfirmed(false);
      toast.success("Lanjut tanpa promo. Periksa total terbaru sebelum membayar.");
      return;
    }
    setPromoPendingOfferId("none");
    try {
      const selection: PromoSelection = { kind: "none" };
      const baseIntent = { ...review.intent, promoSelection: selection };
      const { result } = await postPreview({
        ...baseIntent,
        acknowledgeInvalidation: true,
        previous: {
          reviewToken: review.reviewToken,
          promoSelection: promoSelectionOf(review.promo),
        },
      });
      if (!result.success) {
        if (result.code === "CHECKOUT_REVIEW_REQUIRED") {
          setReview(null);
          selectOffer(null);
          setPromoInvalidation(null);
          setStep(1);
        }
        toast.error(result.error || "Promo belum dapat dilepas. Coba lagi.");
        return;
      }
      const data = result.data as CheckoutPreviewData;
      if (data.requiresIncreaseConfirmation) {
        setPromoReplacement({ data, intent: baseIntent, selection });
        return;
      }
      applyPromoReview(data, baseIntent, selection);
    } catch {
      toast.error("Promo belum dapat dilepas. Pilihan kamu tidak berubah.");
    } finally {
      setPromoPendingOfferId(null);
    }
  }

  /**
   * Satu-satunya jalan menuju langkah pembayaran: membuat review server setelah
   * input langkah 1 valid. Dipakai juga oleh pemulihan "Periksa ulang pesanan"
   * saat review lama gugur (promo ditolak/ongkir berubah).
   */
  async function goToPayment() {
    if (reviewing) return;
    if (fulfillmentMethod === "delivery" && (deliveryPending || deliveryAddressPending || !deliveryService)) { setStep(1); return; }
    setConfirmed(false);
    if (cart?.pricingContractVersion === 1) {
      setReviewing(true);
      try {
        const intent = { ...currentIntent() };
        const response = await fetch("/api/checkout/preview", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(intent),
        });
        const result = await response.json();
        if (!result.success) {
          if (result.code === "CHECKOUT_TAX_UNAVAILABLE") {
            // Konfigurasi/master pajak belum sah: payment tidak dibuka, form dan
            // pilihan promo tetap; customer hanya dapat memeriksa ulang.
            setTaxFeedback(
              result.error ||
                "Checkout belum dapat diproses karena konfigurasi pajak belum sesuai. Silakan coba lagi nanti."
            );
            setConfirmed(false);
            return;
          }
          toast.error(result.error || "Review checkout belum tersedia.");
          if (typeof result.code === "string" && result.code.startsWith("PROMO_")) {
            void loadPromos();
          }
          return;
        }
        setTaxFeedback(null);
        const data = result.data as CheckoutPreviewData;
        if (data.deliveryService) setDeliveryService(data.deliveryService);
        // Review awal memakai pilihan request yang sudah divalidasi server;
        // identitas tersimpan (codeId) tetap berasal dari data.promo. Delivery
        // juga membawa approval NET + origin fingerprint dari server.
        applyPromoReview(
          data,
          fulfillmentMethod === "delivery"
            ? {
                ...intent,
                approvedPricing: data.pricing,
                originFingerprint:
                  data.deliveryService?.originFingerprint ??
                  deliveryService?.originFingerprint,
              }
            : intent,
          requestPromoSelection()
        );
      } catch { toast.error("Review checkout belum dapat dibaca. Silakan coba lagi."); }
      finally { setReviewing(false); }
      return;
    }
    setStep(2);
  }

  function clearPendingRequest() {
    if (requestStorageKey) sessionStorage.removeItem(requestStorageKey);
    setPendingRequest(null);
  }

  /**
   * Setelah lookup definitif 404, pending body lama dibuang dan customer memulai
   * review/request key BARU dengan alamat tersimpan — bukan mengirim body lama.
   */
  function startAddressOnlyCheckout() {
    // Body lama dibuang dari pending lokal; halaman dimuat ulang supaya langkah
    // input (dan keranjang) terbaca lagi. Tidak ada POST/order yang dikirim.
    setLegacyPendingBody(false);
    setAttemptFeedback(null);
    setSubmitError(null);
    setLookupNotice(null);
    setCheckState("idle");
    setReview(null);
    setConfirmed(false);
    clearPendingRequest();
    window.location.replace("/checkout");
  }

  async function submitVersioned(record: PendingCheckout) {
    setSubmitError(null);
    try {
      const response = await fetch("/api/checkout/place-order", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(record.body),
      });
      const result = await response.json();
      if (!result.success && result.code === "CHECKOUT_TAX_UNAVAILABLE") {
        setTaxFeedback(
          result.error ||
            "Checkout belum dapat diproses karena konfigurasi pajak belum sesuai. Silakan coba lagi nanti."
        );
        setConfirmed(false);
        return;
      }
      // Version-2 attempt contract: only a PROMOTED attempt may redirect. A
      // rejected/unknown attempt keeps the reviewed form on screen.
      const attempt: CheckoutAttemptResult | undefined = result.data?.version === 2 ? result.data : undefined;
      if (attempt) {
        setAttemptFeedback(attempt);
        if (attempt.state === "promoted" && attempt.orderId) {
          clearPendingRequest();
          refreshCart();
          if (attempt.paymentAvailable && attempt.redirectUrl) window.location.href = attempt.redirectUrl;
          else router.push(`/account/orders/${attempt.orderId}`);
          return;
        }
        if (attempt.state === "rejected") {
          // Retry is allowed only after a definitive, fully compensated failure.
          clearPendingRequest();
          setConfirmed(false);
          setReview(null);
          setStep(2);
          return;
        }
        if (attempt.state === "promoted") return;
        return;
      }
      if (result.success && result.data?.orderId) {
        clearPendingRequest();
        refreshCart();
        if (result.data.paymentAvailable && result.data.redirectUrl) window.location.href = result.data.redirectUrl;
        else router.push(`/account/orders/${result.data.orderId}`);
        return;
      }
      if (!result.success && handleStockAdjustment(result)) {
        // Shortage adalah penolakan definitif sebelum order/attempt dibuat.
        // Quantity baru memerlukan review dan request key baru, bukan recovery.
        clearPendingRequest();
        setReview(null);
        setAttemptFeedback(null);
        return;
      }
      if (result.code === "CHECKOUT_REVIEW_REQUIRED" || result.code === "DELIVERY_REPRICE_REQUIRED") {
        clearPendingRequest(); setConfirmed(false); setReview(null);
        if (result.code === "DELIVERY_REPRICE_REQUIRED") {
          const services: DeliveryQuoteService[] = result.data?.services ?? [];
          const matched = services.find((service) => service.courierId === deliveryService?.courierId && service.serviceId === deliveryService?.serviceId) ?? null;
          setDeliveryService(matched); setRepriceSync({ services, selected: matched }); setRepriceShown(true);
          // Layanan yang disetujui hilang → kembali ke langkah input; bila masih
          // ada, customer mengonfirmasi ulang di langkah pembayaran.
          if (!matched) setStep(1);
        } else setStep(1);
      }
      // Promo ditolak authoritative (kapasitas/ineligible/berubah): tidak ada
      // order yang dibuat. Customer tetap di langkah pembayaran untuk memilih
      // promo lain, lalu me-review ulang lewat "Periksa ulang pesanan" — jangan
      // menampilkan applied state palsu atau order tanpa promo diam-diam.
      if (typeof result.code === "string" && result.code.startsWith("PROMO_")) {
        clearPendingRequest();
        setReview(null);
        setConfirmed(false);
        setStep(2);
        // Catatan penurunan total sebelumnya tidak boleh bertahan: total sudah
        // kembali ke harga tanpa promo, jadi klaim penghematan lama akan palsu.
        setPromoDelta(null);
        // Alasan aman dari server tetap ditampilkan sebagai state gugur; promo
        // tidak diganti otomatis dan order tanpa promo tidak dibuat diam-diam.
        // Identitas promo diambil dari ref pilihan, lalu dari review yang barusan
        // ditolak (closure) supaya state gugur tidak hilang saat ref sudah bersih.
        const invalidatedOfferId =
          selectedOfferIdRef.current ??
          appliedManualCodeRef.current?.offerId ??
          (review?.promo && review.promo.kind !== "none"
            ? review.promo.offerId
            : null);
        if (invalidatedOfferId) {
          setPromoInvalidation({
            offerId: invalidatedOfferId,
            message: result.error || "Promo tidak lagi berlaku untuk pesanan ini.",
            previousTotal: review?.pricing.total ?? null,
          });
        }
        void loadPromos();
      }
      toast.error(result.error || "Status checkout belum dapat dipastikan. Periksa pesanan yang sama.");
    } catch {
      // Jangan ganti key/intent setelah response hilang. Panel recovery tetap tersedia.
      setSubmitError("Koneksi terputus. Periksa status pesanan sebelum mencoba lagi.");
    }
  }

  async function recoverPendingRequest() {
    if (!pendingRequest || requestInFlight.current) return;
    requestInFlight.current = true; setSubmitting(true);
    setCheckState("checking");
    setLookupNotice(null);
    try {
      const response = await fetch(`/api/checkout/requests/${pendingRequest.requestKey}`, { cache: "no-store" });
      const result = await response.json().catch(() => null);
      const attempt: CheckoutAttemptResult | undefined = result?.data?.version === 2 ? result.data : undefined;
      if (attempt) {
        const previous = attemptSnapshot.current;
        const next = attemptSignature(attempt);
        attemptSnapshot.current = next;
        setAttemptFeedback(attempt);
        if (attempt.state === "promoted" && attempt.orderId) {
          setCheckState("updated");
          clearPendingRequest(); refreshCart();
          if (attempt.paymentAvailable && attempt.redirectUrl) window.location.href = attempt.redirectUrl;
          else router.push(`/account/orders/${attempt.orderId}`);
          return;
        }
        setCheckState(previous !== null && previous !== next ? "updated" : previous === null ? "idle" : "unchanged");
        if (attempt.retryAllowed) clearPendingRequest();
        return;
      }
      if (result?.success && result.data?.orderId) {
        setCheckState("updated");
        clearPendingRequest(); router.push(`/account/orders/${result.data.orderId}`); refreshCart(); return;
      }
      if (response.status === 404) {
        // Pemeriksaan TIDAK memanggil place-order. Request/isian dipertahankan
        // dan customer mendapat langkah lanjut yang jujur.
        setCheckState("idle");
        setLookupNotice("Hasil checkout belum ditemukan. Periksa lagi atau hubungi bantuan.");
        return;
      }
      setCheckState("error");
    } catch {
      setCheckState("error");
      setLookupNotice("Koneksi belum tersedia. Request checkout tetap tersimpan.");
    }
    finally { requestInFlight.current = false; setSubmitting(false); }
  }

  // Stock refusal is NOT an order: apply only the server's saved reductions,
  // remove zero-stock items from selection (not cart), and require fresh approval.
  function handleStockAdjustment(data: StockAdjustmentResponse): boolean {
    if (data.code !== "CHECKOUT_STOCK_ADJUSTED" || !data.adjustments?.length) return false;
    const adjusted = new Map(data.adjustments.map((item) => [item.cartItemId, item.availableQuantity]));
    setCart((current) => {
      if (!current) return current;
      const items = current.items.map((item) => {
        const quantity = adjusted.get(item.id);
        return quantity !== undefined && quantity > 0 ? { ...item, quantity } : item;
      });
      return { ...current, items, subtotal: items.reduce((sum, item) => sum + Number(item.variant.price) * item.quantity, 0) };
    });
    const remainingIds = new Set([...selectedItemIds].filter((id) => adjusted.get(id) !== 0));
    setSelectedItemIds(remainingIds);
    try {
      sessionStorage.setItem("checkoutSelectedItemIds", JSON.stringify([...remainingIds]));
    } catch {
      // The current checkout selection remains authoritative if storage is unavailable.
    }
    setConfirmed(false);
    setStockAdjustmentMessage(data.error || "Stok berubah. Jumlah pesanan telah disesuaikan. Periksa kembali pesanan sebelum melanjutkan.");
    refreshCart();
    if (fulfillmentMethod === "delivery") {
      setDeliveryService(null);
      setRepriceSync(null);
      setRepriceShown(false);
      setStep(1); // The panel's quantity fingerprint triggers a fresh quote.
    }
    if (!remainingIds.size) {
      toast.error(data.error || "Stok barang pilihan habis. Barang tetap di keranjang.");
      router.push("/cart");
    }
    return true;
  }

  // ===== Place order =====
  const handlePlaceOrder = async () => {
    if (!confirmed || requestInFlight.current) return;
    if (pendingRequest) {
      await recoverPendingRequest();
      return;
    }
    if (cart?.pricingContractVersion === 1) {
      if (!review || !requestStorageKey) { toast.error("Periksa kembali rincian checkout."); return; }
      const requestKey = crypto.randomUUID();
      // Persetujuan penggantian/invalidation mengikat candidate fingerprint yang
      // ditandatangani review token; tanpa itu server menolak place-order.
      const acknowledgements =
        review.requiresIncreaseAcknowledgement ||
        review.requiresContinueWithoutPromoAcknowledgement
          ? {
              ...(review.requiresIncreaseAcknowledgement
                ? { promoIncrease: { candidateFingerprint: review.contextFingerprint } }
                : {}),
              ...(review.requiresContinueWithoutPromoAcknowledgement
                ? {
                    continueWithoutPromo: {
                      candidateFingerprint: review.contextFingerprint,
                    },
                  }
                : {}),
            }
          : undefined;
      const record: PendingCheckout = { requestKey, body: {
        ...review.intent,
        requestKey,
        reviewToken: review.reviewToken,
        ...(acknowledgements ? { acknowledgements } : {}),
      } };
      try { sessionStorage.setItem(requestStorageKey, JSON.stringify(record)); }
      catch { toast.error("Browser tidak dapat menyimpan request checkout. Izinkan penyimpanan lalu coba lagi."); return; }
      requestInFlight.current = true; setPendingRequest(record); setSubmitting(true);
      try { await submitVersioned(record); }
      finally { requestInFlight.current = false; setSubmitting(false); }
      return;
    }
    if (fulfillmentMethod === "delivery") {
      if (deliveryPending || deliveryAddressPending || !deliveryService || !deliveryAddressId) return;
      setSubmitting(true);
      try {
        // Ticket 04 — the approval body: ONLY the approval; every money field
        // is re-derived server-side and compared against this approval.
        const res = await fetch("/api/checkout/place-order", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            itemIds: selectedItems.map((item) => item.id),
            contactPhone: phone,
            contactEmail: email,
            fulfillmentMethod: "delivery",
            addressId: deliveryAddressId,
            courierId: deliveryService.courierId,
            serviceId: deliveryService.serviceId,
            approvedPricing: deliveryService.pricing,
            originFingerprint: deliveryService.originFingerprint,
          }),
        });
        const data = (await res.json()) as StockAdjustmentResponse & {
          success: boolean;
          orderId?: string;
          redirectUrl?: string;
          token?: string;
          code?: string;
          data?: { services?: DeliveryQuoteService[] };
          error?: string;
        };
        if (!data.success && handleStockAdjustment(data)) return;
        if (!data.success && data.code === "DELIVERY_REPRICE_REQUIRED") {
          // Keep the review; require a FRESH approval: clear the confirmed
          // checkbox, sync the fresh services into the panel (fresh money;
          // a vanished service clears the selection) — never an auto repost.
          const fresh = data.data?.services ?? [];
          const matched =
            fresh.find(
              (service) =>
                service.courierId === deliveryService.courierId &&
                service.serviceId === deliveryService.serviceId
            ) ?? null;
          setDeliveryService(matched);
          setRepriceSync({ services: fresh, selected: matched });
          setConfirmed(false);
          setRepriceShown(true);
          if (!matched) setStep(1);
          // No toast: the inline banner carries the exact reprice message for
          // the customer (a second surface would duplicate the locator).
          return;
        }
        if (!data.success) {
          toast.error(data.error || "Gagal membuat pesanan.");
          return;
        }
        // Order placed successfully — refresh the navbar cart badge (the
        // checked-out items were removed), then hand off to the payment page.
        refreshCart();
        if (data.redirectUrl) {
          window.location.href = data.redirectUrl;
        } else {
          toast.error("Unexpected payment response. Please try again.");
        }
      } catch {
        toast.error("An error occurred. Please try again.");
      } finally {
        setSubmitting(false);
      }
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/checkout/place-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone,
          email,
          pickupDate,
          pickupTime,
          selectedItemIds: Array.from(selectedItemIds),
        }),
      });
      const data = await res.json();
      if (!data.success && handleStockAdjustment(data)) return;
      if (
        data.code === "PAYMENT_INITIALIZATION_UNKNOWN" &&
        typeof data.orderId === "string" &&
        data.orderId
      ) {
        // TX-02: the order exists but its payment session is unknown. Never
        // invite a replacement checkout — open the owned order instead.
        try {
          window.sessionStorage.setItem("checkout:payment-unknown-order", data.orderId);
        } catch {
          /* storage unavailable: the order stays reachable from order history */
        }
        router.push(`/account/orders/${data.orderId}`);
        return;
      }
      if (!data.success) {
        toast.error(data.error || "Failed to place order.");
        return;
      }
      // Order placed successfully — refresh the navbar cart badge so it
      // reflects the remaining items (the checked-out items are removed).
      refreshCart();
      if (data.redirectUrl) {
        // Redirect to Midtrans Snap payment page
        window.location.href = data.redirectUrl;
      } else {
        toast.error("Unexpected payment response. Please try again.");
      }
    } catch {
      toast.error("An error occurred. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  // ===== Loading state =====
  if (loading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </div>
    );
  }

  if (pendingRequest && (!cart || cart.items.length === 0)) {
    return <div className="container mx-auto max-w-xl px-4 py-16">
      <Card><CardContent className="space-y-4 pt-6">
        <h1 className="text-2xl font-bold">Periksa status pesanan</h1>
        <p>Request checkout tersimpan. Kami akan mencari pesanan yang sama, tanpa membuat pesanan atau pembayaran pengganti otomatis.</p>
        {attemptFeedback ? (
          <CheckoutAttemptFeedback
            result={attemptFeedback}
            busy={submitting}
            checkState={checkState}
            onCheckStatus={() => void recoverPendingRequest()}
            onReviewAgain={() => router.push("/cart")}
          />
        ) : (
          <Button onClick={recoverPendingRequest} disabled={submitting} aria-busy={submitting} className="gap-2">
            {submitting ? <><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Memeriksa pesanan…</> : "Periksa pesanan"}
          </Button>
        )}
        {lookupNotice && (
          <p role="alert" className={`rounded-lg border p-3 text-sm ${getStatusToneClassName("progress")}`}>
            {lookupNotice}
          </p>
        )}
        {legacyPendingBody && (
          <div role="alert" className={`space-y-3 rounded-lg border p-3 text-sm ${getStatusToneClassName("progress")}`}>
            <p className="font-medium">
              Alamat checkout perlu dipilih ulang. Pilih alamat tersimpan dan periksa kembali pesanan.
            </p>
            <Button type="button" variant="outline" size="sm" onClick={startAddressOnlyCheckout}>
              Pilih alamat dan review ulang
            </Button>
          </div>
        )}
        {!attemptFeedback && <Button variant="outline" onClick={() => router.push("/cart")}>Kembali ke keranjang</Button>}
      </CardContent></Card>
    </div>;
  }

  // ===== Empty cart redirect =====
  if (!cart || cart.items.length === 0) {
    return (
      <div className="container mx-auto px-4 py-16 text-center">
        <h1 className="text-2xl font-bold mb-4">Keranjang Kosong</h1>
        <p className="text-muted-foreground mb-8">
          Tambahkan produk ke keranjang sebelum checkout.
        </p>
        <Link href="/products">
          <Button>Mulai Belanja</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-5xl">
      {/* Back link */}
      <Link
        href="/cart"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-6"
      >
        <ArrowLeft className="h-4 w-4" /> Kembali ke Keranjang
      </Link>

      <h1 className="text-3xl font-bold mb-6">Checkout</h1>
      {stockAdjustmentMessage && (
        <p role="alert" className={`mb-6 rounded-lg border p-3 text-sm font-medium ${getStatusToneClassName("progress")}`}>
          {stockAdjustmentMessage}
        </p>
      )}

      {/* Step Indicator */}
      <div className="mb-8">
        <div className="flex items-center justify-between">
          {[
            { num: 1, label: "Cara Pengiriman", shortLabel: "Pengiriman", icon: MapPin },
            { num: 2, label: "Bayar & Pesan", shortLabel: "Bayar", icon: CreditCard },
          ].map((s, i) => (
            <div key={s.num} className="flex min-w-0 items-center flex-1 last:flex-none">
              <div className="flex min-w-0 items-center gap-2">
                <div
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 text-sm font-medium ${
                    step >= s.num
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-muted text-muted-foreground"
                  }`}
                >
                  {step > s.num ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <s.icon className="h-4 w-4" />
                  )}
                </div>
                <span
                  className={`min-w-0 break-words text-xs font-medium sm:hidden ${
                    step >= s.num ? "text-foreground" : "text-muted-foreground"
                  }`}
                >
                  {s.shortLabel}
                </span>
                <span
                  className={`hidden min-w-0 break-words text-sm font-medium sm:inline ${
                    step >= s.num ? "text-foreground" : "text-muted-foreground"
                  }`}
                >
                  {s.label}
                </span>
              </div>
              {i < 1 && (
                <div
                  className={`flex-1 h-0.5 mx-2 sm:mx-4 ${
                    step > s.num ? "bg-primary" : "bg-muted"
                  }`}
                />
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="mx-auto max-w-3xl">
        <div className="min-w-0">
          {/* Keep fulfillment mounted across steps: hiding preserves the
              delivery draft, quote, selection and pending request identity. */}
          <div hidden={step !== 1}>
            <Card>
              <CardContent className="p-6">
                <h2 className="text-xl font-bold mb-1">Cara Pengiriman</h2>
                <p className="text-sm text-muted-foreground mb-4">
                  {fulfillmentMethod === "delivery"
                    ? "Pilih alamat, lalu periksa ongkir."
                    : "Pilih tanggal dan jam pickup."}
                </p>
                {fulfillmentMethod === "pickup" && (
                  <p className="mb-4 text-xs text-muted-foreground">* Wajib diisi</p>
                )}

                {/* Selected items summary (read-only) */}
                <div className="mb-6 rounded-lg border bg-muted/30 p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium">Barang yang akan di-checkout</span>
                    <span className="text-xs text-muted-foreground">
                      {selectedItems.length} barang ·{" "}
                      <Link href="/cart" className="text-primary hover:underline">Ubah</Link>
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    {selectedItems.map((item) => (
                      <div key={item.id} className="flex flex-wrap justify-between gap-x-3 text-sm">
                        <span className="text-muted-foreground line-clamp-1 pr-2">
                          {item.product.name} ×{item.quantity}
                        </span>
                        <span className="flex-shrink-0">
                          Rp {(parseFloat(item.variant.price) * item.quantity).toLocaleString("id-ID")}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Fulfillment method */}
                {legacyPendingBody && (
                  <div
                    role="alert"
                    className={`mb-6 rounded-lg border p-4 text-sm ${getStatusToneClassName("progress")}`}
                  >
                    <p className="font-medium">
                      Alamat checkout perlu dipilih ulang. Pilih alamat tersimpan dan
                      periksa kembali pesanan.
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="mt-3"
                      onClick={startAddressOnlyCheckout}
                    >
                      Pilih alamat dan review ulang
                    </Button>
                  </div>
                )}
                <div className="mb-6 grid gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => handleFulfillmentMethodChange("pickup")}
                    className={`rounded-lg border p-4 text-left transition-colors ${
                      fulfillmentMethod === "pickup"
                        ? "border-primary bg-primary/5"
                        : "hover:bg-muted/40"
                    }`}
                  >
                    <span className="block font-medium">Ambil di cabang</span>
                    <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                      Ambil pesanan di cabang — Gratis (Pickup)
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleFulfillmentMethodChange("delivery")}
                    className={`rounded-lg border p-4 text-left transition-colors ${
                      fulfillmentMethod === "delivery"
                        ? "border-primary bg-primary/5"
                        : "hover:bg-muted/40"
                    }`}
                  >
                    <span className="block font-medium">Kirim ke alamat</span>
                    <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                      Cek layanan dan ongkir ke alamat Anda dahulu
                    </span>
                  </button>
                </div>

                {/* Quote uses cart IDs + destination; money is server-derived. */}
                {fulfillmentMethod === "delivery" && (
                  <>
                    {step === 1 && repriceShown && (
                      <p className={`mb-4 rounded-lg border p-3 text-sm font-medium ${getStatusToneClassName("progress")}`}>
                        {REPRICE_MESSAGE}
                      </p>
                    )}
                    <DeliveryQuotePanel
                      itemIds={selectedItems.map((item) => item.id)}
                      itemsKey={selectedItems
                        .map(
                          (item) =>
                            `${item.id}:${item.quantity}:${item.variant.price}:${item.branchId ?? ""}`
                        )
                        .join("|")}
                      onServiceChange={setDeliveryService}
                      onPendingChange={(pending) => {
                        setDeliveryPending(pending);
                        if (pending) {
                          setConfirmed(false);
                          // A NEW quote (address/items change) retires the
                          // previous reprice banner + sync.
                          setRepriceShown(false);
                          setRepriceSync(null);
                        }
                      }}
                      onAddressChange={setDeliveryAddressId}
                      onAddressSelected={setDeliveryAddressPreview}
                      onAddressPendingChange={setDeliveryAddressPending}
                      initialAddressId={deliveryAddressId}
                      repriceSync={repriceSync}
                    />
                  </>
                )}

                {fulfillmentMethod === "pickup" && (
                  <>
                    {/* Branch info (read-only — derived from selected items) */}
                <div className="mb-6 rounded-lg border border-primary/20 bg-primary/5 p-4">
                  <div className="flex items-start gap-3">
                    <MapPin className="mt-0.5 h-5 w-5 flex-shrink-0 text-primary" />
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold break-words">{branch?.name ?? "-"}</div>
                      <div className="text-sm text-muted-foreground break-words">
                        {branch?.address ?? "-"}
                        {branch?.city ? `, ${branch.city}` : ""}
                      </div>
                    </div>
                    <InfoHint label="Tentang cabang pickup" className="-mr-1 -mt-1">
                      Cabang mengikuti barang yang dipilih. Satu checkout hanya
                      untuk satu cabang.
                    </InfoHint>
                  </div>
                </div>

                <div className="space-y-4">
                  <div>
                    <Label htmlFor="pickupDate" className="flex items-center gap-2 mb-1.5">
                      <Calendar className="h-4 w-4" aria-hidden="true" /> Tanggal Pickup *
                    </Label>
                    <Input
                      id="pickupDate"
                      ref={pickupDateRef}
                      type="date"
                      min={todayStr}
                      required
                      aria-required="true"
                      aria-invalid={fieldErrors.date ? true : undefined}
                      aria-describedby={fieldErrors.date ? "pickupDate-error" : undefined}
                      value={pickupDate}
                      onChange={(e) => {
                        pickupValidationGeneration.current += 1;
                        setPickupDate(e.target.value);
                        setPickupTime(""); // reset time when date changes
                        setFieldErrors((previous) => ({
                          ...previous,
                          date: undefined,
                          time: undefined,
                        }));
                      }}
                    />
                    {fieldErrors.date && (
                      <p id="pickupDate-error" className="mt-1 text-sm text-destructive">
                        {fieldErrors.date}
                      </p>
                    )}
                    {selectedDate && !dayHours && (
                      <p className="mt-1 text-sm text-destructive">
                        Cabang tutup pada tanggal ini. Pilih tanggal lain.
                      </p>
                    )}
                  </div>

                  <div>
                    <Label htmlFor="pickupTime" className="flex items-center gap-2 mb-1.5">
                      <Clock className="h-4 w-4" aria-hidden="true" /> Waktu Pickup *
                    </Label>
                    {pickupDate && dayHours ? (
                      <Select
                        value={pickupTime}
                        onValueChange={(value) => {
                          pickupValidationGeneration.current += 1;
                          setPickupTime(value);
                          setFieldErrors((previous) => ({
                            ...previous,
                            time: undefined,
                          }));
                        }}
                      >
                        <SelectTrigger
                          id="pickupTime"
                          ref={pickupTimeRef}
                          aria-required="true"
                          className="checkout-prompt"
                          aria-invalid={fieldErrors.time ? true : undefined}
                          aria-describedby={
                            [
                              fieldErrors.time ? "pickupTime-error" : null,
                              "pickupTime-hint",
                            ]
                              .filter(Boolean)
                              .join(" ") || undefined
                          }
                        >
                          <SelectValue placeholder="Pilih waktu" />
                        </SelectTrigger>
                        <SelectContent>
                          {timeSlots.map((slot) => (
                            <SelectItem key={slot} value={slot}>
                              {slot}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Select value="" disabled>
                        <SelectTrigger
                          id="pickupTime"
                          aria-required="true"
                          className="checkout-prompt"
                          aria-describedby={
                            [
                              fieldErrors.time ? "pickupTime-error" : null,
                              "pickupTime-hint",
                            ]
                              .filter(Boolean)
                              .join(" ") || undefined
                          }
                        >
                          <SelectValue placeholder="Pilih tanggal dahulu" />
                        </SelectTrigger>
                        <SelectContent />
                      </Select>
                    )}
                    {fieldErrors.time && (
                      <p id="pickupTime-error" className="mt-1 text-sm text-destructive">
                        {fieldErrors.time}
                      </p>
                    )}
                    {pickupDate && dayHours && (
                      <p id="pickupTime-hint" className="mt-1 text-xs text-muted-foreground">
                        Jam operasional: {dayHours.open} - {dayHours.close}
                      </p>
                    )}
                  </div>

                  {/* Pickup summary */}
                  {pickupDate && pickupTime && (
                    <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                      <span className="text-muted-foreground">
                        Pengambilan:
                      </span>{" "}
                      <span className="font-medium">
                        {formatDateLabel(pickupDate)} pukul {pickupTime}
                      </span>
                    </div>
                  )}

                  {/* Pickup estimate disclaimer (neutral, bukan warning) */}
                  <div className="flex items-start gap-2 rounded-lg border bg-muted/30 p-3">
                    <p className="flex-1 text-sm leading-relaxed text-muted-foreground">
                      Tanggal dan jam pickup hanya estimasi, bukan janji temu.
                    </p>
                    <InfoHint label="Tentang estimasi pickup">
                      Toko memakai tanggal dan jam ini untuk menyiapkan
                      pesanan. Pastikan email dan nomor telepon aktif agar toko
                      dapat menghubungi kamu.
                    </InfoHint>
                  </div>
                </div>
                  </>
                )}

                {/* Kontak pemesan tinggal di langkah ini: pickup diisi di sini,
                    delivery memakai email akun + telepon penerima alamat. */}
                <section aria-labelledby="checkout-contact-title" className="mt-6 space-y-4 border-t pt-6">
                  <div>
                    <h3 id="checkout-contact-title" className="text-base font-semibold">Kontak Pemesan</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {fulfillmentMethod === "pickup"
                        ? "Untuk pesanan dan pengambilan di cabang."
                        : "Email akun untuk konfirmasi. Pengiriman memakai nama dan nomor penerima pada alamat di atas."}
                    </p>
                  </div>

                  {fulfillmentMethod === "pickup" ? (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <Label htmlFor="phone" className="mb-1.5 block">Nomor Telepon *</Label>
                        <Input
                          id="phone"
                          ref={phoneRef}
                          className="checkout-prompt"
                          type="tel"
                          autoComplete="tel"
                          placeholder="081234567890"
                          required
                          aria-required="true"
                          aria-invalid={fieldErrors.phone ? true : undefined}
                          aria-describedby={
                            [
                              "phone-hint",
                              fieldErrors.phone ? "phone-error" : null,
                            ]
                              .filter(Boolean)
                              .join(" ")
                          }
                          value={phone}
                          onChange={(e) => setPhone(e.target.value)}
                        />
                        <p id="phone-hint" className="mt-1.5 text-xs text-muted-foreground">Aktif dan bisa dihubungi.</p>
                        {fieldErrors.phone && (
                          <p id="phone-error" className="mt-1 text-sm text-destructive">{fieldErrors.phone}</p>
                        )}
                      </div>
                      <div>
                        <Label htmlFor="email" className="mb-1.5 block">Email *</Label>
                        <Input
                          id="email"
                          ref={emailRef}
                          className="checkout-prompt"
                          type="email"
                          autoComplete="email"
                          placeholder="anda@email.com"
                          required
                          aria-required="true"
                          aria-invalid={fieldErrors.email ? true : undefined}
                          aria-describedby={
                            [
                              "email-hint",
                              fieldErrors.email ? "email-error" : null,
                            ]
                              .filter(Boolean)
                              .join(" ")
                          }
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                        />
                        <div className="mt-1.5 flex items-start gap-1">
                          <p id="email-hint" className="text-xs text-muted-foreground">Untuk konfirmasi dan kode pickup.</p>
                          <InfoHint label="Tentang email pickup" className="-my-1">
                            Kode pickup dikirim ke email ini setelah pesanan
                            siap. Email juga dipakai untuk konfirmasi pesanan
                            dan pembayaran.
                          </InfoHint>
                        </div>
                        {fieldErrors.email && (
                          <p id="email-error" className="mt-1 text-sm text-destructive">{fieldErrors.email}</p>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <span className="mb-1.5 block text-sm font-medium">Nomor Telepon Penerima</span>
                        <div className="flex items-start gap-1">
                          <div className="min-w-0 flex-1">
                            <ReadOnlyInput
                              id="contactPhone"
                              value={deliveryAddressPreview?.phone ?? ""}
                              hint="Dari alamat penerima."
                            />
                          </div>
                          <InfoHint label="Tentang nomor penerima" className="mt-2">
                            Nomor mengikuti alamat pengiriman yang dipilih. Ubah
                            nomor di Buku Alamat atau gunakan alamat baru.
                          </InfoHint>
                        </div>
                      </div>
                      <div>
                        <span className="mb-1.5 block text-sm font-medium">Email Akun</span>
                        <div className="flex items-start gap-1">
                          <div className="min-w-0 flex-1">
                            <ReadOnlyInput
                              id="contactEmail"
                              value={email || sessionUser?.email || ""}
                              hint="Untuk konfirmasi pesanan."
                            />
                          </div>
                          <InfoHint label="Tentang email akun" className="mt-2">
                            Email akun dipakai untuk konfirmasi pesanan dan
                            pembayaran.
                          </InfoHint>
                        </div>
                      </div>
                    </div>
                  )}

                  {contactError && (
                    <p className="text-sm text-destructive">{contactError}</p>
                  )}

                  {fulfillmentMethod === "pickup" && canFillFromProfile && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        if (sessionUser?.phone) setPhone(sessionUser.phone);
                        if (sessionUser?.email) setEmail(sessionUser.email);
                      }}
                    >
                      Isi dari Profil
                    </Button>
                  )}
                </section>

                {taxFeedback ? (
                  <CheckoutTaxFeedback
                    message={taxFeedback}
                    busy={reviewing || submitting}
                    onReviewAgain={() => { setTaxFeedback(null); void goToPayment(); }}
                  />
                ) : null}

                <div className="mt-6 flex justify-end">
                  <Button
                    onClick={() => void handleNextFromFulfillment()}
                    className="gap-2"
                    disabled={
                      reviewing ||
                      (fulfillmentMethod === "delivery" &&
                        (deliveryPending || deliveryAddressPending || !deliveryService))
                    }
                  >
                    {reviewing ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" /> Memeriksa…
                      </>
                    ) : (
                      <>
                        Lanjut <ArrowRight className="h-4 w-4" />
                      </>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Step 2 — Review & Place Order */}
          {step === 2 && (
            <Card>
              <CardContent className="p-6">
                {fulfillmentMethod === "delivery" && repriceShown && <p role="alert" className={`mb-4 rounded-lg border p-3 text-sm font-medium ${getStatusToneClassName("progress")}`}>{REPRICE_MESSAGE}</p>}
                {needsRereview && (
                  <div role="alert" className={`mb-4 space-y-2 rounded-lg border border-l-4 border-l-[color:var(--status-progress-foreground)] p-3 text-sm ${getStatusToneClassName("progress")}`}>
                    <p className="font-medium">Rincian pesanan perlu diperiksa ulang</p>
                    <p className="opacity-90">
                      {promoInvalidation?.message ? `${promoInvalidation.message} ` : ""}
                      Periksa ulang untuk memakai total terbaru sebelum membayar.
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void goToPayment()}
                      disabled={reviewing || promoPendingOfferId != null}
                    >
                      {reviewing ? "Memeriksa…" : "Periksa ulang pesanan"}
                    </Button>
                  </div>
                )}
                <h2 className="text-xl font-bold mb-1">Pembayaran</h2>
                <p className="text-sm text-muted-foreground mb-6">
                  Periksa pesanan, lalu lanjut ke pembayaran.
                </p>

                {/* Order summary */}
                <div className="space-y-3 mb-6">
                  <h3 className="font-semibold">Ringkasan Pesanan</h3>
                  {appliedPromo && (
                    <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm">
                      Promo dipakai: <span className="font-medium">{appliedPromo.name}</span> · potongan Rp{" "}
                      {Number(appliedPromo.benefitAmount).toLocaleString("id-ID")}
                    </div>
                  )}
                  {selectedItems.map((item) => (
                    <div
                      key={item.id}
                      className="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-x-3 gap-y-2 rounded-lg border p-3 sm:flex sm:items-center"
                    >
                      <div className="h-14 w-14 rounded-md bg-secondary/50 flex-shrink-0 relative overflow-hidden">
                        {item.image && (
                          <Image
                            src={item.image}
                            alt={item.product.name}
                            fill
                            className="object-cover"
                          />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="break-words text-sm font-medium">
                          {item.product.name}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {[item.variant.color, item.variant.size]
                            .filter(Boolean)
                            .join(" / ")}{" "}
                          · Qty {item.quantity}
                        </div>
                      </div>
                      <div className="col-start-2 min-w-0 break-words text-sm font-medium">
                        Rp{" "}
                        {(
                          parseFloat(item.variant.price) * item.quantity
                        ).toLocaleString("id-ID")}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Fulfillment and contact are separate, scannable groups. */}
                <section className="mb-6 rounded-lg border p-4 sm:p-5">
                  <h3 className="mb-4 font-semibold">
                    {fulfillmentMethod === "delivery" ? "Detail Pengiriman" : "Detail Pengambilan"}
                  </h3>
                  {fulfillmentMethod === "delivery" && deliveryAddressPreview && (
                    <div className="mb-4 space-y-1 break-words text-sm leading-relaxed">
                      <p className="text-xs font-medium text-muted-foreground">Penerima Pengiriman</p>
                      <p className="font-medium">{deliveryAddressPreview.recipientName}</p>
                      <p>{deliveryAddressPreview.phone}</p>
                      <p>{deliveryAddressPreview.fullAddress}</p>
                      <p className="text-muted-foreground">Kode pos {deliveryAddressPreview.postalCode}</p>
                    </div>
                  )}
                  <dl className="grid gap-4 border-t pt-4 text-sm sm:grid-cols-2">
                    <div className="min-w-0 space-y-1">
                      <dt className="text-xs text-muted-foreground">
                        {fulfillmentMethod === "delivery" ? "Dikirim dari" : "Cabang pengambilan"}
                      </dt>
                      <dd className="break-words font-medium">{branch?.name ?? "-"}</dd>
                    </div>
                    <div className="min-w-0 space-y-1">
                      <dt className="text-xs text-muted-foreground">
                        {fulfillmentMethod === "delivery" ? "Layanan kurir" : "Estimasi Pickup"}
                      </dt>
                      <dd className="break-words font-medium">
                        {fulfillmentMethod === "delivery"
                          ? deliveryService
                            ? `${deliveryService.name} · ${formatDeliveryEta(deliveryService.validEta)}`
                            : "-"
                          : `${formatDateLabel(pickupDate)} · ${pickupTime}`}
                      </dd>
                    </div>
                  </dl>
                </section>

                <section className="mb-6 rounded-lg border p-4 sm:p-5">
                  <h3 className="mb-4 font-semibold">Kontak Pemesan</h3>
                  <dl className="grid gap-4 text-sm sm:grid-cols-2">
                    <div className="min-w-0 space-y-1">
                      <dt className="text-xs text-muted-foreground">Telepon</dt>
                      <dd className="break-words font-medium">{phone}</dd>
                    </div>
                    <div className="min-w-0 space-y-1">
                      <dt className="text-xs text-muted-foreground">Email</dt>
                      <dd className="break-words font-medium">{email}</dd>
                    </div>
                  </dl>
                </section>

                {/* One promo slot for pickup and delivery. */}
                {cart?.pricingContractVersion === 1 && (
                  <>
                    <PromoSelector
                      active={appliedManualCode && !promoInvalidation
                        ? { name: appliedManualCode.code, benefitAmount: review?.promo.benefitAmount ?? String(review?.pricing.discount ?? "0") }
                        : appliedPromo}
                      invalidated={promoInvalidation}
                      invalidationTotals={promoInvalidation?.previousTotal ? { before: Number(promoInvalidation.previousTotal), after: total } : null}
                      disabled={submitting || promoPendingOfferId !== null}
                      onOpen={() => changePromoOpen(true)}
                      onClear={() => void handleSelectOffer(null)}
                      onContinueWithout={() => void handleContinueWithoutPromo()}
                    />
                    {promoOpen && <PromoSelectionDialog
                      open={promoOpen} onOpenChange={changePromoOpen} contextKey={promoContextKey}
                      active={requestPromoSelection()} activeName={appliedManualCode?.code ?? appliedPromo?.name ?? ""}
                      data={promoData} loading={promoLoading} error={promoError}
                      onPageChange={page => void loadPromos(page)}
                      onCheckCode={code => preparePromo({ kind: "manual", code }, false)}
                      onUsePromo={draft => preparePromo(draft, true)}
                      onConfirmIncrease={confirmPreparedPromo}
                      onCancelIncrease={() => { preparedPromo.current = null; }}
                      onRetry={() => void loadPromos(promoData?.page ?? 1)}
                    />}
                  </>
                )}
                {/* Pickup reminder — satu baris netral + detail di InfoHint. */}
                {fulfillmentMethod === "pickup" && (
                  <div className="mb-6 flex items-start gap-2 rounded-lg border bg-muted/30 p-3">
                    <p className="flex-1 text-sm text-muted-foreground">
                      Pickup hanya estimasi. Saat mengambil, sebutkan nomor
                      telepon dan email pesanan.
                    </p>
                    <InfoHint label="Tentang estimasi pickup">
                      Toko memakai tanggal dan jam ini untuk menyiapkan
                      pesanan; ini bukan janji temu.
                    </InfoHint>
                  </div>
                )}

                {/* Price breakdown: original shipping minus subsidy exactly once. */}
                <section aria-labelledby="payment-breakdown-title" className="mb-6 space-y-3 rounded-lg bg-muted/50 p-4 sm:p-5">
                  <h3 id="payment-breakdown-title" className="mb-4 font-semibold">Rincian Pembayaran</h3>
                  <div className="flex flex-wrap justify-between gap-x-3 text-sm">
                    <span className="text-muted-foreground">
                      Subtotal ({selectedItems.length} barang)
                    </span>
                    <span>Rp {subtotal.toLocaleString("id-ID")}</span>
                  </div>
                  {Number(pricing.discount) > 0 && (
                    <div className="flex flex-wrap justify-between gap-x-3 text-sm">
                      <span className="text-muted-foreground">Diskon promo</span>
                      <span className="text-[color:var(--status-success-foreground)]">
                        - Rp {Number(pricing.discount).toLocaleString("id-ID")}
                      </span>
                    </div>
                  )}
                  <div className="flex flex-wrap justify-between gap-x-3 text-sm">
                    <span className="text-muted-foreground">PPN ({pricing.ppnRatePercent}%)</span>
                    <span>Rp {Number(pricing.ppnAmount).toLocaleString("id-ID")}</span>
                  </div>
                  <div className="flex flex-wrap justify-between gap-x-3 text-sm">
                    <span className="text-muted-foreground">Ongkos Kirim</span>
                    {fulfillmentMethod === "delivery" && deliveryService ? (
                      <span className="shrink-0">
                        Rp {Number(pricing.shippingBeforeSubsidy ?? deliveryService.shippingCost).toLocaleString("id-ID")}
                      </span>
                    ) : (
                      <span className="min-w-0 break-words">Gratis (Pickup)</span>
                    )}
                  </div>
                  {Number(pricing.shippingSubsidy ?? 0) > 0 && (
                    <div className="flex flex-wrap justify-between gap-x-3 text-sm">
                      <span className="text-muted-foreground">Subsidi ongkir</span>
                      <span className="text-[color:var(--status-success-foreground)]">
                        - Rp {Number(pricing.shippingSubsidy).toLocaleString("id-ID")}
                      </span>
                    </div>
                  )}
                  {/* A zero service fee is not a charge: the row only exists when
                      the approved pricing actually carries one (legacy rows). */}
                  {Number(pricing.serviceFee) > 0 && (
                    <div className="flex flex-wrap justify-between gap-x-3 text-sm">
                      <span className="text-muted-foreground">Biaya Layanan</span>
                      <span>Rp {Number(pricing.serviceFee).toLocaleString("id-ID")}</span>
                    </div>
                  )}
                  <hr className="border-t border-dashed border-muted-foreground/30 my-2" />
                  <div className="flex flex-wrap justify-between gap-x-3 font-bold">
                    <span>Total Bayar</span>
                    <span className="text-primary">
                      Rp {total.toLocaleString("id-ID")}
                    </span>
                  </div>
                  {promoDelta && (
                    <p role="status" className="text-sm font-medium text-[color:var(--status-success-foreground)]">
                      Total turun Rp{promoDelta.amount.toLocaleString("id-ID")} menjadi Rp{promoDelta.total.toLocaleString("id-ID")}.
                    </p>
                  )}
                </section>

                {/* Confirmation checkbox: label + kebijakan sebagai link
                    terpisah agar membuka tab baru tanpa men-toggle checkbox. */}
                <div className="mb-6 flex items-start gap-3">
                  <input
                    id="checkout-confirm"
                    type="checkbox"
                    checked={confirmed}
                    onChange={(e) => setConfirmed(e.target.checked)}
                    className="mt-1 h-4 w-4 rounded border-input"
                  />
                  <div className="text-sm text-muted-foreground">
                    <label htmlFor="checkout-confirm" className="cursor-pointer">
                      {fulfillmentMethod === "delivery"
                        ? "Saya telah memeriksa alamat penerima, layanan pengiriman dan total pesanan, serta menyetujui"
                        : "Saya telah memeriksa pesanan dan menyetujui"}
                    </label>{" "}
                    <a
                      href="/pages/terms"
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label="Syarat & ketentuan (terbuka di tab baru)"
                      className="font-medium text-primary underline underline-offset-2 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    >
                      Syarat &amp; ketentuan
                    </a>
                    {fulfillmentMethod === "pickup"
                      ? ". Saat mengambil, saya akan menyebutkan nomor telepon dan email pesanan."
                      : "."}
                  </div>
                </div>

                {taxFeedback ? (
                  <CheckoutTaxFeedback
                    message={taxFeedback}
                    busy={reviewing || submitting}
                    onReviewAgain={() => { setTaxFeedback(null); void goToPayment(); }}
                  />
                ) : null}

                {attemptFeedback ? (
                  <CheckoutAttemptFeedback
                    result={attemptFeedback}
                    busy={submitting}
                    checkState={checkState}
                    onCheckStatus={() => void recoverPendingRequest()}
                    onReviewAgain={() => { setAttemptFeedback(null); setSubmitError(null); setCheckState("idle"); setConfirmed(false); setReview(null); setStep(1); }}
                  />
                ) : null}
                {lookupNotice && (
                  <p role="alert" className={`mb-4 rounded-lg border p-3 text-sm font-medium ${getStatusToneClassName("progress")}`}>
                    {lookupNotice}
                  </p>
                )}
                {submitError && (
                  <div
                    ref={submitErrorRef}
                    role="alert"
                    tabIndex={-1}
                    className="mb-4 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <p className="flex items-start gap-2 font-medium text-destructive">
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                      {submitError}
                    </p>
                    {pendingRequest && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="mt-3"
                        disabled={submitting}
                        onClick={() => void recoverPendingRequest()}
                      >
                        Periksa status checkout
                      </Button>
                    )}
                  </div>
                )}
                <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
                  <Button variant="outline" disabled={submitting || promoPendingOfferId != null} onClick={() => {
                    setConfirmed(false);
                    setStep(1);
                  }}>
                    Kembali
                  </Button>
                  <Button
                    onClick={handlePlaceOrder}
                    disabled={!confirmed || submitting || promoBlocked || needsRereview}
                    className="gap-2"
                    size="lg"
                  >
                    {submitting ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" /> Memproses...
                      </>
                    ) : (
                      <>
                        Bayar Sekarang <ArrowRight className="h-4 w-4" />
                      </>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

      </div>

      {/* Ticket 08 — dialog kenaikan total saat mengganti promo. Kandidat ditahan
          server-side; Batal mempertahankan pilihan dan total lama. */}
      <Dialog
        open={promoReplacement != null}
        onOpenChange={(open) => {
          if (!open) setPromoReplacement(null);
        }}
      >
        <DialogContent closeButtonSize="comfortable">
          <DialogHeader>
            <DialogTitle>Total pesanan naik</DialogTitle>
            <DialogDescription>
              Mengganti promo membuat total final lebih tinggi. Pilihan promo
              kamu yang sekarang tetap berlaku sampai kamu mengonfirmasi.
            </DialogDescription>
          </DialogHeader>
          {promoReplacement?.data.replacement && (
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Total sekarang</dt>
                <dd>
                  Rp{" "}
                  {Number(
                    promoReplacement.data.replacement.previous.total ?? 0
                  ).toLocaleString("id-ID")}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Total setelah ganti</dt>
                <dd>
                  Rp{" "}
                  {Number(
                    promoReplacement.data.replacement.candidate.total
                  ).toLocaleString("id-ID")}
                </dd>
              </div>
              <div className="flex justify-between gap-3 font-semibold">
                <dt>Selisih</dt>
                <dd className="text-destructive">
                  + Rp{" "}
                  {Number(
                    promoReplacement.data.replacement.deltaTotal ?? 0
                  ).toLocaleString("id-ID")}
                </dd>
              </div>
            </dl>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setPromoReplacement(null)}>
              Batal
            </Button>
            <Button onClick={handleConfirmPromoReplacement}>
              Ya, ganti promo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
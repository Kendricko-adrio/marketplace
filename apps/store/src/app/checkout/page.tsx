"use client";
import { useState, useEffect, useMemo, useRef, useCallback } from "react";
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
import { Badge } from "@/components/ui/badge";
import { ReadOnlyInput } from "@/components/ui/read-only-input";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Clock,
  CreditCard,
  Loader2,
  MapPin,
  Calendar,
  TriangleAlert,
} from "lucide-react";
import { useSession } from "@/lib/auth-client";
import { useCart } from "@/providers/cart-provider";
import DeliveryQuotePanel, { type DeliveryAddressPreview } from "@/components/checkout/DeliveryQuotePanel";
import { PromoSelector, type AvailableOffer, type PromoInvalidation } from "@/components/checkout/PromoSelector";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { DeliveryQuoteService } from "@/lib/delivery-quote";
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

  // Selected item IDs — passed from the cart page via sessionStorage.
  // The cart page enforces single-branch selection before navigating here.
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(
    new Set()
  );

  // Step 2 — Contact
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [contactError, setContactError] = useState("");

  // Step 2 — Coupon publik pickup (ticket 07). Read-only list; the server
  // re-evaluates capacity authoritatively at preview and place-order. Ticket 08
  // menambah penggantian (dialog hanya saat total naik) dan state gugur yang
  // tidak pernah menghapus pilihan diam-diam.
  const [promoOffers, setPromoOffers] = useState<AvailableOffer[]>([]);
  const [promoLoading, setPromoLoading] = useState(false);
  const [promoError, setPromoError] = useState<string | null>(null);
  const [selectedOfferId, setSelectedOfferId] = useState<string | null>(null);
  const selectedOfferIdRef = useRef<string | null>(null);
  // Manual Promo Code (ticket 09): literal hanya hidup di state browser ini dan
  // dikirim lewat Terapkan; setiap review menyimpan identitas codeId.
  const [appliedManualCode, setAppliedManualCode] = useState<AppliedManualCode | null>(null);
  const appliedManualCodeRef = useRef<AppliedManualCode | null>(null);
  const [manualCodeError, setManualCodeError] = useState<string | null>(null);
  const [promoInvalidation, setPromoInvalidation] = useState<PromoInvalidation | null>(null);
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
  const [pickupError, setPickupError] = useState("");
  // Only the latest validation of unchanged fulfillment inputs may advance.
  const pickupValidationGeneration = useRef(0);

  // Step 3 — Review
  const [confirmed, setConfirmed] = useState(false);
  const [review, setReview] = useState<CheckoutReview | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [pendingRequest, setPendingRequest] = useState<PendingCheckout | null>(null);
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
  const [deliveryNewAddress, setDeliveryNewAddress] = useState<import("@/lib/client-addresses").ClientAddressInput | null>(null);
  const [deliverySaveAddress, setDeliverySaveAddress] = useState(false);
  const [saveRequestId, setSaveRequestId] = useState(() => crypto.randomUUID());
  const newAddressFingerprint = useRef<string | null>(null);
  const handleNewAddressChange = useCallback((value: import("@/lib/client-addresses").ClientAddressInput | null) => {
    const fingerprint = value ? JSON.stringify(value) : null;
    if (fingerprint !== newAddressFingerprint.current) {
      newAddressFingerprint.current = fingerprint;
      setSaveRequestId(crypto.randomUUID());
    }
    setDeliveryNewAddress(value);
  }, []);
  const [deliveryAddressPreview, setDeliveryAddressPreview] = useState<DeliveryAddressPreview | null>(null);
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
            if (!cancelled && result.success && result.data?.orderId) {
              if (requestStorageKey) sessionStorage.removeItem(requestStorageKey);
              router.replace(`/account/orders/${result.data.orderId}`);
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
  const loadPromos = useCallback(async () => {
    if (
      cart?.pricingContractVersion !== 1 ||
      selectedItems.length === 0
    ) {
      setPromoOffers([]);
      setPromoError(null);
      setPromoLoading(false);
      return;
    }
    setPromoLoading(true);
    setPromoError(null);
    try {
      const response = await fetch("/api/discounts/available", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          selectedItemIds: selectedItems.map((item) => item.id),
          fulfillmentMethod,
          // Hanya untuk menampilkan eligibility subsidi ongkir; server
          // menghitung ulang dengan quote baru di preview/place-order.
          ...(fulfillmentMethod === "delivery" && deliveryService
            ? { shippingBeforeSubsidy: deliveryService.shippingCost }
            : {}),
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        // Jangan mengosongkan daftar/pilihan yang sudah ditampilkan: error
        // jaringan bukan bukti bahwa promo gugur.
        setPromoError(result?.error ?? "Promo belum dapat dimuat.");
        return;
      }
      const offers: AvailableOffer[] = result.data?.items ?? [];
      setPromoOffers(offers);
      const active = selectedOfferIdRef.current;
      if (!active) {
        // Manual Promo Code tidak dapat di-discovery dari daftar publik; state
        // gugurnya hanya datang dari server (previous invalid), bukan dari
        // ketidakhadiran di picker.
        if (!appliedManualCodeRef.current) setPromoInvalidation(null);
        return;
      }
      const match = offers.find((offer) => offer.offerId === active) ?? null;
      if (!match) {
        setPromoInvalidation({
          offerId: active,
          message: "Promo ini sudah tidak tersedia untuk pesanan kamu.",
        });
      } else if (!match.eligible) {
        setPromoInvalidation({
          offerId: active,
          message:
            match.reasonMessage ?? "Promo ini belum memenuhi syarat pesanan kamu.",
        });
      } else {
        setPromoInvalidation(null);
      }
    } catch {
      setPromoError("Promo belum dapat dimuat.");
    } finally {
      setPromoLoading(false);
    }
  }, [fulfillmentMethod, deliveryService, cart?.pricingContractVersion, selectedItems]);

  useEffect(() => {
    if (step >= 2) void loadPromos();
  }, [step, loadPromos]);

  // Order contact is required for both methods, independently of the
  // delivery recipient. Submit the same trimmed values that were validated.
  const validateContact = (): boolean => {
    const trimmedPhone = phone.trim();
    const phoneDigits = trimmedPhone.replace(/\D/g, "");
    if (
      !trimmedPhone ||
      phoneDigits.length < 8 ||
      phoneDigits.length > 15 ||
      trimmedPhone.length > 20
    ) {
      setContactError(
        "Masukkan nomor telepon yang valid (8–15 angka)."
      );
      return false;
    }
    const trimmedEmail = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setContactError(
        "Masukkan alamat email yang valid."
      );
      return false;
    }
    setPhone(trimmedPhone);
    setEmail(trimmedEmail);
    setContactError("");
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
            promoOffers.find((offer) => offer.offerId === review.promo.offerId)?.name ??
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
  const validatePickup = (): boolean => {
    if (!pickupDate) {
      setPickupError("Please select a pickup date.");
      return false;
    }
    if (!pickupTime) {
      setPickupError("Please select a pickup time.");
      return false;
    }
    if (!dayHours) {
      setPickupError("Branch is closed on the selected day.");
      return false;
    }
    if (!timeSlots.includes(pickupTime)) {
      setPickupError(
        `Pickup time must be between ${dayHours.open} and ${dayHours.close}.`
      );
      return false;
    }
    setPickupError("");
    return true;
  };

  // Step 1 validates fulfillment AND the order contact before the review is
  // created. The existing pickup endpoint retains its name for compatibility;
  // delivery never sends slots.
  const handleNextFromFulfillment = async () => {
    if (fulfillmentMethod === "delivery") {
      if (deliveryPending || !deliveryService) return;
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
        setPickupError(data.error || "Invalid pickup slot.");
      }
    } catch {
      if (generation !== pickupValidationGeneration.current) return;
      setPickupError("Failed to validate pickup slot. Please try again.");
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
      ...(deliveryNewAddress ? { newAddress: deliveryNewAddress, saveAddress: deliverySaveAddress, saveRequestId }
        : { addressId: deliveryAddressId }),
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

  /**
   * Terapkan Manual Promo Code. Validasi selalu lewat preview server (termasuk
   * saat belum ada review) supaya codeId/benefit berasal dari evaluasi
   * authoritative. Kode invalid/kehabisan kapasitas TIDAK mengganti pilihan
   * lama yang masih sah.
   */
  async function handleApplyManualCode(rawCode: string) {
    const code = rawCode.trim();
    if (!code || promoPendingOfferId) return;
    setManualCodeError(null);
    const selection: PromoSelection = { kind: "manual", code };
    setPromoPendingOfferId("manual");
    try {
      const baseIntent = { ...(review ? review.intent : currentIntent()), promoSelection: selection };
      const { result } = await postPreview(
        review
          ? {
              ...baseIntent,
              previous: {
                reviewToken: review.reviewToken,
                promoSelection: promoSelectionOf(review.promo),
              },
            }
          : baseIntent
      );
      if (!result.success) {
        if (result.code === "CHECKOUT_REVIEW_REQUIRED") {
          setReview(null);
          setConfirmed(false);
          setStep(1);
        }
        if (typeof result.code === "string" && result.code.startsWith("PROMO_")) {
          setManualCodeError(String(result.error || "Kode promo belum dapat dipakai."));
          void loadPromos();
        }
        toast.error(result.error || "Kode promo belum dapat dipakai.");
        return;
      }
      const data = result.data as CheckoutPreviewData;
      if (data.requiresIncreaseConfirmation) {
        setPromoReplacement({ data, intent: baseIntent, selection });
        return;
      }
      applyPromoReview(data, baseIntent, selection);
      toast.success("Kode promo diterapkan");
    } catch {
      // Jaringan gagal bukan bukti kode gugur: state lama dipertahankan.
      setManualCodeError("Kode promo belum dapat diperiksa. Coba lagi.");
    } finally {
      setPromoPendingOfferId(null);
    }
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
    if (fulfillmentMethod === "delivery" && (deliveryPending || !deliveryService)) { setStep(1); return; }
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
          toast.error(result.error || "Review checkout belum tersedia.");
          if (typeof result.code === "string" && result.code.startsWith("PROMO_")) {
            void loadPromos();
          }
          return;
        }
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

  async function submitVersioned(record: PendingCheckout) {
    try {
      const response = await fetch("/api/checkout/place-order", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(record.body),
      });
      const result = await response.json();
      if (result.success && result.data?.orderId) {
        clearPendingRequest();
        refreshCart();
        if (result.data.paymentAvailable && result.data.redirectUrl) window.location.href = result.data.redirectUrl;
        else router.push(`/account/orders/${result.data.orderId}`);
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
        // Alasan aman dari server tetap ditampilkan sebagai state gugur; promo
        // tidak diganti otomatis dan order tanpa promo tidak dibuat diam-diam.
        if (selectedOfferIdRef.current || appliedManualCodeRef.current) {
          setPromoInvalidation({
            offerId:
              selectedOfferIdRef.current ?? appliedManualCodeRef.current!.offerId,
            message: result.error || "Promo tidak lagi berlaku untuk pesanan ini.",
          });
        }
        void loadPromos();
      }
      toast.error(result.error || "Status checkout belum dapat dipastikan. Periksa pesanan yang sama.");
    } catch {
      // Jangan ganti key/intent setelah response hilang. Panel recovery tetap tersedia.
      toast.error("Koneksi terputus. Periksa status pesanan sebelum mencoba lagi.");
    }
  }

  async function recoverPendingRequest() {
    if (!pendingRequest || requestInFlight.current) return;
    requestInFlight.current = true; setSubmitting(true);
    try {
      const response = await fetch(`/api/checkout/requests/${pendingRequest.requestKey}`, { cache: "no-store" });
      const result = await response.json();
      if (result.success && result.data?.orderId) {
        clearPendingRequest(); router.push(`/account/orders/${result.data.orderId}`); refreshCart(); return;
      }
      if (response.status === 404) await submitVersioned(pendingRequest);
      else toast.error("Status pesanan belum dapat dibaca. Coba periksa kembali.");
    } catch { toast.error("Koneksi belum tersedia. Request checkout tetap tersimpan."); }
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
      if (deliveryPending || !deliveryService || (!deliveryAddressId && !deliveryNewAddress)) return;
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
            ...(deliveryNewAddress ? { newAddress: deliveryNewAddress, saveAddress: deliverySaveAddress, saveRequestId } : { addressId: deliveryAddressId }),
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

  if (pendingRequest) {
    return <div className="container mx-auto max-w-xl px-4 py-16">
      <Card><CardContent className="space-y-4 pt-6">
        <h1 className="text-2xl font-bold">Periksa status pesanan</h1>
        <p>Request checkout tersimpan. Kami akan mencari pesanan yang sama, tanpa membuat pesanan atau pembayaran pengganti otomatis.</p>
        <Button onClick={recoverPendingRequest} disabled={submitting}>
          {submitting ? "Memeriksa pesanan…" : "Periksa pesanan"}
        </Button>
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
        <p role="alert" className="mb-6 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm font-medium text-amber-900 dark:bg-amber-950/50 dark:text-amber-100">
          {stockAdjustmentMessage}
        </p>
      )}

      {/* Step Indicator */}
      <div className="mb-8">
        <div className="flex items-center justify-between">
          {[
            { num: 1, label: "Cara Pengiriman", icon: MapPin },
            { num: 2, label: "Bayar & Pesan", icon: CreditCard },
          ].map((s, i) => (
            <div key={s.num} className="flex items-center flex-1 last:flex-none">
              <div className="flex items-center gap-2">
                <div
                  className={`flex h-9 w-9 items-center justify-center rounded-full border-2 text-sm font-medium ${
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
                  className={`text-sm font-medium hidden sm:inline ${
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
                    ? "Pilih alamat pengiriman, lalu periksa ongkir untuk melihat layanan yang tersedia."
                    : "Pilih perkiraan tanggal dan waktu kedatangan Anda untuk mengambil pesanan."}
                </p>

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
                      <div key={item.id} className="flex justify-between text-sm">
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
                      <p className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm font-medium text-amber-900 dark:bg-amber-950/50 dark:text-amber-100">
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
                      onNewAddressChange={handleNewAddressChange}
                      onSaveAddressChange={setDeliverySaveAddress}
                      initialAddressId={deliveryAddressId}
                      initialNewAddress={deliveryNewAddress}
                      initialSaveAddress={deliverySaveAddress}
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
                      <div className="font-semibold">{branch?.name ?? "-"}</div>
                      <div className="text-sm text-muted-foreground">
                        {branch?.address ?? "-"}
                        {branch?.city ? `, ${branch.city}` : ""}
                      </div>
                    </div>
                    <Badge variant="secondary" className="ml-3 shrink-0 whitespace-nowrap">
                      Cabang Terpilih
                    </Badge>
                  </div>
                </div>

                <div className="space-y-4">
                  <div>
                    <Label htmlFor="pickupDate" className="flex items-center gap-2 mb-1.5">
                      <Calendar className="h-4 w-4" /> Tanggal Pickup *
                    </Label>
                    <Input
                      id="pickupDate"
                      type="date"
                      min={todayStr}
                      value={pickupDate}
                      onChange={(e) => {
                        pickupValidationGeneration.current += 1;
                        setPickupDate(e.target.value);
                        setPickupTime(""); // reset time when date changes
                      }}
                    />
                    {selectedDate && !dayHours && (
                      <p className="mt-1 text-sm text-destructive">
                        Cabang tutup pada tanggal ini. Pilih tanggal lain.
                      </p>
                    )}
                  </div>

                  <div>
                    <Label className="flex items-center gap-2 mb-1.5">
                      <Clock className="h-4 w-4" /> Waktu Pickup *
                    </Label>
                    {pickupDate && dayHours ? (
                      <Select
                        value={pickupTime}
                        onValueChange={(value) => {
                          pickupValidationGeneration.current += 1;
                          setPickupTime(value);
                        }}
                      >
                        <SelectTrigger>
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
                        <SelectTrigger>
                          <SelectValue placeholder="Pilih tanggal dahulu" />
                        </SelectTrigger>
                        <SelectContent />
                      </Select>
                    )}
                    {pickupDate && dayHours && (
                      <p className="mt-1 text-xs text-muted-foreground">
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

                  {/* Pickup estimate disclaimer (warning-styled) */}
                  <div className="flex items-start gap-3 rounded-lg border border-amber-200 border-l-4 border-l-amber-500 bg-amber-50 p-4 dark:border-amber-800 dark:border-l-amber-500 dark:bg-amber-950/50">
                    <TriangleAlert className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600 dark:text-amber-400" />
                    <p className="text-sm leading-relaxed text-amber-900 dark:text-amber-100">
                      <span className="font-semibold">
                        Tanggal dan waktu pickup hanya estimasi
                      </span>{" "}
                      — bukan janji temu yang mengikat. Tujuannya agar tim
                      toko mengetahui perkiraan kedatangan Anda dan dapat
                      menyiapkan pesanan lebih awal. Pastikan email dan nomor
                      telepon Anda aktif agar toko dapat menghubungi Anda bila
                      diperlukan.
                    </p>
                  </div>
                </div>
                  </>
                )}

                {fulfillmentMethod === "pickup" && pickupError && (
                  <p className="mt-4 text-sm text-destructive">{pickupError}</p>
                )}

                {/* Kontak pemesan tinggal di langkah ini: pickup diisi di sini,
                    delivery memakai email akun + telepon penerima alamat. */}
                <section aria-labelledby="checkout-contact-title" className="mt-6 space-y-4 border-t pt-6">
                  <div>
                    <h3 id="checkout-contact-title" className="text-base font-semibold">Kontak Pemesan</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {fulfillmentMethod === "pickup"
                        ? "Isi nomor telepon dan email yang aktif untuk pesanan dan pengambilan di cabang."
                        : "Email akun dipakai untuk konfirmasi pesanan dan pembayaran. Pengiriman memakai nama dan nomor penerima pada alamat di atas."}
                    </p>
                  </div>

                  {fulfillmentMethod === "pickup" ? (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <Label htmlFor="phone" className="mb-1.5 block">Nomor Telepon *</Label>
                        <Input
                          id="phone"
                          type="tel"
                          autoComplete="tel"
                          placeholder="081234567890"
                          value={phone}
                          onChange={(e) => setPhone(e.target.value)}
                        />
                        <p className="mt-1.5 text-xs text-muted-foreground">Nomor aktif yang bisa dihubungi toko.</p>
                      </div>
                      <div>
                        <Label htmlFor="email" className="mb-1.5 block">Email *</Label>
                        <Input
                          id="email"
                          type="email"
                          autoComplete="email"
                          placeholder="anda@email.com"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                        />
                        <p className="mt-1.5 text-xs text-muted-foreground">Kode pickup dikirim ke email ini setelah pesanan siap diambil.</p>
                      </div>
                    </div>
                  ) : (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <span className="mb-1.5 block text-sm font-medium">Nomor Telepon Penerima</span>
                        <ReadOnlyInput
                          id="contactPhone"
                          value={deliveryAddressPreview?.phone ?? ""}
                          hint="Mengikuti nomor telepon pada alamat penerima di atas."
                        />
                      </div>
                      <div>
                        <span className="mb-1.5 block text-sm font-medium">Email Akun</span>
                        <ReadOnlyInput
                          id="contactEmail"
                          value={email || sessionUser?.email || ""}
                          hint="Email akun dipakai untuk konfirmasi pesanan dan pembayaran."
                        />
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

                <div className="mt-6 flex justify-end">
                  <Button
                    onClick={() => void handleNextFromFulfillment()}
                    className="gap-2"
                    disabled={
                      reviewing ||
                      (fulfillmentMethod === "delivery" &&
                        (deliveryPending || !deliveryService))
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
                {fulfillmentMethod === "delivery" && repriceShown && <p role="alert" className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm font-medium text-amber-900">{REPRICE_MESSAGE}</p>}
                {needsRereview && (
                  <div role="alert" className="mb-4 space-y-2 rounded-lg border border-amber-300 border-l-4 border-l-amber-500 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:border-l-amber-500 dark:bg-amber-950/50">
                    <p className="font-medium text-amber-900 dark:text-amber-100">Rincian pesanan perlu diperiksa ulang</p>
                    <p className="text-amber-900/90 dark:text-amber-100/90">
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
                  Periksa pesanan Anda, lalu konfirmasi untuk melanjutkan ke
                  pembayaran via Midtrans.
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
                      <div className="col-start-2 whitespace-nowrap text-sm font-medium sm:shrink-0">
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
                          ? deliveryService?.name ?? "-"
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
                  <PromoSelector
                      appliedManualCode={appliedManualCode}
                      manualCodeError={manualCodeError}
                      manualPending={promoPendingOfferId === "manual"}
                      onApplyManualCode={(code) => void handleApplyManualCode(code)}
                      onClearManual={() => void handleSelectOffer(null)}
                    offers={promoOffers}
                    selectedOfferId={selectedOfferId}
                    invalidated={promoInvalidation}
                    pendingOfferId={promoPendingOfferId}
                    loading={promoLoading}
                    error={promoError}
                    disabled={submitting}
                    onSelect={(offerId) => void handleSelectOffer(offerId)}
                    onClear={() => void handleSelectOffer(null)}
                    onContinueWithout={() => void handleContinueWithoutPromo()}
                    onRetry={() => void loadPromos()}
                  />
                )}
                <div className="mb-6 flex items-center gap-3 rounded-lg border border-primary/20 bg-primary/5 p-4">
                  <CreditCard className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
                  <div>
                    <div className="font-semibold">Pembayaran via Midtrans</div>
                    <div className="text-xs text-muted-foreground">
                      Pilih QRIS, GoPay, VA, atau kartu setelah klik Bayar Sekarang.
                    </div>
                  </div>
                </div>

                {/* Pickup reminders (warning-styled — pickup only) */}
                {fulfillmentMethod === "pickup" && (
                <div className="mb-6 rounded-lg border border-amber-200 border-l-4 border-l-amber-500 bg-amber-50 p-4 dark:border-amber-800 dark:border-l-amber-500 dark:bg-amber-950/50">
                  <div className="flex items-start gap-2.5">
                    <TriangleAlert className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600 dark:text-amber-400" />
                    <p className="text-sm font-medium leading-relaxed text-amber-900 dark:text-amber-100">
                      Sebutkan nomor telepon dan email yang kamu isi kepada staf
                      toko saat Anda datang mengambil pesanan.
                    </p>
                  </div>
                  <div className="mt-2.5 flex items-start gap-2.5 border-t border-amber-200 pt-2.5 dark:border-amber-800">
                    <Clock className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600 dark:text-amber-400" />
                    <p className="text-sm font-medium leading-relaxed text-amber-900 dark:text-amber-100">
                      Tanggal dan waktu pickup bersifat estimasi — hanya untuk
                      memberi tahu toko kapan Anda berencana datang.
                    </p>
                  </div>
                </div>
                )}

                {/* Price breakdown: original shipping minus subsidy exactly once. */}
                <section aria-labelledby="payment-breakdown-title" className="mb-6 space-y-3 rounded-lg bg-muted/50 p-4 sm:p-5">
                  <h3 id="payment-breakdown-title" className="mb-4 font-semibold">Rincian Pembayaran</h3>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">
                      Subtotal ({selectedItems.length} barang)
                    </span>
                    <span>Rp {subtotal.toLocaleString("id-ID")}</span>
                  </div>
                  {Number(pricing.discount) > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Diskon promo</span>
                      <span className="text-green-600">
                        - Rp {Number(pricing.discount).toLocaleString("id-ID")}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">PPN ({pricing.ppnRatePercent}%)</span>
                    <span>Rp {Number(pricing.ppnAmount).toLocaleString("id-ID")}</span>
                  </div>
                  <div className="flex justify-between gap-4 text-sm">
                    <span className="text-muted-foreground">Ongkos Kirim</span>
                    {fulfillmentMethod === "delivery" && deliveryService ? (
                      <span className="shrink-0">
                        Rp {Number(pricing.shippingBeforeSubsidy ?? deliveryService.shippingCost).toLocaleString("id-ID")}
                      </span>
                    ) : (
                      <span className="shrink-0">Gratis (Pickup)</span>
                    )}
                  </div>
                  {Number(pricing.shippingSubsidy ?? 0) > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Subsidi ongkir</span>
                      <span className="text-green-600">
                        - Rp {Number(pricing.shippingSubsidy).toLocaleString("id-ID")}
                      </span>
                    </div>
                  )}
                  {/* A zero service fee is not a charge: the row only exists when
                      the approved pricing actually carries one (legacy rows). */}
                  {Number(pricing.serviceFee) > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Biaya Layanan</span>
                      <span>Rp {Number(pricing.serviceFee).toLocaleString("id-ID")}</span>
                    </div>
                  )}
                  <hr className="border-t border-dashed border-muted-foreground/30 my-2" />
                  <div className="flex justify-between font-bold">
                    <span>Total Bayar</span>
                    <span className="text-primary">
                      Rp {total.toLocaleString("id-ID")}
                    </span>
                  </div>
                </section>

                {/* Confirmation checkbox */}
                <label className="flex items-start gap-3 mb-6 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(e) => setConfirmed(e.target.checked)}
                    className="mt-1 h-4 w-4 rounded border-input"
                  />
                  <span className="text-sm text-muted-foreground">
                    {fulfillmentMethod === "delivery"
                      ? "Saya telah memeriksa alamat penerima, layanan pengiriman dan total pesanan, serta menyetujui syarat & ketentuan."
                      : "Saya telah memeriksa pesanan dan menyetujui syarat & ketentuan. Saya akan mengambil pesanan di cabang terpilih sesuai estimasi waktu yang saya tentukan, dan saya bersedia menyebutkan email serta nomor telepon saya saat pengambilan pesanan di toko."}
                  </span>
                </label>

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
        <DialogContent>
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
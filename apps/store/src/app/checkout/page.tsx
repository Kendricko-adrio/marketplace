"use client";
import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
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
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Loader2,
  MapPin,
  Calendar,
  Clock,
  CreditCard,
  User,
  QrCode,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { useSession } from "@/lib/auth-client";
import {
  getDayHours,
  generateTimeSlots,
  formatDateLabel,
} from "@/lib/pickup-validation";
import type { OperatingHours } from "@/db";

// ===== Types =====
interface CartItem {
  id: string;
  quantity: number;
  variantId: string;
  variant: {
    id: string;
    color: string | null;
    size: string | null;
    price: string;
  };
  product: { id: string; name: string };
  image: string | null;
}

interface CartBranch {
  id: string;
  name: string;
  city: string;
  address: string;
}

interface CartData {
  id: string;
  branch: CartBranch | null;
  items: CartItem[];
  itemCount: number;
  subtotal: number;
}

interface BranchWithHours extends CartBranch {
  operatingHours: OperatingHours;
}

const SERVICE_FEE = 1000;

export default function CheckoutPage() {
  const router = useRouter();
  const { data: session } = useSession();

  // ===== State =====
  const [cart, setCart] = useState<CartData | null>(null);
  const [branch, setBranch] = useState<BranchWithHours | null>(null);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [submitting, setSubmitting] = useState(false);

  // Step 1 — Contact
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [contactError, setContactError] = useState("");

  // Step 2 — Pickup
  const [pickupDate, setPickupDate] = useState("");
  const [pickupTime, setPickupTime] = useState("");
  const [pickupError, setPickupError] = useState("");

  // Step 3 — Review
  const [confirmed, setConfirmed] = useState(false);

  // QRIS payment state
  interface QrPayment {
    orderId: string;
    qrImageUrl: string;
  }
  const [qrPayment, setQrPayment] = useState<QrPayment | null>(null);
  const [paymentStatus, setPaymentStatus] = useState<
    "idle" | "waiting" | "paid" | "failed"
  >("idle");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ===== Fetch cart on mount =====
  useEffect(() => {
    async function fetchCart() {
      try {
        const res = await fetch("/api/cart");
        const data = await res.json();
        if (data.success) {
          setCart(data.data);
          // If cart has no branch or is empty, redirect to cart page
          if (!data.data.branch || data.data.items.length === 0) {
            router.push("/cart");
            return;
          }
          // Fetch full branch details (with operating hours)
          const branchRes = await fetch(
            `/api/branches/${data.data.branch.id}`
          );
          const branchData = await branchRes.json();
          if (branchData.success) {
            setBranch(branchData.data);
          }
        }
      } catch (error) {
        console.error("Error fetching cart:", error);
      } finally {
        setLoading(false);
      }
    }
    fetchCart();
  }, [router]);

  // Pre-fill contact from session
  // Better Auth's client-side useSession type doesn't include custom
  // additional fields (phone), so we cast to access it.
  const sessionUser = session?.user as
    | { name?: string; email?: string; phone?: string }
    | undefined;

  useEffect(() => {
    if (sessionUser) {
      if (!phone && sessionUser.phone) setPhone(sessionUser.phone);
      if (!email && sessionUser.email) setEmail(sessionUser.email);
    }
  }, [sessionUser, phone, email]);

  // ===== Derived values for Step 2 =====
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

  const subtotal = cart?.subtotal ?? 0;
  const total = subtotal + SERVICE_FEE;

  // ===== Step 1 validation =====
  const validateStep1 = (): boolean => {
    if (!phone || phone.length < 8) {
      setContactError("Please enter a valid phone number.");
      return false;
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setContactError("Please enter a valid email address.");
      return false;
    }
    setContactError("");
    return true;
  };

  // ===== Step 2 validation (client-side; server re-validates on place-order) =====
  const validateStep2 = (): boolean => {
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

  // ===== Server-side validation for Step 2 (via validate-step-2 endpoint) =====
  const handleNextFromStep2 = async () => {
    if (!validateStep2() || !branch) return;
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
      if (data.success) {
        setStep(3);
      } else {
        setPickupError(data.error || "Invalid pickup slot.");
      }
    } catch {
      setPickupError("Failed to validate pickup slot. Please try again.");
    }
  };

  // ===== Poll order status to detect QRIS payment =====
  const startPolling = useCallback(
    (orderId: string) => {
      if (pollRef.current) clearInterval(pollRef.current);
      setPaymentStatus("waiting");
      pollRef.current = setInterval(async () => {
        try {
          const res = await fetch(
            `/api/checkout/order-status?orderId=${encodeURIComponent(orderId)}`
          );
          const data = await res.json();
          if (!data.success) return;
          if (data.paymentStatus === "paid") {
            setPaymentStatus("paid");
            if (pollRef.current) {
              clearInterval(pollRef.current);
              pollRef.current = null;
            }
          } else if (
            data.paymentStatus === "failed" ||
            data.status === "cancelled"
          ) {
            setPaymentStatus("failed");
            if (pollRef.current) {
              clearInterval(pollRef.current);
              pollRef.current = null;
            }
          }
        } catch {
          // network blip — keep polling
        }
      }, 3000);
    },
    []
  );

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // Redirect to order detail when payment is confirmed
  useEffect(() => {
    if (paymentStatus === "paid" && qrPayment) {
      const t = setTimeout(() => {
        router.push(`/account/orders/${qrPayment.orderId}`);
      }, 2500);
      return () => clearTimeout(t);
    }
  }, [paymentStatus, qrPayment, router]);

  // ===== Place order =====
  const handlePlaceOrder = async () => {
    if (!confirmed) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/checkout/place-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, email, pickupDate, pickupTime }),
      });
      const data = await res.json();
      if (!data.success) {
        alert(data.error || "Failed to place order.");
        return;
      }
      if (data.mode === "snap" && data.redirectUrl) {
        // Snap mode: redirect to Midtrans Snap payment page
        window.location.href = data.redirectUrl;
      } else if (data.mode === "core" && data.qrImageUrl) {
        // Core mode: show QR code in-app and start polling for payment
        setQrPayment({ orderId: data.orderId, qrImageUrl: data.qrImageUrl });
        startPolling(data.orderId);
      } else {
        alert("Unexpected payment response. Please try again.");
      }
    } catch {
      alert("An error occurred. Please try again.");
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

  // ===== Empty cart redirect =====
  if (!cart || cart.items.length === 0 || !branch) {
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

      {/* Step Indicator */}
      <div className="mb-8">
        <div className="flex items-center justify-between">
          {[
            { num: 1, label: "Kontak", icon: User },
            { num: 2, label: "Ambil di Toko", icon: MapPin },
            { num: 3, label: "Bayar & Pesan", icon: CreditCard },
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
              {i < 2 && (
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Main step content */}
        <div className="lg:col-span-2">
          {/* Step 1 — Contact Information */}
          {step === 1 && (
            <Card>
              <CardContent className="p-6">
                <h2 className="text-xl font-bold mb-1">Informasi Kontak</h2>
                <p className="text-sm text-muted-foreground mb-6">
                  Kami akan mengirimkan kode pickup dan konfirmasi pesanan ke
                  email Anda.
                </p>

                <div className="space-y-4">
                  <div>
                    <Label htmlFor="phone">Nomor Telepon *</Label>
                    <Input
                      id="phone"
                      type="tel"
                      placeholder="081234567890"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label htmlFor="email">Email *</Label>
                    <Input
                      id="email"
                      type="email"
                      placeholder="anda@email.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </div>
                </div>

                {contactError && (
                  <p className="mt-4 text-sm text-destructive">{contactError}</p>
                )}

                {sessionUser?.phone && sessionUser?.email && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-4"
                    onClick={() => {
                      setPhone(sessionUser.phone || "");
                      setEmail(sessionUser.email || "");
                    }}
                  >
                    Isi dari Profil
                  </Button>
                )}

                <div className="mt-6 flex justify-end">
                  <Button
                    onClick={() => validateStep1() && setStep(2)}
                    className="gap-2"
                  >
                    Lanjut <ArrowRight className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Step 2 — Pickup Branch & Time */}
          {step === 2 && (
            <Card>
              <CardContent className="p-6">
                <h2 className="text-xl font-bold mb-1">Ambil di Toko</h2>
                <p className="text-sm text-muted-foreground mb-6">
                  Pilih tanggal dan waktu untuk pengambilan pesanan Anda.
                </p>

                {/* Branch info (read-only — locked from cart) */}
                <div className="mb-6 rounded-lg border border-primary/20 bg-primary/5 p-4">
                  <div className="flex items-start gap-3">
                    <MapPin className="mt-0.5 h-5 w-5 text-primary" />
                    <div>
                      <div className="font-semibold">{branch.name}</div>
                      <div className="text-sm text-muted-foreground">
                        {branch.address}, {branch.city}
                      </div>
                    </div>
                    <Badge variant="secondary" className="ml-auto">
                      Cabang Terpilih
                    </Badge>
                  </div>
                </div>

                <div className="space-y-4">
                  <div>
                    <Label htmlFor="pickupDate" className="flex items-center gap-2">
                      <Calendar className="h-4 w-4" /> Tanggal Pickup *
                    </Label>
                    <Input
                      id="pickupDate"
                      type="date"
                      min={todayStr}
                      value={pickupDate}
                      onChange={(e) => {
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
                    <Label className="flex items-center gap-2">
                      <Clock className="h-4 w-4" /> Waktu Pickup *
                    </Label>
                    {pickupDate && dayHours ? (
                      <Select
                        value={pickupTime}
                        onValueChange={setPickupTime}
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
                      <Select disabled>
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
                </div>

                {pickupError && (
                  <p className="mt-4 text-sm text-destructive">{pickupError}</p>
                )}

                <div className="mt-6 flex justify-between">
                  <Button variant="outline" onClick={() => setStep(1)}>
                    Kembali
                  </Button>
                  <Button onClick={handleNextFromStep2} className="gap-2">
                    Lanjut <ArrowRight className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Step 3 — Review & Place Order */}
          {step === 3 && (
            <Card>
              <CardContent className="p-6">
                <h2 className="text-xl font-bold mb-1">Pembayaran QRIS</h2>
                <p className="text-sm text-muted-foreground mb-6">
                  Periksa pesanan Anda, lalu konfirmasi untuk melanjutkan ke
                  pembayaran QRIS via Midtrans.
                </p>

                {/* Payment method badge */}
                <div className="mb-6 flex items-center gap-3 rounded-lg border border-primary/20 bg-primary/5 p-4">
                  <CreditCard className="h-6 w-6 text-primary" />
                  <div>
                    <div className="font-semibold">QRIS</div>
                    <div className="text-xs text-muted-foreground">
                      Bayar dengan scan QR code via e-wallet atau m-banking
                    </div>
                  </div>
                </div>

                {/* Order summary */}
                <div className="space-y-3 mb-6">
                  <h3 className="font-semibold">Ringkasan Pesanan</h3>
                  {cart.items.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center gap-3 rounded-lg border p-3"
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
                        <div className="text-sm font-medium line-clamp-1">
                          {item.product.name}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {[item.variant.color, item.variant.size]
                            .filter(Boolean)
                            .join(" / ")}{" "}
                          · Qty {item.quantity}
                        </div>
                      </div>
                      <div className="text-sm font-medium">
                        Rp{" "}
                        {(
                          parseFloat(item.variant.price) * item.quantity
                        ).toLocaleString("id-ID")}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Pickup + contact summary */}
                <div className="space-y-2 mb-6 rounded-lg border bg-muted/30 p-4 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Cabang</span>
                    <span className="font-medium">{branch.name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Pickup</span>
                    <span className="font-medium">
                      {formatDateLabel(pickupDate)} · {pickupTime}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Telepon</span>
                    <span className="font-medium">{phone}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Email</span>
                    <span className="font-medium">{email}</span>
                  </div>
                </div>

                {/* Price breakdown */}
                <div className="space-y-2 mb-6">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">
                      Subtotal ({cart.itemCount} barang)
                    </span>
                    <span>Rp {subtotal.toLocaleString("id-ID")}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Biaya Layanan</span>
                    <span>Rp {SERVICE_FEE.toLocaleString("id-ID")}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Ongkos Kirim</span>
                    <span className="text-green-600">Gratis (Pickup)</span>
                  </div>
                  <hr className="border-t border-dashed border-muted-foreground/30 my-2" />
                  <div className="flex justify-between font-bold">
                    <span>Total Bayar</span>
                    <span className="text-primary">
                      Rp {total.toLocaleString("id-ID")}
                    </span>
                  </div>
                </div>

                {/* Confirmation checkbox */}
                <label className="flex items-start gap-3 mb-6 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(e) => setConfirmed(e.target.checked)}
                    className="mt-1 h-4 w-4 rounded border-input"
                  />
                  <span className="text-sm text-muted-foreground">
                    Saya telah memeriksa pesanan dan menyetujui syarat & ketentuan.
                    Saya akan mengambil pesanan di cabang dan waktu yang dipilih.
                  </span>
                </label>

                <div className="flex justify-between">
                  <Button variant="outline" onClick={() => setStep(2)}>
                    Kembali
                  </Button>
                  <Button
                    onClick={handlePlaceOrder}
                    disabled={!confirmed || submitting || !!qrPayment}
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

                {/* ===== QRIS Payment Section (shown after place-order succeeds) ===== */}
                {qrPayment && (
                  <div className="mt-6 rounded-lg border-2 border-primary/30 bg-primary/5 p-6 text-center">
                    {paymentStatus === "paid" ? (
                      <>
                        <CheckCircle2 className="mx-auto mb-3 h-12 w-12 text-green-600" />
                        <h3 className="text-lg font-bold text-green-700">
                          Pembayaran Berhasil!
                        </h3>
                        <p className="mt-2 text-sm text-muted-foreground">
                          Pesanan Anda sedang diproses. Anda akan diarahkan
                          ke halaman pesanan...
                        </p>
                      </>
                    ) : paymentStatus === "failed" ? (
                      <>
                        <XCircle className="mx-auto mb-3 h-12 w-12 text-red-600" />
                        <h3 className="text-lg font-bold text-red-700">
                          Pembayaran Gagal
                        </h3>
                        <p className="mt-2 text-sm text-muted-foreground">
                          Pembayaran tidak dapat diselesaikan. Silakan coba
                          lagi.
                        </p>
                        <Button
                          className="mt-4"
                          variant="outline"
                          onClick={() => {
                            setQrPayment(null);
                            setPaymentStatus("idle");
                          }}
                        >
                          Coba Lagi
                        </Button>
                      </>
                    ) : (
                      <>
                        <div className="mb-3 flex items-center justify-center gap-2">
                          <QrCode className="h-5 w-5 text-primary" />
                          <h3 className="text-lg font-bold">
                            Scan QRIS untuk Membayar
                          </h3>
                        </div>
                        <p className="mb-4 text-sm text-muted-foreground">
                          Scan kode QR di bawah dengan aplikasi e-wallet apa pun
                          yang mendukung QRIS (GoPay, OVO, DANA, ShopeePay, dll).
                        </p>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={qrPayment.qrImageUrl}
                          alt="QRIS Payment QR Code"
                          className="mx-auto h-64 w-64 rounded-lg border bg-white p-2"
                        />
                        <div className="mt-4 flex items-center justify-center gap-2 text-sm text-muted-foreground">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Menunggu pembayaran...
                        </div>
                        <p className="mt-2 text-xs text-muted-foreground">
                          Total: Rp {total.toLocaleString("id-ID")}
                        </p>
                      </>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Sticky order summary sidebar (desktop) */}
        <div>
          <Card className="sticky top-24 border-none shadow-md bg-secondary/30">
            <CardContent className="p-6">
              <h3 className="text-lg font-bold mb-4">Ringkasan</h3>

              <div className="space-y-2 mb-4">
                {cart.items.map((item) => (
                  <div
                    key={item.id}
                    className="flex justify-between text-sm"
                  >
                    <span className="text-muted-foreground line-clamp-1 pr-2">
                      {item.product.name} ×{item.quantity}
                    </span>
                    <span className="flex-shrink-0">
                      Rp{" "}
                      {(
                        parseFloat(item.variant.price) * item.quantity
                      ).toLocaleString("id-ID")}
                    </span>
                  </div>
                ))}
              </div>

              <hr className="border-t border-dashed border-muted-foreground/30 my-3" />

              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span>Rp {subtotal.toLocaleString("id-ID")}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Biaya Layanan</span>
                  <span>Rp {SERVICE_FEE.toLocaleString("id-ID")}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Ongkos Kirim</span>
                  <span className="text-green-600">Gratis</span>
                </div>
              </div>

              <hr className="border-t border-dashed border-muted-foreground/30 my-3" />

              <div className="flex justify-between font-bold">
                <span>Total</span>
                <span className="text-primary">
                  Rp {total.toLocaleString("id-ID")}
                </span>
              </div>

              {branch && (
                <div className="mt-4 flex items-start gap-2 rounded-lg bg-primary/5 p-3 text-xs">
                  <MapPin className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
                  <div>
                    <div className="font-medium">{branch.name}</div>
                    <div className="text-muted-foreground">{branch.city}</div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
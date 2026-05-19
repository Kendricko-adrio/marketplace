"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, Loader2, Tag } from "lucide-react";

interface CartItem {
  id: string;
  quantity: number;
  variant: {
    id: string;
    color: string | null;
    size: string | null;
    price: string;
  };
  product: {
    id: string;
    name: string;
  };
  image: string | null;
}

interface ShippingOption {
  courier: string;
  service: string;
  cost: number;
  estimatedDays: string;
}

interface VoucherData {
  code: string;
  discount: number;
  discountType: string;
}

export default function CheckoutPage() {
  const router = useRouter();

  // Cart state
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [subtotal, setSubtotal] = useState(0);
  const [loading, setLoading] = useState(true);

  // Shipping form
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("Jakarta");
  const [district, setDistrict] = useState("");
  const [postal, setPostal] = useState("");

  // Shipping options
  const [shippingOptions, setShippingOptions] = useState<ShippingOption[]>([]);
  const [selectedShipping, setSelectedShipping] = useState<string>("");
  const [shippingCost, setShippingCost] = useState(0);

  // Payment
  const [paymentMethod, setPaymentMethod] = useState("qris");

  // Voucher
  const [voucherCode, setVoucherCode] = useState("");
  const [voucherData, setVoucherData] = useState<VoucherData | null>(null);
  const [voucherError, setVoucherError] = useState("");
  const [applyingVoucher, setApplyingVoucher] = useState(false);

  // Submit
  const [submitting, setSubmitting] = useState(false);

  // Fetch cart data
  useEffect(() => {
    async function fetchCart() {
      try {
        const res = await fetch("/api/cart");
        const data = await res.json();
        if (data.success && data.data) {
          setCartItems(data.data.items);
          setSubtotal(data.data.subtotal);
        }
      } catch (error) {
        console.error("Error fetching cart:", error);
      } finally {
        setLoading(false);
      }
    }
    fetchCart();
  }, []);

  // Fetch shipping options when city changes
  useEffect(() => {
    async function fetchShipping() {
      if (!city) return;
      try {
        const res = await fetch(
          `/api/checkout/shipping?destination=${encodeURIComponent(city)}`
        );
        const data = await res.json();
        if (data.success) {
          setShippingOptions(data.data);
          if (data.data.length > 0) {
            const firstOption = `${data.data[0].courier}-${data.data[0].service}`;
            setSelectedShipping(firstOption);
            setShippingCost(data.data[0].cost);
          }
        }
      } catch (error) {
        console.error("Error fetching shipping:", error);
      }
    }
    fetchShipping();
  }, [city]);

  const handleShippingChange = (value: string) => {
    setSelectedShipping(value);
    const option = shippingOptions.find(
      (o) => `${o.courier}-${o.service}` === value
    );
    if (option) {
      setShippingCost(option.cost);
    }
  };

  const applyVoucher = async () => {
    if (!voucherCode.trim()) return;

    setApplyingVoucher(true);
    setVoucherError("");

    try {
      const res = await fetch("/api/vouchers/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: voucherCode, subtotal }),
      });
      const data = await res.json();

      if (data.success) {
        setVoucherData({
          code: data.data.code,
          discount: data.data.discount,
          discountType: data.data.discountType,
        });
      } else {
        setVoucherError(data.error);
        setVoucherData(null);
      }
    } catch (error) {
      setVoucherError("Gagal memvalidasi voucher");
    } finally {
      setApplyingVoucher(false);
    }
  };

  const handleSubmit = async () => {
    // Basic validation
    if (!firstName || !phone || !address || !city || !selectedShipping) {
      alert("Lengkapi semua field yang diperlukan");
      return;
    }

    setSubmitting(true);

    try {
      // Create order
      const orderRes = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shippingAddress: {
            recipientName: `${firstName} ${lastName}`.trim(),
            phone,
            address,
            city,
            district,
            postalCode: postal,
          },
          shippingMethod: selectedShipping.split("-")[0],
          shippingCost,
          voucherCode: voucherData?.code,
          paymentMethod,
        }),
      });

      const orderData = await orderRes.json();

      if (!orderData.success) {
        alert(orderData.error || "Gagal membuat pesanan");
        setSubmitting(false);
        return;
      }

      // Process payment
      const paymentRes = await fetch("/api/checkout/payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: orderData.data.orderId,
          amount: orderData.data.total,
          method: paymentMethod,
        }),
      });

      const paymentData = await paymentRes.json();

      if (paymentData.success) {
        // Show payment info or redirect
        if (paymentMethod === "qris") {
          alert(
            `Silakan scan QR Code untuk pembayaran.\n\nOrder ID: ${
              orderData.data.orderId
            }\nTotal: Rp ${orderData.data.total.toLocaleString("id-ID")}`
          );
        } else {
          alert(
            `Transfer ke Virtual Account:\n${
              paymentData.data.vaNumber
            }\nBank: ${
              paymentData.data.bank
            }\n\nTotal: Rp ${orderData.data.total.toLocaleString("id-ID")}`
          );
        }
        router.push("/account?tab=orders");
      }
    } catch (error) {
      console.error("Checkout error:", error);
      alert("Terjadi kesalahan saat checkout");
    } finally {
      setSubmitting(false);
    }
  };

  const discount = voucherData?.discount || 0;
  const serviceFee = 1000;
  const total = subtotal + shippingCost + serviceFee - discount;

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="flex items-center justify-center min-h-[50vh]">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </div>
    );
  }

  if (cartItems.length === 0) {
    return (
      <div className="container mx-auto px-4 py-16 text-center">
        <h1 className="text-2xl font-bold mb-4">Keranjang Kosong</h1>
        <Link href="/products">
          <Button>Mulai Belanja</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex items-center gap-4 mb-8">
        <Link href="/cart">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>
        <h1 className="text-3xl font-bold">Checkout</h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          {/* Alamat Pengiriman */}
          <Card>
            <CardHeader>
              <CardTitle>Alamat Pengiriman</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="firstName">Nama Depan *</Label>
                  <Input
                    id="firstName"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    placeholder="Nama Depan"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lastName">Nama Belakang</Label>
                  <Input
                    id="lastName"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    placeholder="Nama Belakang"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Nomor Telepon (WA) *</Label>
                <Input
                  id="phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="08..."
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="address">Alamat Lengkap *</Label>
                <Textarea
                  id="address"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Nama Jalan, No. Rumah, RT/RW"
                  required
                />
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="city">Kota *</Label>
                  <Input
                    id="city"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    placeholder="Jakarta"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="district">Kecamatan</Label>
                  <Input
                    id="district"
                    value={district}
                    onChange={(e) => setDistrict(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="postal">Kode Pos</Label>
                  <Input
                    id="postal"
                    value={postal}
                    onChange={(e) => setPostal(e.target.value)}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Metode Pengiriman */}
          <Card>
            <CardHeader>
              <CardTitle>Pengiriman</CardTitle>
            </CardHeader>
            <CardContent>
              {shippingOptions.length === 0 ? (
                <p className="text-muted-foreground">
                  Masukkan alamat untuk melihat opsi pengiriman
                </p>
              ) : (
                <RadioGroup
                  value={selectedShipping}
                  onValueChange={handleShippingChange}
                >
                  {shippingOptions.map((option) => {
                    const optionId = `${option.courier}-${option.service}`;
                    return (
                      <div
                        key={optionId}
                        className="flex items-center space-x-2 border p-4 rounded-lg cursor-pointer hover:bg-secondary/20 transition-colors"
                      >
                        <RadioGroupItem value={optionId} id={optionId} />
                        <Label
                          htmlFor={optionId}
                          className="flex-1 flex justify-between cursor-pointer"
                        >
                          <div>
                            <div className="font-semibold">
                              {option.courier} {option.service}
                            </div>
                            <div className="text-sm text-muted-foreground">
                              Estimasi {option.estimatedDays}
                            </div>
                          </div>
                          <div className="font-bold">
                            Rp {option.cost.toLocaleString("id-ID")}
                          </div>
                        </Label>
                      </div>
                    );
                  })}
                </RadioGroup>
              )}
            </CardContent>
          </Card>

          {/* Metode Pembayaran */}
          <Card>
            <CardHeader>
              <CardTitle>Pembayaran</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                <div
                  onClick={() => setPaymentMethod("qris")}
                  className={`cursor-pointer border-2 rounded-xl p-4 flex flex-col items-center gap-2 transition-all ${
                    paymentMethod === "qris"
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/50"
                  }`}
                >
                  <span className="font-bold">QRIS</span>
                  <span className="text-xs text-muted-foreground">
                    Scan QR Code
                  </span>
                </div>
                <div
                  onClick={() => setPaymentMethod("va")}
                  className={`cursor-pointer border-2 rounded-xl p-4 flex flex-col items-center gap-2 transition-all ${
                    paymentMethod === "va"
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/50"
                  }`}
                >
                  <span className="font-bold">Virtual Account</span>
                  <span className="text-xs text-muted-foreground">
                    BCA, Mandiri, dll
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Ringkasan */}
        <div>
          <Card className="sticky top-24 bg-secondary/30 border-none shadow-md">
            <CardContent className="p-6">
              <h3 className="text-xl font-bold mb-4">Pesanan Anda</h3>

              {/* Cart items mini */}
              <div className="space-y-3 mb-6 max-h-48 overflow-y-auto">
                {cartItems.map((item) => (
                  <div key={item.id} className="flex gap-3">
                    <div className="w-12 h-12 bg-secondary rounded relative overflow-hidden flex-shrink-0">
                      {item.image && (
                        <Image
                          src={item.image}
                          alt=""
                          fill
                          className="object-cover"
                        />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {item.product.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        x{item.quantity}
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Voucher */}
              <div className="mb-4">
                <div className="flex gap-2">
                  <Input
                    placeholder="Kode Voucher"
                    value={voucherCode}
                    onChange={(e) =>
                      setVoucherCode(e.target.value.toUpperCase())
                    }
                    disabled={!!voucherData}
                  />
                  <Button
                    variant="outline"
                    onClick={applyVoucher}
                    disabled={applyingVoucher || !!voucherData}
                  >
                    {applyingVoucher ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Tag className="h-4 w-4" />
                    )}
                  </Button>
                </div>
                {voucherError && (
                  <p className="text-xs text-destructive mt-1">
                    {voucherError}
                  </p>
                )}
                {voucherData && (
                  <p className="text-xs text-green-600 mt-1">
                    Voucher {voucherData.code} diterapkan
                  </p>
                )}
              </div>

              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    Subtotal ({cartItems.length} barang)
                  </span>
                  <span>Rp {subtotal.toLocaleString("id-ID")}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Ongkos Kirim</span>
                  <span>Rp {shippingCost.toLocaleString("id-ID")}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Biaya Layanan</span>
                  <span>Rp {serviceFee.toLocaleString("id-ID")}</span>
                </div>
                {discount > 0 && (
                  <div className="flex justify-between text-green-600">
                    <span>Diskon Voucher</span>
                    <span>-Rp {discount.toLocaleString("id-ID")}</span>
                  </div>
                )}
              </div>

              <hr className="border-t border-dashed border-muted-foreground/30 my-4" />

              <div className="flex justify-between mb-6">
                <span className="text-lg font-bold">Total</span>
                <span className="text-lg font-bold text-primary">
                  Rp {total.toLocaleString("id-ID")}
                </span>
              </div>

              <Button
                className="w-full"
                size="lg"
                onClick={handleSubmit}
                disabled={submitting}
              >
                {submitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Memproses...
                  </>
                ) : (
                  "Bayar Sekarang"
                )}
              </Button>
              <p className="mt-4 text-xs text-muted-foreground text-center">
                Dengan membayar, Anda menyetujui Syarat & Ketentuan yang
                berlaku.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

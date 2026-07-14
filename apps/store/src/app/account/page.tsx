"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import {
  User,
  Package,
  LogOut,
  Camera,
  Search,
  Filter,
  Loader2,
  PackageOpen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useSession, authClient } from "@/lib/auth-client";
import type { User as AuthUser } from "@/lib/auth";

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

interface Order {
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
  createdAt: string;
  items: OrderItem[];
}

const statusMap: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  pending_payment: { label: "Pending Payment", variant: "outline" },
  processing: { label: "Processing", variant: "secondary" },
  ready_for_pickup: { label: "Ready for Pickup", variant: "default" },
  completed: { label: "Completed", variant: "default" },
  cancelled: { label: "Cancelled", variant: "destructive" },
};

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatRupiah(value: string) {
  return `Rp ${parseFloat(value).toLocaleString("id-ID")}`;
}

export default function AccountPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const [activeTab, setActiveTab] = useState("orders");
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Profile form state
  const [profileName, setProfileName] = useState("");
  const [profilePhone, setProfilePhone] = useState("");
  const [phoneEditable, setPhoneEditable] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMessage, setProfileMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const user = session?.user as (AuthUser & {
    phone?: string | null;
    onboardingCompleted?: boolean;
  }) | undefined;
  const initials = user?.name
    ? user.name
        .split(" ")
        .map((w) => w[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : "??";

  useEffect(() => {
    if (user) {
      setProfileName(user.name ?? "");
      setProfilePhone(user.phone ?? "");
    }
  }, [user?.id, user?.name, user?.phone]);

  async function handleSaveProfile() {
    setSavingProfile(true);
    setProfileMessage(null);
    try {
      const res = await fetch("/api/account/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: profileName,
          phone: profilePhone,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setPhoneEditable(false);
        setProfileMessage({ type: "success", text: "Profil berhasil diperbarui." });
        // Refresh session so useSession reflects the new name/phone
        await authClient.getSession({ query: { disableCookieCache: true } });
      } else {
        setProfileMessage({
          type: "error",
          text: data.error ?? "Gagal memperbarui profil.",
        });
      }
    } catch {
      setProfileMessage({
        type: "error",
        text: "Terjadi kesalahan. Silakan coba lagi.",
      });
    } finally {
      setSavingProfile(false);
    }
  }

  useEffect(() => {
    if (activeTab !== "orders") return;

    let cancelled = false;
    async function fetchOrders() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/orders");
        const data = await res.json();
        if (cancelled) return;
        if (data.success) {
          setOrders(data.data);
        } else {
          setError(data.error || "Gagal memuat pesanan");
        }
      } catch {
        if (!cancelled) setError("Terjadi kesalahan. Silakan coba lagi.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchOrders();
    return () => {
      cancelled = true;
    };
  }, [activeTab]);

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex flex-col md:flex-row gap-8">
        {/* Sidebar */}
        <aside className="w-full md:w-64 space-y-6">
          <Card className="border-none shadow-md bg-gradient-to-br from-primary/10 to-transparent">
            <CardContent className="flex flex-col items-center p-6 text-center">
              <div className="relative mb-4">
                <Avatar className="w-24 h-24 border-4 border-background">
                  <AvatarImage src={user?.image ?? ""} />
                  <AvatarFallback className="text-2xl font-bold bg-primary text-primary-foreground">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <Button
                  size="icon"
                  variant="secondary"
                  className="absolute bottom-0 right-0 rounded-full h-8 w-8 shadow-sm"
                >
                  <Camera className="h-4 w-4" />
                </Button>
              </div>
              <h2 className="font-bold text-lg">{user?.name ?? "Memuat..."}</h2>
              <p className="text-sm text-muted-foreground">
                {user?.email ?? ""}
              </p>
              <div className="mt-4 flex gap-2">
                <Badge variant="outline" className="bg-background/50">
                  Member Silver
                </Badge>
              </div>
            </CardContent>
          </Card>

          <nav className="space-y-1">
            <Button
              variant={activeTab === "profile" ? "secondary" : "ghost"}
              className="w-full justify-start gap-3"
              onClick={() => setActiveTab("profile")}
            >
              <User className="h-4 w-4" /> Profil Saya
            </Button>
            <Button
              variant={activeTab === "orders" ? "secondary" : "ghost"}
              className="w-full justify-start gap-3"
              onClick={() => setActiveTab("orders")}
            >
              <Package className="h-4 w-4" /> Pesanan Saya
            </Button>
            <div className="pt-4 mt-4 border-t">
              <Button
                variant="ghost"
                className="w-full justify-start gap-3 text-destructive hover:text-destructive hover:bg-destructive/10"
              >
                <LogOut className="h-4 w-4" /> Keluar
              </Button>
            </div>
          </nav>
        </aside>

        {/* Main Content */}
        <main className="flex-1">
          {activeTab === "orders" && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold">Riwayat Pesanan</h1>
                <div className="flex gap-2">
                  <div className="relative w-64">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      type="search"
                      placeholder="Cari pesanan..."
                      className="pl-8"
                    />
                  </div>
                  <Button variant="outline" size="icon">
                    <Filter className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {/* Loading */}
              {loading && (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
              )}

              {/* Error */}
              {!loading && error && (
                <div className="text-center py-16 space-y-4">
                  <p className="text-muted-foreground">{error}</p>
                  <Button
                    variant="outline"
                    onClick={() => setActiveTab("orders")}
                  >
                    Coba Lagi
                  </Button>
                </div>
              )}

              {/* Empty */}
              {!loading && !error && orders.length === 0 && (
                <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-4">
                  <PackageOpen className="h-16 w-16" />
                  <p className="text-lg">Belum ada pesanan</p>
                  <Button onClick={() => router.push("/products")}>
                    Mulai Belanja
                  </Button>
                </div>
              )}

              {/* Order List */}
              {!loading && !error && orders.length > 0 && (
                <div className="space-y-4">
                  {orders.map((order) => {
                    const status = statusMap[order.status] ?? {
                      label: order.status,
                      variant: "secondary" as const,
                    };
                    const firstItem = order.items[0];
                    const otherCount = order.items.length - 1;

                    return (
                      <Card key={order.id} className="overflow-hidden">
                        <CardHeader className="bg-muted/30 py-3 px-6 flex flex-row items-center justify-between space-y-0">
                          <div className="flex items-center gap-4 text-sm">
                            <span className="font-semibold">
                              {formatDate(order.createdAt)}
                            </span>
                            <span className="text-muted-foreground font-mono text-xs">
                              {order.id.slice(0, 8)}...
                            </span>
                          </div>
                          <Badge variant={status.variant}>{status.label}</Badge>
                        </CardHeader>
                        <CardContent className="p-6">
                          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                            <div className="flex gap-4">
                              <div className="h-16 w-16 bg-muted rounded-md overflow-hidden flex items-center justify-center text-muted-foreground shrink-0">
                                {firstItem?.imageUrl ? (
                                  <Image
                                    src={firstItem.imageUrl}
                                    alt={firstItem.productName}
                                    width={64}
                                    height={64}
                                    className="object-cover w-full h-full"
                                  />
                                ) : (
                                  <Package className="h-6 w-6" />
                                )}
                              </div>
                              <div>
                                <h4 className="font-medium">
                                  {firstItem?.productName ?? "Produk"}
                                </h4>
                                {otherCount > 0 && (
                                  <p className="text-sm text-muted-foreground">
                                    + {otherCount} barang lainnya
                                  </p>
                                )}
                              </div>
                            </div>
                            <div className="text-right">
                              <p className="text-sm text-muted-foreground">
                                Total Belanja
                              </p>
                              <p className="font-bold text-lg">
                                {formatRupiah(order.total)}
                              </p>
                            </div>
                          </div>
                          <div className="flex justify-end gap-3 mt-6">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                router.push(`/account/orders/${order.id}`)
                              }
                            >
                              Lihat Detail
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {activeTab === "profile" && (
            <Card>
              <CardHeader>
                <CardTitle>Profil Saya</CardTitle>
                <CardDescription>
                  Kelola informasi profil anda untuk mengontrol, melindungi dan
                  mengamankan akun.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {profileMessage && (
                  <div
                    className={`text-sm rounded-md px-3 py-2 ${
                      profileMessage.type === "success"
                        ? "bg-green-50 text-green-700 border border-green-200"
                        : "bg-destructive/10 text-destructive border border-destructive/20"
                    }`}
                  >
                    {profileMessage.text}
                  </div>
                )}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <div className="text-sm font-medium">Nama Lengkap</div>
                    <Input
                      value={profileName}
                      onChange={(e) => setProfileName(e.target.value)}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="text-sm font-medium">Email</div>
                  <div className="flex gap-2">
                    <Input
                      defaultValue={user?.email ?? ""}
                      disabled
                      className="bg-muted"
                    />
                    <Button variant="outline" disabled>
                      Ubah
                    </Button>
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="text-sm font-medium">Nomor Telepon</div>
                  <div className="flex gap-2">
                    <Input
                      value={profilePhone}
                      onChange={(e) => setProfilePhone(e.target.value)}
                      disabled={!phoneEditable}
                      className={phoneEditable ? "" : "bg-muted"}
                      placeholder={phoneEditable ? "+628123456789" : ""}
                    />
                    <Button
                      variant="outline"
                      onClick={() => setPhoneEditable((v) => !v)}
                    >
                      {phoneEditable ? "Batal" : "Ubah"}
                    </Button>
                  </div>
                  {phoneEditable && (
                    <p className="text-xs text-muted-foreground">
                      Format: +62 diikuti 8–13 digit (contoh: +628123456789).
                    </p>
                  )}
                </div>
                <div className="flex justify-end mt-4">
                  <Button
                    onClick={handleSaveProfile}
                    disabled={savingProfile}
                  >
                    {savingProfile ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : null}
                    Simpan Perubahan
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </main>
      </div>
    </div>
  );
}

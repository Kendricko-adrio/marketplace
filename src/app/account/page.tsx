"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  User,
  Package,
  MapPin,
  Heart,
  LogOut,
  Settings,
  Camera,
  Search,
  Filter,
  X,
  ShoppingCart,
  Star,
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

export default function AccountPage() {
  const [activeTab, setActiveTab] = useState("orders");
  const [wishlistItems, setWishlistItems] = useState<any[]>([]);
  const [wishlistLoading, setWishlistLoading] = useState(false);

  const fetchWishlist = async () => {
    setWishlistLoading(true);
    try {
      const res = await fetch("/api/wishlist");
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setWishlistItems(data.data.items);
        }
      }
    } catch (error) {
      console.error("Error fetching wishlist:", error);
    } finally {
      setWishlistLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === "wishlist") {
      fetchWishlist();
    }
  }, [activeTab]);

  const handleToggleWishlist = async (productId: string) => {
    // Optimism: remove from list immediately
    setWishlistItems((prev) => prev.filter((item) => item.product.id !== productId));

    try {
      await fetch("/api/wishlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId }),
      });
    } catch {
      // Refetch on error
      fetchWishlist();
    }
  };

  const handleAddToCart = async (productId: string) => {
    // Get first variant of the product
    const variantsRes = await fetch(`/api/products/${productId}`);
    const variantsData = await variantsRes.json();
    if (variantsData.success) {
      const defaultVariant = variantsData.data.variants.find(
        (v: any) => v.isDefault
      ) || variantsData.data.variants[0];

      if (defaultVariant) {
        await fetch("/api/cart/items", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ variantId: defaultVariant.id, quantity: 1 }),
        });
        // Bisa tambah toast/alert di sini
      }
    }
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex flex-col md:flex-row gap-8">
        {/* Sidebar */}
        <aside className="w-full md:w-64 space-y-6">
          <Card className="border-none shadow-md bg-gradient-to-br from-primary/10 to-transparent">
            <CardContent className="flex flex-col items-center p-6 text-center">
              <div className="relative mb-4">
                <Avatar className="w-24 h-24 border-4 border-background">
                  <AvatarImage src="" />
                  <AvatarFallback className="text-2xl font-bold bg-primary text-primary-foreground">
                    JD
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
              <h2 className="font-bold text-lg">John Doe</h2>
              <p className="text-sm text-muted-foreground">
                john.doe@example.com
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
            <Button
              variant={activeTab === "address" ? "secondary" : "ghost"}
              className="w-full justify-start gap-3"
              onClick={() => setActiveTab("address")}
            >
              <MapPin className="h-4 w-4" /> Alamat
            </Button>
            <Button
              variant={activeTab === "wishlist" ? "secondary" : "ghost"}
              className="w-full justify-start gap-3"
              onClick={() => setActiveTab("wishlist")}
            >
              <Heart className="h-4 w-4" /> Wishlist
            </Button>
            <Button
              variant={activeTab === "settings" ? "secondary" : "ghost"}
              className="w-full justify-start gap-3"
              onClick={() => setActiveTab("settings")}
            >
              <Settings className="h-4 w-4" /> Pengaturan
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

              {/* Order List */}
              <div className="space-y-4">
                {[
                  {
                    id: "ODR-12345678",
                    date: "10 Jan 2024",
                    status: "Selesai",
                    total: "Rp 450.000",
                    items: ["Wireless Headphones"],
                  },
                  {
                    id: "ODR-87654321",
                    date: "05 Jan 2024",
                    status: "Dikirim",
                    total: "Rp 1.200.000",
                    items: ["Mechanical Keyboard"],
                  },
                  {
                    id: "ODR-11223344",
                    date: "28 Des 2023",
                    status: "Dibatalkan",
                    total: "Rp 150.000",
                    items: ["Mousepad XL"],
                  },
                ].map((order) => (
                  <Card key={order.id} className="overflow-hidden">
                    <CardHeader className="bg-muted/30 py-3 px-6 flex flex-row items-center justify-between space-y-0">
                      <div className="flex items-center gap-4 text-sm">
                        <span className="font-semibold">{order.date}</span>
                        <span className="text-muted-foreground">
                          {order.id}
                        </span>
                      </div>
                      <Badge
                        variant={
                          order.status === "Selesai"
                            ? "default"
                            : order.status === "Dibatalkan"
                            ? "destructive"
                            : "secondary"
                        }
                      >
                        {order.status}
                      </Badge>
                    </CardHeader>
                    <CardContent className="p-6">
                      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                        <div className="flex gap-4">
                          <div className="h-16 w-16 bg-muted rounded-md flex items-center justify-center text-muted-foreground">
                            IMG
                          </div>
                          <div>
                            <h4 className="font-medium">{order.items[0]}</h4>
                            <p className="text-sm text-muted-foreground">
                              + 2 barang lainnya
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-sm text-muted-foreground">
                            Total Belanja
                          </p>
                          <p className="font-bold text-lg">{order.total}</p>
                        </div>
                      </div>
                      <div className="flex justify-end gap-3 mt-6">
                        <Button variant="outline" size="sm">
                          Lihat Detail
                        </Button>
                        {order.status === "Selesai" && (
                          <Button size="sm">Beli Lagi</Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
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
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <div className="text-sm font-medium">Nama Lengkap</div>
                    <Input defaultValue="John Doe" />
                  </div>
                  <div className="space-y-2">
                    <div className="text-sm font-medium">Username</div>
                    <Input defaultValue="johndoe123" />
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="text-sm font-medium">Email</div>
                  <div className="flex gap-2">
                    <Input
                      defaultValue="john.doe@example.com"
                      disabled
                      className="bg-muted"
                    />
                    <Button variant="outline">Ubah</Button>
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="text-sm font-medium">Nomor Telepon</div>
                  <div className="flex gap-2">
                    <Input
                      defaultValue="081234567890"
                      disabled
                      className="bg-muted"
                    />
                    <Button variant="outline">Ubah</Button>
                  </div>
                </div>
                <div className="flex justify-end mt-4">
                  <Button>Simpan Perubahan</Button>
                </div>
              </CardContent>
            </Card>
          )}

          {activeTab === "wishlist" && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h1 className="text-2xl font-bold">Wishlist Saya</h1>
                  <p className="text-muted-foreground">
                    {wishlistItems.length} produk di wishlist
                  </p>
                </div>
              </div>

              {wishlistLoading ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {[1, 2, 3].map((i) => (
                    <Card key={i}>
                      <CardContent className="p-4">
                        <div className="aspect-square bg-secondary/50 rounded-lg animate-pulse mb-4" />
                        <div className="h-4 bg-secondary/50 rounded animate-pulse mb-2" />
                        <div className="h-6 bg-secondary/50 rounded animate-pulse w-1/2" />
                      </CardContent>
                    </Card>
                  ))}
                </div>
              ) : wishlistItems.length === 0 ? (
                <div className="text-center py-16">
                  <Heart className="w-16 h-16 mx-auto text-muted-foreground/30 mb-4" />
                  <h3 className="text-lg font-medium mb-2">Belum ada produk di wishlist</h3>
                  <p className="text-muted-foreground mb-6">
                    Jelajahi produk dan klik ikon hati untuk menyimpan favorit kamu.
                  </p>
                  <Link href="/products">
                    <Button>Jelajahi Produk</Button>
                  </Link>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {wishlistItems.map((item: any) => (
                    <Card key={item.id} className="overflow-hidden group relative">
                      <button
                        onClick={() => handleToggleWishlist(item.product.id)}
                        className="absolute top-2 right-2 z-10 p-1.5 rounded-full bg-background/80 hover:bg-background transition-colors"
                      >
                        <X className="w-4 h-4 text-muted-foreground hover:text-destructive" />
                      </button>
                      <Link href={`/products/${item.product.slug}`}>
                        <CardContent className="p-4">
                          <div className="aspect-square bg-muted rounded-lg mb-4 relative">
                            {/* Placeholder image — akan diganti dengan Image component jika ada image URL */}
                            {item.image ? (
                              <Image
                                src={item.image}
                                alt={item.product.name}
                                fill
                                className="object-cover rounded-lg"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                                <Heart className="w-8 h-8" />
                              </div>
                            )}
                            {item.product.isFlashSale && (
                              <Badge className="absolute top-2 left-2 bg-destructive">
                                Flash Sale
                              </Badge>
                            )}
                          </div>
                          <h3 className="font-medium text-sm line-clamp-2 mb-2 group-hover:text-primary transition-colors">
                            {item.product.name}
                          </h3>
                          <div className="flex items-center gap-2 text-sm mb-1">
                            <span className="font-bold text-primary">
                              Rp {parseFloat(item.product.basePrice).toLocaleString("id-ID")}
                            </span>
                            {item.product.flashSalePrice && (
                              <span className="text-xs text-muted-foreground line-through">
                                Rp {parseFloat(item.product.flashSalePrice).toLocaleString("id-ID")}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-3">
                            <div className="flex items-center gap-1">
                              <Star className="w-3 h-3 fill-yellow-400 text-yellow-400" />
                              <span>{parseFloat(item.product.rating || "0").toFixed(1)}</span>
                            </div>
                            <span>|</span>
                            <span>{item.product.sold} terjual</span>
                            {!item.product.inStock && (
                              <>
                                <span>|</span>
                                <span className="text-destructive font-medium">Stok Habis</span>
                              </>
                            )}
                          </div>
                          <Button
                            className="w-full gap-2"
                            size="sm"
                            variant="outline"
                            disabled={!item.product.inStock}
                            onClick={(e) => {
                              e.preventDefault();
                              handleAddToCart(item.product.id);
                            }}
                          >
                            <ShoppingCart className="w-4 h-4" />
                            {item.product.inStock ? "+ Keranjang" : "Stok Habis"}
                          </Button>
                        </CardContent>
                      </Link>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Placeholder for other tabs */}
          {activeTab !== "orders" && activeTab !== "profile" && activeTab !== "wishlist" && (
            <div className="h-64 flex items-center justify-center border-2 border-dashed rounded-xl text-muted-foreground">
              Konten untuk tab {activeTab} akan segera tersedia.
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

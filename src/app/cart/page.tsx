"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { Trash2, Plus, Minus, ArrowRight, ShoppingBag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

interface CartItem {
  id: string;
  quantity: number;
  variantId: string;
  variant: {
    id: string;
    sku: string;
    color: string | null;
    size: string | null;
    price: string;
    stock: number;
  };
  product: {
    id: string;
    name: string;
    slug: string;
  };
  image: string | null;
}

interface CartData {
  id: string;
  items: CartItem[];
  itemCount: number;
  subtotal: number;
}

export default function CartPage() {
  const [cart, setCart] = useState<CartData | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);

  const fetchCart = async () => {
    try {
      const res = await fetch("/api/cart");
      const data = await res.json();
      if (data.success) {
        setCart(data.data);
      }
    } catch (error) {
      console.error("Error fetching cart:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCart();
  }, []);

  const updateQuantity = async (itemId: string, newQuantity: number) => {
    if (newQuantity < 1) return;

    setUpdating(itemId);
    try {
      const res = await fetch(`/api/cart/items/${itemId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quantity: newQuantity }),
      });

      if (res.ok) {
        await fetchCart();
      }
    } catch (error) {
      console.error("Error updating quantity:", error);
    } finally {
      setUpdating(null);
    }
  };

  const removeItem = async (itemId: string) => {
    setUpdating(itemId);
    try {
      const res = await fetch(`/api/cart/items/${itemId}`, {
        method: "DELETE",
      });

      if (res.ok) {
        await fetchCart();
      }
    } catch (error) {
      console.error("Error removing item:", error);
    } finally {
      setUpdating(null);
    }
  };

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="animate-pulse">
          <div className="h-10 bg-secondary/50 rounded w-64 mb-8"></div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2 space-y-4">
              {[1, 2].map((i) => (
                <div key={i} className="flex gap-4 p-4 border rounded-xl">
                  <div className="w-24 h-24 bg-secondary/50 rounded-lg"></div>
                  <div className="flex-1 space-y-2">
                    <div className="h-6 bg-secondary/50 rounded w-3/4"></div>
                    <div className="h-5 bg-secondary/50 rounded w-1/2"></div>
                  </div>
                </div>
              ))}
            </div>
            <div className="h-64 bg-secondary/50 rounded-xl"></div>
          </div>
        </div>
      </div>
    );
  }

  if (!cart || cart.items.length === 0) {
    return (
      <div className="container mx-auto px-4 py-16 text-center">
        <ShoppingBag className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
        <h1 className="text-2xl font-bold mb-2">Keranjang Kosong</h1>
        <p className="text-muted-foreground mb-8">
          Belum ada produk di keranjang belanja Anda.
        </p>
        <Link href="/products">
          <Button>Mulai Belanja</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-8">
        Keranjang Belanja ({cart.itemCount})
      </h1>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Cart Items */}
        <div className="lg:col-span-2 space-y-4">
          {cart.items.map((item) => (
            <div
              key={item.id}
              className={`flex gap-4 p-4 border rounded-xl bg-card text-card-foreground shadow-sm ${
                updating === item.id ? "opacity-50" : ""
              }`}
            >
              <div className="w-24 h-24 bg-secondary/50 rounded-lg flex-shrink-0 relative overflow-hidden">
                {item.image && (
                  <Image
                    src={item.image}
                    alt={item.product.name}
                    fill
                    className="object-cover"
                  />
                )}
              </div>
              <div className="flex-1 flex flex-col justify-between">
                <div>
                  <Link href={`/products/${item.product.id}`}>
                    <h3 className="font-semibold text-lg line-clamp-1 hover:text-primary">
                      {item.product.name}
                    </h3>
                  </Link>
                  {(item.variant.color || item.variant.size) && (
                    <p className="text-sm text-muted-foreground">
                      {[item.variant.color, item.variant.size]
                        .filter(Boolean)
                        .join(" / ")}
                    </p>
                  )}
                  <div className="text-primary font-bold mt-1">
                    Rp {parseFloat(item.variant.price).toLocaleString("id-ID")}
                  </div>
                </div>
                <div className="flex items-center justify-between mt-2">
                  <div className="flex items-center border rounded-md">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => updateQuantity(item.id, item.quantity - 1)}
                      disabled={updating === item.id || item.quantity <= 1}
                    >
                      <Minus className="h-3 w-3" />
                    </Button>
                    <span className="w-8 text-center text-sm font-medium">
                      {item.quantity}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => updateQuantity(item.id, item.quantity + 1)}
                      disabled={
                        updating === item.id ||
                        item.quantity >= item.variant.stock
                      }
                    >
                      <Plus className="h-3 w-3" />
                    </Button>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeItem(item.id)}
                    disabled={updating === item.id}
                    className="text-destructive hover:text-destructive hover:bg-destructive/10 gap-1"
                  >
                    <Trash2 className="h-4 w-4" /> Hapus
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Summary */}
        <div>
          <Card className="sticky top-24 border-none shadow-md bg-secondary/30">
            <CardContent className="p-6">
              <h3 className="text-xl font-bold mb-6">Ringkasan Belanja</h3>
              <div className="flex justify-between mb-3 text-muted-foreground">
                <span>Total Harga ({cart.itemCount} barang)</span>
                <span className="text-foreground">
                  Rp {cart.subtotal.toLocaleString("id-ID")}
                </span>
              </div>
              <hr className="border-t border-dashed border-muted-foreground/30 my-4" />
              <div className="flex justify-between mb-8">
                <span className="text-lg font-bold">Total Bayar</span>
                <span className="text-lg font-bold text-primary">
                  Rp {cart.subtotal.toLocaleString("id-ID")}
                </span>
              </div>

              <Link href="/checkout">
                <Button className="w-full gap-2" size="lg">
                  Checkout <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

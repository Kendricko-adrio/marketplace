"use client";
import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { toast } from "sonner";
import { Trash2, Plus, Minus, ArrowRight, ShoppingBag, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { useCart } from "@/providers/cart-provider";

interface CartItem {
  id: string;
  quantity: number;
  variantId: string;
  branchId: string | null;
  variant: {
    id: string;
    sku: string;
    color: string | null;
    size: string | null;
    price: string;
  };
  branch: {
    id: string;
    name: string;
    city: string;
  } | null;
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
  const router = useRouter();
  const [cart, setCart] = useState<CartData | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const { refreshCart } = useCart();

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
        refreshCart();
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
        // Remove from selection if it was selected
        setSelectedItemIds((prev) => {
          const next = new Set(prev);
          next.delete(itemId);
          return next;
        });
        await fetchCart();
        refreshCart();
      }
    } catch (error) {
      console.error("Error removing item:", error);
    } finally {
      setUpdating(null);
    }
  };

  // ===== Derived: grouped items by branch =====
  const branchGroups = useMemo(() => {
    if (!cart) return [];
    const groups = new Map<
      string,
      { id: string; name: string; city?: string; items: CartItem[] }
    >();
    for (const item of cart.items) {
      const key = item.branch?.id ?? "unknown";
      const existing = groups.get(key);
      if (existing) {
        existing.items.push(item);
      } else {
        groups.set(key, {
          id: key,
          name: item.branch?.name ?? "Cabang tidak diketahui",
          city: item.branch?.city ?? undefined,
          items: [item],
        });
      }
    }
    return Array.from(groups.values());
  }, [cart]);

  // ===== Derived: selected items & single-branch check =====
  const selectedItems = useMemo(
    () => (cart ? cart.items.filter((item) => selectedItemIds.has(item.id)) : []),
    [cart, selectedItemIds]
  );

  const selectedBranchId = useMemo(() => {
    if (selectedItems.length === 0) return null;
    const branchIds = new Set(
      selectedItems
        .map((i) => i.branchId)
        .filter((b): b is string => !!b)
    );
    return branchIds.size === 1 ? Array.from(branchIds)[0] : null;
  }, [selectedItems]);

  const selectedSubtotal = useMemo(
    () =>
      selectedItems.reduce(
        (sum, item) => sum + parseFloat(item.variant.price) * item.quantity,
        0
      ),
    [selectedItems]
  );

  // ===== Toggle item selection with single-branch enforcement =====
  const toggleItem = (itemId: string) => {
    if (!cart) return;
    setSelectedItemIds((prev) => {
      const next = new Set(prev);
      const item = cart.items.find((i) => i.id === itemId);
      if (!item) return prev;

      if (next.has(itemId)) {
        // unchecking is always allowed
        next.delete(itemId);
        return next;
      }

      // checking — ensure all selected items belong to the same branch
      if (item.branchId) {
        for (const existingId of next) {
          const existing = cart.items.find((i) => i.id === existingId);
          if (existing?.branchId && existing.branchId !== item.branchId) {
            toast.error("Tidak bisa checkout barang di branch yang berbeda.");
            return prev;
          }
        }
      }

      next.add(itemId);
      return next;
    });
  };

  // ===== Select / unselect all items in a branch group =====
  const toggleBranchGroup = (branchId: string, groupItems: CartItem[]) => {
    if (!cart) return;
    const allGroupSelected =
      groupItems.every((it) => selectedItemIds.has(it.id)) && groupItems.length > 0;

    if (allGroupSelected) {
      // unselect all items in this group
      setSelectedItemIds((prev) => {
        const next = new Set(prev);
        for (const it of groupItems) next.delete(it.id);
        return next;
      });
      return;
    }

    // selecting all items in this branch — ensure no conflicting branch is selected
    const otherBranchSelected = Array.from(selectedItemIds).some((id) => {
      const it = cart.items.find((i) => i.id === id);
      return it?.branchId && it.branchId !== branchId;
    });
    if (otherBranchSelected) {
      toast.error("Tidak bisa checkout barang di branch yang berbeda.");
      return;
    }

    setSelectedItemIds((prev) => {
      const next = new Set(prev);
      for (const it of groupItems) next.add(it.id);
      return next;
    });
  };

  // ===== Proceed to checkout =====
  const handleCheckout = () => {
    if (selectedItems.length === 0) {
      toast.error("Pilih minimal satu barang untuk di-checkout.");
      return;
    }
    if (!selectedBranchId) {
      toast.error("Tidak bisa checkout barang di branch yang berbeda.");
      return;
    }
    // Store selected item IDs in sessionStorage so the checkout page can read them
    try {
      sessionStorage.setItem(
        "checkoutSelectedItemIds",
        JSON.stringify(Array.from(selectedItemIds))
      );
    } catch {
      // sessionStorage may be unavailable — fall back to query-less navigation
    }
    router.push("/checkout");
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
      <h1 className="text-3xl font-bold mb-6">
        Keranjang Belanja ({cart.itemCount})
      </h1>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Cart Items grouped by branch */}
        <div className="lg:col-span-2 space-y-6">
          {branchGroups.map((group) => {
            const allGroupSelected =
              group.items.every((it) => selectedItemIds.has(it.id)) &&
              group.items.length > 0;
            return (
              <div key={group.id} className="space-y-3">
                {/* Branch group header — clickable to select all in branch */}
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => toggleBranchGroup(group.id, group.items)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      toggleBranchGroup(group.id, group.items);
                    }
                  }}
                  className="flex w-full items-center gap-3 px-1 py-1 text-left cursor-pointer select-none"
                >
                  <Checkbox checked={allGroupSelected} />
                  <MapPin className="h-4 w-4 text-primary" />
                  <div className="text-sm font-semibold flex-1">
                    {group.name}
                    {group.city ? ` · ${group.city}` : ""}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {group.items.length} barang
                  </span>
                </div>

                <div className="space-y-4">
                  {group.items.map((item) => {
                    const checked = selectedItemIds.has(item.id);
                    return (
                      <div
                        key={item.id}
                        className={`flex gap-4 p-4 border rounded-xl bg-card text-card-foreground shadow-sm ${
                          updating === item.id ? "opacity-50" : ""
                        } ${checked ? "border-primary/40 bg-primary/5" : ""}`}
                      >
                        {/* Selection checkbox */}
                        <label className="flex items-start pt-1 cursor-pointer">
                          <Checkbox
                            checked={checked}
                            onCheckedChange={() => toggleItem(item.id)}
                          />
                        </label>

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
                                disabled={updating === item.id}
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
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Summary */}
        <div>
          <Card className="sticky top-24 border-none shadow-md bg-secondary/30">
            <CardContent className="p-6">
              <h3 className="text-xl font-bold mb-6">Ringkasan Belanja</h3>

              {selectedItems.length === 0 ? (
                <p className="text-sm text-muted-foreground mb-6">
                  Pilih barang yang ingin di-checkout dengan mencentang kotak di
                  samping setiap produk. Barang yang di-checkout harus dari
                  cabang yang sama.
                </p>
              ) : (
                <>
                  <div className="space-y-2 mb-4">
                    {selectedItems.map((item) => (
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
                  <hr className="border-t border-dashed border-muted-foreground/30 my-4" />
                  <div className="flex justify-between mb-3 text-muted-foreground">
                    <span>Total Harga ({selectedItems.length} barang)</span>
                    <span className="text-foreground">
                      Rp {selectedSubtotal.toLocaleString("id-ID")}
                    </span>
                  </div>
                  <hr className="border-t border-dashed border-muted-foreground/30 my-4" />
                  <div className="flex justify-between mb-8">
                    <span className="text-lg font-bold">Total Bayar</span>
                    <span className="text-lg font-bold text-primary">
                      Rp {selectedSubtotal.toLocaleString("id-ID")}
                    </span>
                  </div>
                </>
              )}

              <Button
                className="w-full gap-2"
                size="lg"
                disabled={selectedItems.length === 0 || !selectedBranchId}
                onClick={handleCheckout}
              >
                Checkout <ArrowRight className="h-4 w-4" />
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
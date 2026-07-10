"use client";
import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Image from "next/image";
import { toast } from "sonner";
import { ShoppingCart, Heart, Share2, Minus, Plus, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useCart } from "@/providers/cart-provider";

interface BranchStock {
  branchId: string;
  name: string;
  code: string;
  city: string;
  stock: number;
}

interface ProductVariant {
  id: string;
  sku: string;
  color: string | null;
  size: string | null;
  price: string;
  isDefault: boolean;
  images: string[];
  branchStock: BranchStock[];
}

interface Product {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  basePrice: string;
  status: string;
  isFlashSale: boolean;
  flashSalePrice: string | null;
  variants: ProductVariant[];
  colors: string[];
  sizes: string[];
}

export default function ProductDetailPage() {
  const params = useParams();
  const router = useRouter();
  const productId = params.id as string;
  const { refreshCart } = useCart();

  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [quantity, setQuantity] = useState(1);
  const [selectedColor, setSelectedColor] = useState<string | null>(null);
  const [selectedSize, setSelectedSize] = useState<string | null>(null);
  const [selectedVariant, setSelectedVariant] = useState<ProductVariant | null>(
    null
  );
  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(null);
  const [addingToCart, setAddingToCart] = useState(false);

  useEffect(() => {
    async function fetchProduct() {
      try {
        const res = await fetch(`/api/products/${productId}`);
        const data = await res.json();
        if (data.success) {
          const prod = data.data;
          setProduct(prod);

          // Set default selections
          const defaultVariant =
            prod.variants.find((v: ProductVariant) => v.isDefault) ||
            prod.variants[0];
          if (defaultVariant) {
            setSelectedVariant(defaultVariant);
            if (defaultVariant.color) setSelectedColor(defaultVariant.color);
            if (defaultVariant.size) setSelectedSize(defaultVariant.size);
          }
        }
      } catch (error) {
        console.error("Error fetching product:", error);
      } finally {
        setLoading(false);
      }
    }
    fetchProduct();
  }, [productId]);

  // Update selected variant when color/size changes
  useEffect(() => {
    if (!product) return;

    const matchingVariant = product.variants.find((v) => {
      const colorMatch = !selectedColor || v.color === selectedColor;
      const sizeMatch = !selectedSize || v.size === selectedSize;
      return colorMatch && sizeMatch;
    });

    if (matchingVariant) {
      setSelectedVariant(matchingVariant);
      setSelectedBranchId(null);
    }
  }, [selectedColor, selectedSize, product]);

  const handleAddToCart = async () => {
    if (!selectedVariant || !selectedBranchId) return;
    setAddingToCart(true);
    try {
      const res = await fetch("/api/cart/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          variantId: selectedVariant.id,
          branchId: selectedBranchId,
          quantity,
        }),
      });

      const data = await res.json();
      if (data.success) {
        toast.success("Produk berhasil ditambahkan ke keranjang!");
        refreshCart();
      } else {
        toast.error(data.error || "Gagal menambahkan ke keranjang");
      }
    } catch (error) {
      console.error("Error adding to cart:", error);
      toast.error("Terjadi kesalahan. Silakan coba lagi.");
    } finally {
      setAddingToCart(false);
    }
  };

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
          <div className="aspect-square bg-secondary/50 rounded-xl animate-pulse"></div>
          <div className="space-y-4">
            <div className="h-8 bg-secondary/50 rounded animate-pulse"></div>
            <div className="h-12 bg-secondary/50 rounded animate-pulse w-1/2"></div>
            <div className="h-32 bg-secondary/50 rounded animate-pulse"></div>
          </div>
        </div>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="container mx-auto px-4 py-8 text-center">
        <h1 className="text-2xl font-bold mb-4">Produk tidak ditemukan</h1>
        <Button onClick={() => router.push("/products")}>
          Kembali ke Produk
        </Button>
      </div>
    );
  }

  const currentPrice =
    product.isFlashSale && product.flashSalePrice
      ? parseFloat(product.flashSalePrice)
      : parseFloat(selectedVariant?.price || product.basePrice);

  const originalPrice = parseFloat(product.basePrice);
  const discount = Math.round(
    ((originalPrice - currentPrice) / originalPrice) * 100
  );

  const availableBranches = selectedVariant?.branchStock ?? [];
  const selectedBranchStock = availableBranches.find(
    (b) => b.branchId === selectedBranchId
  );
  const stockLabel = selectedBranchId
    ? `Stok: ${selectedBranchStock?.stock ?? 0}`
    : availableBranches.length > 0
    ? "Pilih cabang"
    : "Stok habis di semua cabang";

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
        {/* Image Gallery */}
        <div>
          <div className="aspect-square bg-secondary/50 rounded-xl mb-4 relative">
            {selectedVariant?.images[0] && (
              <Image
                src={selectedVariant.images[0]}
                alt={product.name}
                fill
                className="object-cover rounded-xl"
              />
            )}
          </div>
          <div className="grid grid-cols-4 gap-4">
            {(selectedVariant?.images || []).slice(0, 4).map((img, i) => (
              <div
                key={i}
                className={`aspect-square bg-secondary/30 rounded-lg cursor-pointer border-2 ${
                  i === 0
                    ? "border-primary"
                    : "border-transparent hover:border-primary/50"
                } transition-colors relative overflow-hidden`}
              >
                {img && (
                  <Image src={img} alt="" fill className="object-cover" />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Product Info */}
        <div>
          <h1 className="text-3xl font-bold mb-2">{product.name}</h1>

          <div className="flex items-center gap-4 mb-6 text-sm text-muted-foreground">
            <span className="text-green-600 font-medium">{stockLabel}</span>
          </div>

          <div className="mb-8">
            <h2 className="text-4xl font-bold text-primary">
              Rp {currentPrice.toLocaleString("id-ID")}
            </h2>
            {discount > 0 && (
              <div className="flex gap-4 items-center mt-2">
                <span className="text-muted-foreground line-through">
                  Rp {originalPrice.toLocaleString("id-ID")}
                </span>
                <Badge variant="destructive">Hemat {discount}%</Badge>
              </div>
            )}
          </div>

          <hr className="my-6 border-border" />

          {/* Color Variants */}
          {product.colors.length > 0 && (
            <div className="mb-6">
              <h3 className="mb-3 font-medium">
                Warna:{" "}
                <span className="font-normal text-muted-foreground">
                  {selectedColor}
                </span>
              </h3>
              <div className="flex gap-3 flex-wrap">
                {product.colors.map((color) => (
                  <Button
                    key={color}
                    variant={selectedColor === color ? "default" : "outline"}
                    onClick={() => setSelectedColor(color)}
                    className="rounded-full"
                  >
                    {color}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {/* Size Variants */}
          {product.sizes.length > 0 && (
            <div className="mb-8">
              <h3 className="mb-3 font-medium">
                Ukuran:{" "}
                <span className="font-normal text-muted-foreground">
                  {selectedSize}
                </span>
              </h3>
              <div className="flex gap-3 flex-wrap">
                {product.sizes.map((size) => (
                  <Button
                    key={size}
                    variant={selectedSize === size ? "default" : "outline"}
                    onClick={() => setSelectedSize(size)}
                    className="w-12 h-12 p-0 rounded-lg text-sm"
                  >
                    {size}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {/* Branch Picker */}
          {availableBranches.length > 0 && (
            <div className="mb-8">
              <h3 className="mb-3 font-medium flex items-center gap-2">
                <MapPin className="h-4 w-4" />
                Pilih Cabang
              </h3>
              <div className="flex flex-col gap-2">
                {availableBranches.map((b) => {
                  const isSelected = selectedBranchId === b.branchId;
                  return (
                    <button
                      key={b.branchId}
                      type="button"
                      onClick={() => setSelectedBranchId(b.branchId)}
                      className={`flex items-center justify-between gap-3 rounded-lg border p-3 text-left transition-colors ${
                        isSelected
                          ? "border-primary bg-primary/5"
                          : "border-input hover:bg-muted"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={`h-4 w-4 rounded-full border-2 flex items-center justify-center ${
                            isSelected
                              ? "border-primary"
                              : "border-muted-foreground/40"
                          }`}
                        >
                          {isSelected && (
                            <div className="h-2 w-2 rounded-full bg-primary" />
                          )}
                        </div>
                        <div>
                          <div className="text-sm font-medium">{b.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {b.city} · {b.code}
                          </div>
                        </div>
                      </div>
                      <Badge variant="secondary" className="ml-auto">
                        Stok: {b.stock}
                      </Badge>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Quantity & Actions */}
          <div className="flex flex-col sm:flex-row gap-4 mb-8">
            <div className="flex items-center border border-input rounded-md w-fit">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setQuantity(Math.max(1, quantity - 1))}
                className="h-10 w-10 text-muted-foreground hover:text-foreground"
              >
                <Minus className="w-4 h-4" />
              </Button>
              <input
                type="text"
                value={quantity}
                readOnly
                className="w-12 text-center border-none bg-transparent focus:outline-none"
              />
              <Button
                variant="ghost"
                size="icon"
                onClick={() =>
                  setQuantity(
                    selectedBranchStock
                      ? Math.min(selectedBranchStock.stock, quantity + 1)
                      : quantity + 1
                  )
                }
                className="h-10 w-10 text-muted-foreground hover:text-foreground"
              >
                <Plus className="w-4 h-4" />
              </Button>
            </div>

            <Button
              className="flex-1 gap-2"
              size="lg"
              disabled={addingToCart || !selectedBranchId}
              onClick={handleAddToCart}
            >
              <ShoppingCart className="w-5 h-5" />
              {addingToCart ? "Menambahkan..." : "Masukkan Keranjang"}
            </Button>

            <div className="flex gap-2">
              <Button variant="outline" size="icon" className="h-11 w-11">
                <Heart className="w-5 h-5" />
              </Button>
              <Button variant="outline" size="icon" className="h-11 w-11">
                <Share2 className="w-5 h-5" />
              </Button>
            </div>
          </div>

          <div className="bg-green-50 text-green-700 p-4 rounded-lg flex gap-3 items-center border border-green-100">
            <div className="bg-green-100 p-2 rounded-full">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
            </div>
            <div>
              <div className="font-bold text-sm">Garansi 100% Original</div>
              <div className="text-xs text-green-600">
                Garansi uang kembali jika produk palsu.
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Branch Switch Confirmation Modal removed — cart now supports
          items from multiple branches simultaneously. Branch grouping and
          single-branch checkout is enforced on the checkout page. */}

      {/* Description */}
      <div className="mt-16">
        <div className="flex border-b border-border mb-8">
          <button className="px-8 py-4 border-b-2 border-primary text-primary font-bold bg-transparent">
            Deskripsi
          </button>
        </div>

        <div className="max-w-3xl leading-relaxed text-muted-foreground">
          {product.description ? (
            <p className="mb-4 whitespace-pre-line">{product.description}</p>
          ) : (
            <p className="mb-4 text-muted-foreground italic">
              Tidak ada deskripsi.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

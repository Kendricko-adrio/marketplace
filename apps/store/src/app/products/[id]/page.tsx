"use client";
import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Image from "next/image";
import { toast } from "sonner";
import { ShoppingCart, Minus, Plus, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useCart } from "@/providers/cart-provider";
import { computeDiscountPercent } from "@/lib/pricing";

interface BranchStock {
  branchId: string;
  name: string;
  code: string;
  city: string;
  stock: number;
  reservedStock: number;
  available: number;
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

interface ProductCategory {
  id: string;
  name: string;
  slug: string;
}

interface Product {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  basePrice: string;
  status: string;
  brand: string | null;
  gender: string | null;
  collection: string | null;
  season: string | null;
  articleNumber: string | null;
  categories: ProductCategory[];
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
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);

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
      setSelectedImageIndex(0);
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

  const currentPrice = parseFloat(selectedVariant?.price || product.basePrice);

  const originalPrice = parseFloat(product.basePrice);
  const discount = computeDiscountPercent(originalPrice, currentPrice);

  const availableBranches = selectedVariant?.branchStock ?? [];
  const selectedBranchStock = availableBranches.find(
    (b) => b.branchId === selectedBranchId
  );
  const stockLabel = selectedBranchId
    ? `Stok: ${selectedBranchStock?.available ?? 0}`
    : availableBranches.length > 0
    ? "Pilih cabang"
    : "Stok habis di semua cabang";

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
        {/* Image Gallery */}
        <div>
          <div className="aspect-square bg-secondary/50 rounded-xl mb-4 relative">
            {selectedVariant?.images[selectedImageIndex] && (
              <Image
                src={selectedVariant.images[selectedImageIndex]}
                alt={product.name}
                fill
                className="object-cover rounded-xl"
              />
            )}
          </div>
          <div className="grid grid-cols-4 gap-4">
            {(selectedVariant?.images || []).slice(0, 4).map((img, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setSelectedImageIndex(i)}
                className={`aspect-square bg-secondary/30 rounded-lg cursor-pointer border-2 ${
                  i === selectedImageIndex
                    ? "border-primary"
                    : "border-transparent hover:border-primary/50"
                } transition-colors relative overflow-hidden`}
              >
                {img && (
                  <Image src={img} alt="" fill className="object-cover" />
                )}
              </button>
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
                        Stok: {b.available}
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
                      ? Math.min(selectedBranchStock.available, quantity + 1)
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

          </div>

          {/* Brand / Gender / Collection / Season / Article / SKU metadata */}
          {(product.brand ||
            product.gender ||
            product.collection ||
            product.season ||
            product.articleNumber ||
            selectedVariant?.sku) && (
            <dl className="grid grid-cols-2 sm:grid-cols-3 gap-4 border-t border-border pt-6 text-sm">
              {product.brand && (
                <div>
                  <dt className="text-muted-foreground">Brand</dt>
                  <dd className="font-medium">{product.brand}</dd>
                </div>
              )}
              {product.gender && (
                <div>
                  <dt className="text-muted-foreground">Gender</dt>
                  <dd className="font-medium">{product.gender}</dd>
                </div>
              )}
              {product.collection && (
                <div>
                  <dt className="text-muted-foreground">Koleksi</dt>
                  <dd className="font-medium">{product.collection}</dd>
                </div>
              )}
              {product.season && (
                <div>
                  <dt className="text-muted-foreground">Season</dt>
                  <dd className="font-medium">{product.season}</dd>
                </div>
              )}
              {product.articleNumber && (
                <div>
                  <dt className="text-muted-foreground">Kode Artikel</dt>
                  <dd className="font-medium">{product.articleNumber}</dd>
                </div>
              )}
              {selectedVariant?.sku && (
                <div>
                  <dt className="text-muted-foreground">SKU</dt>
                  <dd className="font-medium">{selectedVariant.sku}</dd>
                </div>
              )}
            </dl>
          )}

          {/* Categories */}
          {product.categories.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {product.categories.map((cat) => (
                <span
                  key={cat.id}
                  className="inline-flex items-center rounded-md bg-primary/10 text-primary px-2.5 py-1 text-xs font-medium"
                >
                  {cat.name}
                </span>
              ))}
            </div>
          )}
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
            // Jubelio sends the description as HTML (<p>, <br>, ...). It's
            // trusted content from the Jubelio master data, so we render it
            // directly. Arbitrary-variant spacing keeps paragraphs readable
            // without depending on the typography plugin.
            <div
              className="[&_p]:mb-4 [&_p:last-child]:mb-0 [&_br]:block [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:mb-1"
              dangerouslySetInnerHTML={{ __html: product.description }}
            />
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

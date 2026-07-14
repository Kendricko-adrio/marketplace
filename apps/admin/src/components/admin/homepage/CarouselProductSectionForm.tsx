"use client";
import { useEffect, useState } from "react";
import { Search, ChevronUp, ChevronDown, Loader2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { CarouselProductSection } from "@marketplace/ui";
import type { HomepageSectionData, HomepageProduct } from "@marketplace/ui";
import { toStoreUrl } from "@/lib/store-url";

interface CarouselProductSectionFormProps {
  selectedProductIds: string[];
  onChange: (ids: string[]) => void;
  title: string;
  subtitle: string;
}

interface AdminProduct {
  id: string;
  name: string;
  slug: string;
  basePrice: string;
  status: string;
  rating: string | null;
  sold: number;
  isFlashSale: boolean;
  flashSalePrice: string | null;
  variantCount: number;
  variants?: { id: string; price: string; isDefault: boolean }[];
  images?: { url: string }[];
}

export default function CarouselProductSectionForm({
  selectedProductIds,
  onChange,
  title,
  subtitle,
}: CarouselProductSectionFormProps) {
  const [allProducts, setAllProducts] = useState<AdminProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    const fetchProducts = async () => {
      try {
        const res = await fetch("/api/admin/products?limit=100");
        const data = await res.json();
        if (data.success) setAllProducts(data.data);
      } catch (error) {
        console.error("Error fetching products:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchProducts();
  }, []);

  const toggleProduct = (id: string) => {
    if (selectedProductIds.includes(id)) {
      onChange(selectedProductIds.filter((pid) => pid !== id));
    } else {
      onChange([...selectedProductIds, id]);
    }
  };

  const moveUp = (index: number) => {
    if (index === 0) return;
    const newIds = [...selectedProductIds];
    [newIds[index - 1], newIds[index]] = [newIds[index], newIds[index - 1]];
    onChange(newIds);
  };

  const moveDown = (index: number) => {
    if (index === selectedProductIds.length - 1) return;
    const newIds = [...selectedProductIds];
    [newIds[index], newIds[index + 1]] = [newIds[index + 1], newIds[index]];
    onChange(newIds);
  };

  const filtered = allProducts.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase())
  );

  const previewProducts: HomepageProduct[] = selectedProductIds
    .map((id) => {
      const p = allProducts.find((ap) => ap.id === id);
      if (!p) return null;
      const variant = p.variants?.find((v) => v.isDefault);
      const price = variant?.price ?? p.basePrice;
      return {
        id: p.id,
        name: p.name,
        slug: p.slug,
        price: parseFloat(price),
        basePrice: parseFloat(p.basePrice),
        image: toStoreUrl(p.images?.[0]?.url) || null,
        rating: p.rating,
        sold: p.sold,
        isFlashSale: p.isFlashSale,
        flashSalePrice: p.flashSalePrice,
      };
    })
    .filter((x): x is HomepageProduct => x !== null);

  const previewSection: HomepageSectionData = {
    id: "preview",
    type: "carousel_product",
    title: title || null,
    subtitle: subtitle || null,
    content: {},
    displayOrder: 0,
    isActive: true,
    products: previewProducts,
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="space-y-4">
        <div className="space-y-2">
          <Label>Pilih Produk</Label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              className="flex h-10 w-full rounded-md border border-input bg-background pl-10 pr-3 py-2 text-sm"
              placeholder="Cari produk..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="border rounded-lg max-h-80 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="p-4 text-center text-sm text-muted-foreground">
                Tidak ada produk ditemukan
              </div>
            ) : (
              filtered.map((product) => {
                const selected = selectedProductIds.includes(product.id);
                return (
                  <label
                    key={product.id}
                    className="flex items-center gap-3 p-3 border-b last:border-b-0 hover:bg-accent/50 cursor-pointer"
                  >
                    <Checkbox
                      checked={selected}
                      onCheckedChange={() => toggleProduct(product.id)}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{product.name}</div>
                      <div className="text-xs text-muted-foreground">
                        Rp {parseFloat(product.basePrice).toLocaleString("id-ID")}
                      </div>
                    </div>
                    {selected && <Check className="h-4 w-4 text-primary" />}
                  </label>
                );
              })
            )}
          </div>
        )}

        {selectedProductIds.length > 0 && (
          <div className="space-y-2">
            <Label>Urutan Tampil ({selectedProductIds.length} produk)</Label>
            <div className="space-y-1">
              {selectedProductIds.map((id, index) => {
                const product = allProducts.find((p) => p.id === id);
                return (
                  <div
                    key={id}
                    className="flex items-center gap-2 p-2 border rounded-md text-sm"
                  >
                    <span className="text-muted-foreground font-mono w-6">
                      {index + 1}
                    </span>
                    <span className="flex-1 truncate">
                      {product?.name ?? id}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => moveUp(index)}
                      disabled={index === 0}
                    >
                      <ChevronUp className="h-3 w-3" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => moveDown(index)}
                      disabled={index === selectedProductIds.length - 1}
                    >
                      <ChevronDown className="h-3 w-3" />
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="rounded-lg border bg-muted/30 p-4">
        <p className="text-xs text-muted-foreground mb-2">Preview</p>
        {selectedProductIds.length === 0 ? (
          <div className="text-center py-8 text-sm text-muted-foreground">
            Pilih produk untuk melihat preview
          </div>
        ) : (
          <div className="rounded-md overflow-hidden">
            <CarouselProductSection section={previewSection} />
          </div>
        )}
      </div>
    </div>
  );
}
"use client";
import { useEffect, useMemo, useState } from "react";
import { Search, ChevronUp, ChevronDown, Loader2, Check, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CarouselProductSection } from "@marketplace/ui";
import type {
  HomepageSectionData,
  HomepageProduct,
  CarouselContent,
  ProductFilterConfig,
} from "@marketplace/ui";
import { toStoreUrl } from "@/lib/store-url";
import ProductFilterEditor from "./ProductFilterEditor";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 20;
const MIN_LIMIT = 1;
const PAGE_SIZE = 10;

interface CarouselProductSectionFormProps {
  content: Record<string, unknown>;
  onChange: (content: unknown) => void;
  selectedProductIds: string[];
  onSelectedIdsChange: (ids: string[]) => void;
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

interface AdminProductsResponse {
  success: boolean;
  data: AdminProduct[];
  pagination?: { page: number; limit: number; total: number; totalPages: number };
}

interface StoreProduct {
  id: string;
  name: string;
  slug: string;
  price: string;
  basePrice: string;
  rating: string | null;
  sold: number;
  isFlashSale: boolean;
  flashSalePrice: string | null;
  image: string | null;
}
interface StoreProductsResponse {
  success: boolean;
  data: StoreProduct[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

function normalizeContent(raw: Record<string, unknown>): CarouselContent {
  if (raw && typeof raw === "object" && (raw.mode === "manual" || raw.mode === "filter")) {
    return raw as unknown as CarouselContent;
  }
  // Legacy: no mode field. Treat as manual (junction table holds the selection).
  return { mode: "manual" };
}

function buildStoreQuery(filter: ProductFilterConfig, limit: number): string {
  const params = new URLSearchParams();
  if (filter.search) params.set("search", filter.search);
  if (filter.category) params.set("category", filter.category);
  if (filter.minPrice) params.set("minPrice", filter.minPrice);
  if (filter.maxPrice) params.set("maxPrice", filter.maxPrice);
  if (filter.flashSale) params.set("flashSale", "true");
  if (filter.sortOrder) {
    const order = filter.sortOrder;
    if (order === "priceAsc") {
      params.set("sortOrder", "asc");
      params.set("sortBy", "price");
    } else if (order === "priceDesc") {
      params.set("sortOrder", "desc");
      params.set("sortBy", "price");
    } else if (order === "bestseller") {
      params.set("sortOrder", "desc");
      params.set("sortBy", "sold");
    } else if (order === "rating") {
      params.set("sortOrder", "desc");
      params.set("sortBy", "rating");
    } else {
      params.set("sortOrder", "desc");
      params.set("sortBy", "createdAt");
    }
  }
  params.set("limit", String(limit));
  params.set("page", "1");
  return params.toString();
}

export default function CarouselProductSectionForm({
  content,
  onChange,
  selectedProductIds,
  onSelectedIdsChange,
}: CarouselProductSectionFormProps) {
  const carousel = normalizeContent(content);
  const mode = carousel.mode;
  const filter = useMemo(() => carousel.filter ?? {}, [carousel.filter]);
  const limit = carousel.limit ?? DEFAULT_LIMIT;

  const [allProducts, setAllProducts] = useState<AdminProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  // Preview sample for filter mode
  const [previewProducts, setPreviewProducts] = useState<HomepageProduct[]>([]);
  const [loadingPreview, setLoadingPreview] = useState(false);

  useEffect(() => {
    if (mode !== "manual") return;
    const fetchProducts = async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        params.set("limit", String(PAGE_SIZE));
        params.set("page", String(page));
        if (search) params.set("search", search);
        const res = await fetch(`/api/admin/products?${params.toString()}`);
        const data: AdminProductsResponse = await res.json();
        if (data.success) {
          setAllProducts(data.data);
          if (data.pagination) {
            setTotalPages(data.pagination.totalPages);
            setTotal(data.pagination.total);
          }
        }
      } catch (error) {
        console.error("Error fetching products:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchProducts();
  }, [mode, page, search]);

  // Fetch preview sample whenever filter/limit changes (filter mode only)
  useEffect(() => {
    if (mode !== "filter") return;
    let cancelled = false;
    const fetchPreview = async () => {
      setLoadingPreview(true);
      try {
        const qs = buildStoreQuery(filter, limit);
        // Use the admin-side proxy route to avoid cross-origin CORS issues
        // (admin runs on port 3001, store on port 3000). The proxy forwards
        // server-side, which is not subject to browser CORS.
        const res = await fetch(`/api/admin/homepage/preview-products?${qs}`, {
          cache: "no-store",
        });
        const data: StoreProductsResponse = await res.json();
        if (!cancelled && data.success) {
          setPreviewProducts(
            data.data.map((p) => ({
              id: p.id,
              name: p.name,
              slug: p.slug,
              price: parseFloat(p.price),
              basePrice: parseFloat(p.basePrice),
              image: p.image ? toStoreUrl(p.image) : null,
              rating: p.rating,
              sold: p.sold,
              isFlashSale: p.isFlashSale,
              flashSalePrice: p.flashSalePrice,
            }))
          );
        }
      } catch (error) {
        console.error("Error fetching preview products:", error);
      } finally {
        if (!cancelled) setLoadingPreview(false);
      }
    };
    const t = setTimeout(fetchPreview, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [mode, filter, limit]);

  const setMode = (newMode: "manual" | "filter") => {
    if (newMode === "manual") {
      onChange({ mode: "manual" });
    } else {
      onChange({ mode: "filter", filter, limit });
    }
  };

  const updateFilter = (newFilter: ProductFilterConfig) => {
    onChange({ mode: "filter", filter: newFilter, limit });
  };

  const updateLimit = (v: number) => {
    const clamped = Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, v));
    if (mode === "filter") {
      onChange({ mode: "filter", filter, limit: clamped });
    } else {
      onChange({ mode: "manual", limit: clamped });
    }
  };

  const toggleProduct = (id: string) => {
    if (selectedProductIds.includes(id)) {
      onSelectedIdsChange(selectedProductIds.filter((pid) => pid !== id));
    } else {
      onSelectedIdsChange([...selectedProductIds, id]);
    }
  };

  const moveUp = (index: number) => {
    if (index === 0) return;
    const newIds = [...selectedProductIds];
    [newIds[index - 1], newIds[index]] = [newIds[index], newIds[index - 1]];
    onSelectedIdsChange(newIds);
  };

  const moveDown = (index: number) => {
    if (index === selectedProductIds.length - 1) return;
    const newIds = [...selectedProductIds];
    [newIds[index], newIds[index + 1]] = [newIds[index + 1], newIds[index]];
    onSelectedIdsChange(newIds);
  };

  const selectedPreviewProducts: HomepageProduct[] = selectedProductIds
    .map((id) => {
      // We only have full product info for currently-loaded page; cross-page selections
      // are preserved as id-only entries without a card preview.
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
    title: null,
    subtitle: null,
    content: {},
    displayOrder: 0,
    isActive: true,
    products: mode === "manual" ? selectedPreviewProducts : previewProducts,
  };

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label>Mode Carousel</Label>
        <Select value={mode} onValueChange={(v) => setMode(v as "manual" | "filter")}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="manual">Pilih Produk Manual</SelectItem>
            <SelectItem value="filter">Filter Otomatis</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          {mode === "manual"
            ? "Pilih produk satu per satu. Urutan bisa diatur manual."
            : "Produk ditampilkan otomatis berdasarkan filter. Limit produk bisa diatur."}
        </p>
      </div>

      {mode === "manual" ? (
        <>
          <div className="space-y-2">
            <Label>Cari Produk</Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                className="flex h-10 w-full rounded-md border border-input bg-background pl-10 pr-3 py-2 text-sm"
                placeholder="Cari produk..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
              />
            </div>
          </div>

          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <div className="border rounded-lg max-h-80 overflow-y-auto">
                {allProducts.length === 0 ? (
                  <div className="p-4 text-center text-sm text-muted-foreground">
                    Tidak ada produk ditemukan
                  </div>
                ) : (
                  allProducts.map((product) => {
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

              {totalPages > 1 && (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    Total: {total} produk
                  </span>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => setPage(Math.max(1, page - 1))}
                      disabled={page === 1}
                    >
                      <ChevronLeft className="h-3 w-3" />
                    </Button>
                    {Array.from({ length: totalPages }, (_, i) => i + 1)
                      .filter((p) => Math.abs(p - page) <= 2 || p === 1 || p === totalPages)
                      .map((p, i, arr) => {
                        const prev = arr[i - 1];
                        const showEllipsis = prev && p - prev > 1;
                        return (
                          <span key={p} className="flex items-center">
                            {showEllipsis && (
                              <span className="px-1 text-xs text-muted-foreground">…</span>
                            )}
                            <Button
                              type="button"
                              variant={p === page ? "default" : "outline"}
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => setPage(p)}
                            >
                              {p}
                            </Button>
                          </span>
                        );
                      })}
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => setPage(Math.min(totalPages, page + 1))}
                      disabled={page === totalPages}
                    >
                      <ChevronRight className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}

          {selectedProductIds.length > 0 && (
            <div className="space-y-2">
              <Label>Urutan Tampil ({selectedProductIds.length} produk dipilih)</Label>
              <div className="space-y-1">
                {selectedProductIds.map((id, index) => {
                  // Look up name from any loaded page we still hold in state.
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
              <p className="text-xs text-muted-foreground">
                Produk dari halaman lain tetap tersimpan meski tidak tampil di daftar di atas.
              </p>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="border rounded-lg p-3 space-y-3">
            <Label className="text-xs">Filter Produk</Label>
            <ProductFilterEditor
              value={filter}
              onChange={updateFilter}
              idPrefix="carousel-filter"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="carousel-limit">Jumlah Produk yang Tampil (limit)</Label>
            <div className="flex items-center gap-3">
              <input
                id="carousel-limit"
                type="number"
                min={MIN_LIMIT}
                max={MAX_LIMIT}
                className="flex h-10 w-24 rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={limit}
                onChange={(e) =>
                  updateLimit(parseInt(e.target.value || String(DEFAULT_LIMIT), 10))
                }
              />
              <span className="text-xs text-muted-foreground">
                {MIN_LIMIT}-{MAX_LIMIT} produk. Default {DEFAULT_LIMIT}.
              </span>
            </div>
          </div>

          <div className="rounded-lg border bg-muted/30 p-4">
            <p className="text-xs text-muted-foreground mb-2">
              Preview produk yang akan muncul (berdasarkan filter)
            </p>
            {loadingPreview ? (
              <div className="flex justify-center py-6">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : previewProducts.length === 0 ? (
              <div className="text-center py-6 text-sm text-muted-foreground">
                Tidak ada produk yang cocok dengan filter
              </div>
            ) : (
              <div className="rounded-md overflow-hidden">
                <CarouselProductSection section={previewSection} preview />
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-2">
              Produk diambil dinamis saat customer melihat homepage. Selalu update tanpa
              perlu edit section.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
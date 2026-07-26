"use client";
import { useEffect, useState } from "react";
import { Loader2, Eye } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  HomepageSectionRenderer,
  type HomepageSectionData,
  type HomepageProduct,
  type CarouselContent,
  type ProductFilterConfig,
} from "@marketplace/ui";
import BannerSectionForm from "./BannerSectionForm";
import CarouselProductSectionForm from "./CarouselProductSectionForm";
import PromoCardsSectionForm from "./PromoCardsSectionForm";
import AnnouncementBarSectionForm from "./AnnouncementBarSectionForm";
import StoreBannerSectionForm from "./StoreBannerSectionForm";
import { toStoreUrl } from "@/lib/store-url";

interface HomepageSectionFormProps {
  mode: "create" | "edit";
  type: string;
  initialData?: {
    id?: string;
    type: string;
    title: string | null;
    subtitle: string | null;
    content: unknown;
    displayOrder?: number;
    isActive?: boolean;
    products?: { id: string; name: string; slug: string; displayOrder: number }[];
  };
  onSubmit: (data: Record<string, unknown>) => Promise<void>;
}

interface AdminProduct {
  id: string;
  name: string;
  slug: string;
  basePrice: string;
  rating: string | null;
  sold: number;
  isFlashSale: boolean;
  flashSalePrice: string | null;
  variants?: { id: string; price: string; isDefault: boolean }[];
  images?: { url: string }[];
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

export default function HomepageSectionForm({
  mode,
  type,
  initialData,
  onSubmit,
}: HomepageSectionFormProps) {
  const [title, setTitle] = useState(initialData?.title ?? "");
  const [subtitle, setSubtitle] = useState(initialData?.subtitle ?? "");
  const [isActive, setIsActive] = useState(initialData?.isActive ?? true);
  const [content, setContent] = useState<unknown>(initialData?.content ?? {});
  const [productIds, setProductIds] = useState<string[]>(
    initialData?.products
      ? [...initialData.products].sort((a, b) => a.displayOrder - b.displayOrder).map((p) => p.id)
      : []
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  // Preview products for carousel modal — fetched when the modal opens.
  const [previewProducts, setPreviewProducts] = useState<HomepageProduct[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        type,
        title: title.trim() || null,
        subtitle: subtitle.trim() || null,
        content,
        isActive,
      };
      if (type === "carousel_product") {
        const carouselContent = (content ?? {}) as Partial<CarouselContent>;
        if (carouselContent.mode === "filter") {
          // Filter mode: don't send productIds — clear them so the API empties the junction.
          payload.productIds = [];
        } else {
          // Manual mode: send the selected product ids.
          payload.productIds = productIds;
        }
      }
      await onSubmit(payload);
      toast.success(
        mode === "create" ? "Section berhasil dibuat" : "Perubahan section tersimpan"
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Terjadi kesalahan";
      setError(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const showTitleField = type !== "announcement_bar";

  // Build a preview HomepageSectionData that mirrors what the store will render.
  const buildPreviewSection = (): HomepageSectionData => {
    const c = content as Record<string, unknown> | undefined;
    // Rewrite image URLs to store origin for banner & promo cards.
    let rewrittenContent = content;
    if (c && typeof c === "object") {
      if (Array.isArray(c.slides)) {
        rewrittenContent = {
          ...c,
          slides: c.slides.map(
            (s) =>
              s && typeof s === "object" && typeof (s as Record<string, unknown>).imageUrl === "string"
                ? {
                    ...(s as Record<string, unknown>),
                    imageUrl: toStoreUrl((s as Record<string, unknown>).imageUrl as string),
                  }
                : s
          ),
        };
      } else if (Array.isArray(c.cards)) {
        rewrittenContent = {
          ...c,
          cards: c.cards.map(
            (card) =>
              card && typeof card === "object" && typeof (card as Record<string, unknown>).imageUrl === "string"
                ? {
                    ...(card as Record<string, unknown>),
                    imageUrl: toStoreUrl((card as Record<string, unknown>).imageUrl as string),
                  }
                : card
          ),
        };
      } else if (typeof c.imageUrl === "string") {
        rewrittenContent = { ...c, imageUrl: toStoreUrl(c.imageUrl) };
      }
    }
    const section: HomepageSectionData = {
      id: "preview",
      type: type as HomepageSectionData["type"],
      title: title.trim() || null,
      subtitle: subtitle.trim() || null,
      content: rewrittenContent,
      displayOrder: 0,
      isActive: true,
    };
    // For carousel sections, attach preview products (fetched on modal open).
    if (type === "carousel_product") {
      section.products = previewProducts;
    }
    return section;
  };

  const previewSection = buildPreviewSection();

  // When the preview modal opens for a carousel section, fetch the matching
  // products so the carousel renderer has data to render. Without this the
  // carousel preview shows nothing (renderer returns null on empty products).
  useEffect(() => {
    if (!previewOpen || type !== "carousel_product") return;
    let cancelled = false;

    const fetchPreviewProducts = async () => {
      setPreviewLoading(true);
      try {
        const carouselContent = (content ?? {}) as Partial<CarouselContent>;
        if (carouselContent.mode === "filter") {
          // Filter mode: query the admin-side proxy that forwards to the
          // store /api/products endpoint with the saved filter + limit.
          const filter = carouselContent.filter ?? {};
          const limit = carouselContent.limit ?? 10;
          const qs = buildStoreQuery(filter, limit);
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
        } else {
          // Manual mode: hydrate preview products from the admin products API
          // using the selected product ids (preserve their order).
          if (productIds.length === 0) {
            setPreviewProducts([]);
            return;
          }
          const res = await fetch(`/api/admin/products?limit=100`, { cache: "no-store" });
          const data: { success: boolean; data: AdminProduct[] } = await res.json();
          if (!cancelled && data.success) {
            // Preserve selected order from productIds.
            const map = new Map(data.data.map((p) => [p.id, p]));
            const products: HomepageProduct[] = [];
            for (const id of productIds) {
              const p = map.get(id);
              if (!p) continue;
              const variant = p.variants?.find((v) => v.isDefault);
              const price = variant?.price ?? p.basePrice;
              products.push({
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
              });
            }
            setPreviewProducts(products);
          }
        }
      } catch (error) {
        console.error("Error fetching preview products:", error);
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    };

    fetchPreviewProducts();
    return () => {
      cancelled = true;
    };
    // Re-fetch when the modal opens or when the carousel content/selection
    // changes while the modal is open.
  }, [previewOpen, type, content, productIds]);

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm text-muted-foreground">
          Mode: <span className="font-medium text-foreground">{mode === "create" ? "Buat baru" : "Edit"}</span>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setPreviewOpen(true)}
          className="gap-2"
        >
          <Eye className="h-4 w-4" /> Preview Section
        </Button>
      </div>

      {showTitleField && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="title">Judul</Label>
            <input
              id="title"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Judul section"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="subtitle">Subtitle</Label>
            <input
              id="subtitle"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={subtitle}
              onChange={(e) => setSubtitle(e.target.value)}
              placeholder="Subtitle (opsional)"
            />
          </div>
        </div>
      )}

      {type === "banner" && (
        <BannerSectionForm
          content={content as Record<string, unknown>}
          onChange={setContent}
        />
      )}
      {type === "carousel_product" && (
        <CarouselProductSectionForm
          content={content as Record<string, unknown>}
          onChange={setContent}
          selectedProductIds={productIds}
          onSelectedIdsChange={setProductIds}
        />
      )}
      {type === "promo_cards" && (
        <PromoCardsSectionForm
          content={content as Record<string, unknown>}
          onChange={setContent}
        />
      )}
      {type === "announcement_bar" && (
        <AnnouncementBarSectionForm
          content={content as Record<string, unknown>}
          onChange={setContent}
        />
      )}
      {type === "store_banner" && <StoreBannerSectionForm />}

      <div className="flex items-center gap-3 pt-4 border-t">
        <Switch checked={isActive} onCheckedChange={setIsActive} id="isActive" />
        <Label htmlFor="isActive">Aktif (tampilkan di homepage)</Label>
      </div>

      {error && (
        <div className="bg-destructive/10 text-destructive text-sm p-3 rounded-md">
          {error}
        </div>
      )}

      <div className="flex gap-3">
        <Button type="submit" disabled={submitting} className="gap-2">
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
          {mode === "create" ? "Buat Section" : "Simpan Perubahan"}
        </Button>
      </div>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-7xl w-[95vw] h-[85vh] p-0 overflow-hidden gap-0">
          <DialogHeader className="px-4 py-3 border-b">
            <DialogTitle>Preview Section</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto bg-background">
            {type === "carousel_product" && previewLoading ? (
              <div className="flex flex-col items-center justify-center py-20 gap-3">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  Memuat produk untuk preview...
                </p>
              </div>
            ) : type === "carousel_product" &&
              previewProducts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 gap-2 text-center px-4">
                <p className="text-sm text-muted-foreground">
                  {((content ?? {}) as Partial<CarouselContent>).mode === "filter"
                    ? "Tidak ada produk yang cocok dengan filter. Sesuaikan filter atau limit lalu coba lagi."
                    : "Belum ada produk yang dipilih. Pilih produk di form terlebih dahulu."}
                </p>
              </div>
            ) : (
              <div className="w-full">
                <HomepageSectionRenderer section={previewSection} preview />
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </form>
  );
}
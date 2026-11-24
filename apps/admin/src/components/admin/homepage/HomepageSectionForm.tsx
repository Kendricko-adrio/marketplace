"use client";
import { useCallback, useEffect, useState } from "react";
import { Loader2, Eye } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
  buildStoreFilterQuery,
  type HomepageSectionData,
  type HomepageProduct,
  type HomepageBranch,
  type CarouselContent,
} from "@marketplace/ui";
import BannerSectionForm from "./BannerSectionForm";
import CarouselProductSectionForm, {
  type AdminProduct,
} from "./CarouselProductSectionForm";
import { useCarouselManualPreview } from "./use-carousel-manual-preview";
import PromoCardsSectionForm from "./PromoCardsSectionForm";
import AnnouncementBarSectionForm from "./AnnouncementBarSectionForm";
import StoreBannerSectionForm from "./StoreBannerSectionForm";
import { toStoreUrl } from "@/lib/store-url";
import {
  normalizeCarouselContentForSave,
  resolveCarouselMode,
} from "@/lib/homepage-content";

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

interface StoreProduct {
  id: string;
  name: string;
  slug: string;
  price: string;
  basePrice: string;
  image: string | null;
}
interface StoreProductsResponse {
  success: boolean;
  data: StoreProduct[];
}

/**
 * One short line per section type, rendered as the "Konten Section" card
 * description. It says what the type actually needs from the admin, so the
 * card header carries information instead of just repeating the field labels.
 */
const CONTENT_HINTS: Record<string, string> = {
  banner: "Atur slide banner, teks tombol, dan tautan CTA.",
  carousel_product: "Pilih produk secara manual atau pakai filter otomatis.",
  promo_cards: "Atur kartu promosi beserta tautan filternya.",
  announcement_bar: "Tulis pesan pengumuman dan pilih varian warnanya.",
  store_banner: "Tidak ada konfigurasi tambahan untuk section ini.",
};

const DEFAULT_CONTENT_HINT = "Atur isi section ini.";

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
  // Preview branches for store_banner modal — fetched when the modal opens.
  const [previewBranches, setPreviewBranches] = useState<HomepageBranch[]>([]);
  const [previewBranchesLoading, setPreviewBranchesLoading] = useState(false);
  // Rows the product picker has loaded. They become preview cards without an
  // extra lookup and stay cached after the admin changes picker page/search.
  const [pickerRows, setPickerRows] = useState<AdminProduct[]>([]);
  const handleLoadedProducts = useCallback((rows: AdminProduct[]) => {
    setPickerRows((previous) => {
      const known = new Set(previous.map((row) => row.id));
      const added = rows.filter((row) => !known.has(row.id));
      return added.length > 0 ? [...previous, ...added] : previous;
    });
  }, []);
  const carouselMode = resolveCarouselMode(content);
  const manualPreview = useCarouselManualPreview({
    enabled: type === "carousel_product" && carouselMode === "manual",
    ids: productIds,
    seedRows: pickerRows,
  });

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
        // The editor starts from an empty object in manual mode and the picker
        // does not write a mode, while the API rejects carousel content without
        // one. Normalize here so saving from the default mode works.
        const carouselContent = normalizeCarouselContentForSave(content);
        payload.content = carouselContent;
        payload.productIds =
          resolveCarouselMode(carouselContent) === "filter" ? [] : productIds;
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
    // For carousel sections, attach preview products: the same resolved cards
    // the inline manual preview shows, or the filter sample.
    if (type === "carousel_product") {
      section.products =
        carouselMode === "manual" ? manualPreview.products : previewProducts;
    }
    // For store_banner sections, attach preview branches (fetched on modal
    // open). Without this the renderer receives no branches and renders null.
    if (type === "store_banner") {
      section.branches = previewBranches;
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
        // Manual mode needs no fetch here: the inline preview already resolved
        // the same cards (ordered picks), and the renderer below reads them.
        if (carouselContent.mode !== "filter") {
          setPreviewProducts([]);
          return;
        }
        // Filter mode: query the admin-side proxy that forwards to the
        // store /api/products endpoint with the saved filter + limit.
        const filter = carouselContent.filter ?? {};
        const limit = carouselContent.limit ?? 10;
        const qs = buildStoreFilterQuery(filter, limit);
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
            }))
          );
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

  // When the preview modal opens for a store_banner section, fetch the active
  // branches so the renderer has data to render. Without this the store banner
  // preview shows nothing (renderer returns null on empty branches).
  useEffect(() => {
    if (!previewOpen || type !== "store_banner") return;
    let cancelled = false;

    const fetchPreviewBranches = async () => {
      setPreviewBranchesLoading(true);
      try {
        const res = await fetch("/api/admin/homepage/preview-branches", {
          cache: "no-store",
        });
        const data = await res.json();
        if (!cancelled && data.success) {
          setPreviewBranches(data.data);
        }
      } catch (error) {
        console.error("Error fetching preview branches:", error);
      } finally {
        if (!cancelled) setPreviewBranchesLoading(false);
      }
    };

    fetchPreviewBranches();
    return () => {
      cancelled = true;
    };
  }, [previewOpen, type]);

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
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
        <Card>
          <CardHeader>
            <CardTitle>
              <h3>Informasi Section</h3>
            </CardTitle>
            <CardDescription>
              Judul dan subtitle yang tampil di atas section.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="title">Judul</Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Judul section"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="subtitle">Subtitle</Label>
              <Input
                id="subtitle"
                value={subtitle}
                onChange={(e) => setSubtitle(e.target.value)}
                placeholder="Subtitle (opsional)"
              />
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>
            <h3>Konten Section</h3>
          </CardTitle>
          <CardDescription>
            {CONTENT_HINTS[type] ?? DEFAULT_CONTENT_HINT}
          </CardDescription>
        </CardHeader>
        <CardContent>
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
              preview={manualPreview}
              onLoadedProducts={handleLoadedProducts}
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h3>Status Section</h3>
          </CardTitle>
          <CardDescription>
            Section nonaktif tidak tampil di ADFSport.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-center gap-3">
          <Switch checked={isActive} onCheckedChange={setIsActive} id="isActive" />
          <Label htmlFor="isActive">Aktif (tampilkan di homepage)</Label>
        </CardContent>
      </Card>

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
            {type === "carousel_product" &&
            (carouselMode === "filter"
              ? previewLoading
              : manualPreview.status === "loading") ? (
              <div className="flex flex-col items-center justify-center py-20 gap-3">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  Memuat produk untuk preview...
                </p>
              </div>
            ) : type === "carousel_product" &&
              (carouselMode === "filter"
                ? previewProducts.length === 0
                : manualPreview.products.length === 0) ? (
              <div className="flex flex-col items-center justify-center py-20 gap-2 text-center px-4">
                <p className="text-sm text-muted-foreground">
                  {carouselMode === "filter"
                    ? "Tidak ada produk yang cocok dengan filter. Sesuaikan filter atau limit lalu coba lagi."
                    : (manualPreview.message ??
                      "Belum ada produk yang dipilih. Pilih produk di form terlebih dahulu.")}
                </p>
                {type === "carousel_product" &&
                  carouselMode === "manual" &&
                  manualPreview.canRetry && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={manualPreview.retry}
                    >
                      Coba lagi
                    </Button>
                  )}
              </div>
            ) : type === "store_banner" && previewBranchesLoading ? (
              <div className="flex flex-col items-center justify-center py-20 gap-3">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  Memuat cabang untuk preview...
                </p>
              </div>
            ) : type === "store_banner" && previewBranches.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 gap-2 text-center px-4">
                <p className="text-sm text-muted-foreground">
                  Tidak ada cabang aktif. Atur status cabang ke &quot;Aktif&quot;
                  di halaman Kelola Cabang agar muncul di homepage.
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
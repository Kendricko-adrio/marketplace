"use client";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import BannerSectionForm from "./BannerSectionForm";
import CarouselProductSectionForm from "./CarouselProductSectionForm";
import PromoCardsSectionForm from "./PromoCardsSectionForm";
import AnnouncementBarSectionForm from "./AnnouncementBarSectionForm";
import StoreBannerSectionForm from "./StoreBannerSectionForm";

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
        payload.productIds = productIds;
      }
      await onSubmit(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Terjadi kesalahan");
    } finally {
      setSubmitting(false);
    }
  };

  const showTitleField = type !== "announcement_bar";

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
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
          title={title}
          subtitle={subtitle}
        />
      )}
      {type === "carousel_product" && (
        <CarouselProductSectionForm
          selectedProductIds={productIds}
          onChange={setProductIds}
          title={title}
          subtitle={subtitle}
        />
      )}
      {type === "promo_cards" && (
        <PromoCardsSectionForm
          content={content as Record<string, unknown>}
          onChange={setContent}
          title={title}
          subtitle={subtitle}
        />
      )}
      {type === "announcement_bar" && (
        <AnnouncementBarSectionForm
          content={content as Record<string, unknown>}
          onChange={setContent}
        />
      )}
      {type === "store_banner" && (
        <StoreBannerSectionForm title={title} subtitle={subtitle} />
      )}

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
    </form>
  );
}
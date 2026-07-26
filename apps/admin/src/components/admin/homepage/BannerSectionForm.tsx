"use client";
import { useState, useRef } from "react";
import { Upload, Loader2, X, Plus, ChevronUp, ChevronDown, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { BannerContent, BannerSlide, ProductFilterConfig } from "@marketplace/ui";
import { buildProductFilterQuery } from "@marketplace/ui";
import { toStoreUrl } from "@/lib/store-url";
import ProductFilterEditor from "./ProductFilterEditor";

const MAX_SLIDES = 5;
const MIN_INTERVAL_SEC = 2;
const MAX_INTERVAL_SEC = 30;
const DEFAULT_INTERVAL_SEC = 5;

interface BannerSectionFormProps {
  content: Record<string, unknown>;
  onChange: (content: unknown) => void;
}

function normalizeContent(raw: Record<string, unknown>): Partial<BannerContent> {
  // Backward-compat: convert legacy single-image shape to slides array.
  const legacy = raw as unknown as { imageUrl?: string; altText?: string };
  if (typeof legacy.imageUrl === "string" && legacy.imageUrl !== "" && !Array.isArray(raw.slides)) {
    return {
      slides: [{ imageUrl: legacy.imageUrl, altText: legacy.altText }],
      ctaText: raw.ctaText as string | undefined,
      ctaLink: raw.ctaLink as string | undefined,
      autoRotateIntervalSec:
        typeof raw.autoRotateIntervalSec === "number" ? raw.autoRotateIntervalSec : undefined,
    };
  }
  return raw as unknown as Partial<BannerContent>;
}

export default function BannerSectionForm({
  content,
  onChange,
}: BannerSectionFormProps) {
  const banner = normalizeContent(content);
  const slides: BannerSlide[] = Array.isArray(banner.slides) ? banner.slides : [];
  const [uploadingIndex, setUploadingIndex] = useState<number | null>(null);
  const fileInputRefs = useRef<Map<number, HTMLInputElement>>(new Map());

  // CTA mode: "custom" = free-text URL (backward-compat for existing banners),
  // "filter" = ProductFilterConfig builder that assembles a /products?... URL.
  // Default to "custom" when a ctaLink already has a value, "filter" otherwise.
  const initialCtaMode: "custom" | "filter" = banner.ctaLink ? "custom" : "filter";
  const [ctaMode, setCtaMode] = useState<"custom" | "filter">(initialCtaMode);
  // Local filter state for the builder. Not persisted separately — its built URL
  // is written into `ctaLink` on every change.
  const [ctaFilter, setCtaFilter] = useState<ProductFilterConfig>({});
  const builtCtaUrl = buildProductFilterQuery(ctaFilter);

  const update = (patch: Partial<BannerContent>) => {
    onChange({ ...banner, ...patch });
  };

  const updateSlides = (newSlides: BannerSlide[]) => {
    update({ slides: newSlides });
  };

  const deleteOldImage = async (url: string) => {
    if (!url || !url.startsWith("/uploads/")) return;
    try {
      await fetch(`/api/admin/upload?url=${encodeURIComponent(url)}`, { method: "DELETE" });
    } catch (error) {
      console.error("Error deleting old file:", error);
    }
  };

  const addSlide = () => {
    if (slides.length >= MAX_SLIDES) {
      toast.error(`Maksimal ${MAX_SLIDES} slide`);
      return;
    }
    updateSlides([...slides, { imageUrl: "" }]);
  };

  const removeSlide = (index: number) => {
    const slide = slides[index];
    if (slide?.imageUrl) {
      deleteOldImage(slide.imageUrl);
    }
    const next = slides.filter((_, i) => i !== index);
    updateSlides(next);
  };

  const updateSlide = (index: number, patch: Partial<BannerSlide>) => {
    updateSlides(slides.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  };

  const moveSlide = (index: number, dir: "up" | "down") => {
    const target = dir === "up" ? index - 1 : index + 1;
    if (target < 0 || target >= slides.length) return;
    const next = [...slides];
    [next[index], next[target]] = [next[target], next[index]];
    updateSlides(next);
  };

  const handleUpload = async (index: number, file: File) => {
    setUploadingIndex(index);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/admin/upload?folder=homepage", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (data.success) {
        const slide = slides[index];
        if (slide?.imageUrl) {
          await deleteOldImage(slide.imageUrl);
        }
        updateSlide(index, { imageUrl: data.url });
        toast.success("Gambar berhasil diunggah");
      } else {
        toast.error(data.error || "Gagal upload gambar");
      }
    } catch (error) {
      console.error("Error uploading:", error);
      toast.error("Gagal upload gambar");
    } finally {
      setUploadingIndex(null);
    }
  };

  const handleFileChange = (index: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleUpload(index, file);
    e.target.value = "";
  };

  const handleClearImage = (index: number) => {
    const slide = slides[index];
    if (slide?.imageUrl) {
      deleteOldImage(slide.imageUrl);
    }
    updateSlide(index, { imageUrl: "" });
  };

  const clampInterval = (v: number) =>
    Math.min(MAX_INTERVAL_SEC, Math.max(MIN_INTERVAL_SEC, v));

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Slide Banner ({slides.length}/{MAX_SLIDES})</Label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addSlide}
            disabled={slides.length >= MAX_SLIDES}
            className="gap-2"
          >
            <Plus className="h-4 w-4" /> Tambah Slide
          </Button>
        </div>

        {slides.length === 0 ? (
          <div className="text-center py-8 border rounded-lg text-sm text-muted-foreground">
            Belum ada slide. Klik &quot;Tambah Slide&quot; untuk menambahkan gambar
            background. Slide akan berotasi otomatis.
          </div>
        ) : (
          <div className="space-y-3">
            {slides.map((slide, index) => (
              <div key={index} className="border rounded-lg p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Slide {index + 1}</span>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => moveSlide(index, "up")}
                      disabled={index === 0}
                    >
                      <ChevronUp className="h-3 w-3" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => moveSlide(index, "down")}
                      disabled={index === slides.length - 1}
                    >
                      <ChevronDown className="h-3 w-3" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-destructive"
                      onClick={() => removeSlide(index)}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-[160px_1fr] gap-3">
                  <div className="border rounded-md p-2 space-y-2">
                    {slide.imageUrl ? (
                      <div className="relative">
                        <img
                          src={toStoreUrl(slide.imageUrl)}
                          alt={slide.altText || `Slide ${index + 1}`}
                          className="w-full h-24 object-cover rounded"
                        />
                        <button
                          type="button"
                          onClick={() => handleClearImage(index)}
                          className="absolute top-1 right-1 bg-black/60 text-white p-1 rounded"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ) : (
                      <div className="w-full h-24 bg-muted rounded flex items-center justify-center text-muted-foreground text-xs">
                        Belum ada gambar
                      </div>
                    )}
                    <input
                      ref={(el) => {
                        if (el) fileInputRefs.current.set(index, el);
                      }}
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/gif"
                      className="hidden"
                      onChange={(e) => handleFileChange(index, e)}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="gap-2 w-full"
                      disabled={uploadingIndex === index}
                      onClick={() => fileInputRefs.current.get(index)?.click()}
                    >
                      {uploadingIndex === index ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Upload className="h-4 w-4" />
                      )}
                      Upload
                    </Button>
                  </div>

                  <div className="space-y-2">
                    <div className="space-y-1">
                      <Label className="text-xs">Alt Text (aksesibilitas)</Label>
                      <input
                        className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                        value={slide.altText ?? ""}
                        onChange={(e) => updateSlide(index, { altText: e.target.value })}
                        placeholder={`Deskripsi slide ${index + 1}`}
                      />
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="border-t pt-4 space-y-4">
        <p className="text-sm font-medium">Teks &amp; Tombol (digunakan bersama oleh semua slide)</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="ctaText">Teks Tombol CTA</Label>
            <input
              id="ctaText"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={banner.ctaText ?? ""}
              onChange={(e) => update({ ctaText: e.target.value })}
              placeholder="Belanja Sekarang"
            />
          </div>
          <div className="space-y-2">
            <Label>Mode Link CTA</Label>
            <div className="flex h-10 items-center gap-2">
              <Button
                type="button"
                variant={ctaMode === "custom" ? "default" : "outline"}
                size="sm"
                onClick={() => setCtaMode("custom")}
              >
                URL Manual
              </Button>
              <Button
                type="button"
                variant={ctaMode === "filter" ? "default" : "outline"}
                size="sm"
                onClick={() => {
                  setCtaMode("filter");
                  update({ ctaLink: builtCtaUrl });
                }}
              >
                Filter Produk
              </Button>
            </div>
          </div>
        </div>

        {ctaMode === "custom" ? (
          <div className="space-y-2">
            <Label htmlFor="ctaLink">Link CTA</Label>
            <input
              id="ctaLink"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={banner.ctaLink ?? ""}
              onChange={(e) => update({ ctaLink: e.target.value })}
              placeholder="/products"
            />
            <p className="text-xs text-muted-foreground">
              Tautan bebas. Arahkan ke halaman mana pun (mis. /products, /about, /account).
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="border rounded-lg p-3 space-y-3">
              <Label className="text-xs">Filter Produk</Label>
              <ProductFilterEditor
                value={ctaFilter}
                onChange={(v) => {
                  setCtaFilter(v);
                  update({ ctaLink: buildProductFilterQuery(v) });
                }}
                showSort={false}
                showFlashSale={false}
                idPrefix="cta-filter"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs" htmlFor="cta-built-url">
                Hasil Link
              </Label>
              <div className="flex items-center gap-2">
                <input
                  id="cta-built-url"
                  readOnly
                  className="flex h-9 flex-1 rounded-md border border-input bg-muted/40 px-3 py-2 text-sm font-mono text-muted-foreground"
                  value={builtCtaUrl}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  asChild
                >
                  <a
                    href={toStoreUrl(builtCtaUrl)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink className="h-4 w-4" />
                    Buka di Store
                  </a>
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Tombol CTA akan mengarah ke URL ini. Klik &quot;Buka di Store&quot; untuk
                pratinjau hasil filter di halaman storefront.
              </p>
            </div>
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="interval">
            Interval Auto-Rotate (detik)
          </Label>
          <div className="flex items-center gap-3">
            <input
              id="interval"
              type="number"
              min={MIN_INTERVAL_SEC}
              max={MAX_INTERVAL_SEC}
              className="flex h-10 w-24 rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={banner.autoRotateIntervalSec ?? DEFAULT_INTERVAL_SEC}
              onChange={(e) =>
                update({
                  autoRotateIntervalSec: clampInterval(parseInt(e.target.value || "0", 10)),
                })
              }
            />
            <span className="text-xs text-muted-foreground">
              {MIN_INTERVAL_SEC}-{MAX_INTERVAL_SEC} detik. Default {DEFAULT_INTERVAL_SEC}. Hanya
              berlaku jika ada lebih dari 1 slide. Auto-pause saat hover.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
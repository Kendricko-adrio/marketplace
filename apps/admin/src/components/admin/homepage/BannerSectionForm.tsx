"use client";
import { useState, useRef } from "react";
import { Upload, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { BannerSection } from "@marketplace/ui";
import type { HomepageSectionData, BannerContent } from "@marketplace/ui";
import { toStoreUrl } from "@/lib/store-url";

interface BannerSectionFormProps {
  content: Record<string, unknown>;
  onChange: (content: unknown) => void;
  title: string;
  subtitle: string;
}

export default function BannerSectionForm({
  content,
  onChange,
  title,
  subtitle,
}: BannerSectionFormProps) {
  const banner = content as Partial<BannerContent>;
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const update = (field: keyof BannerContent, value: string) => {
    onChange({ ...banner, [field]: value });
  };

  const deleteOldImage = async (url: string) => {
    if (!url || !url.startsWith("/uploads/")) return;
    try {
      await fetch(`/api/admin/upload?url=${encodeURIComponent(url)}`, {
        method: "DELETE",
      });
    } catch (error) {
      console.error("Error deleting old file:", error);
    }
  };

  const handleUpload = async (file: File) => {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/admin/upload?folder=homepage", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (data.success) {
        if (banner.imageUrl) {
          await deleteOldImage(banner.imageUrl);
        }
        update("imageUrl", data.url);
        toast.success("Gambar berhasil diunggah");
      } else {
        toast.error(data.error || "Gagal upload gambar");
      }
    } catch (error) {
      console.error("Error uploading:", error);
      toast.error("Gagal upload gambar");
    } finally {
      setUploading(false);
    }
  };

  const handleRemoveImage = () => {
    if (banner.imageUrl) {
      deleteOldImage(banner.imageUrl);
    }
    update("imageUrl", "");
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleUpload(file);
    e.target.value = "";
  };

  const previewSection: HomepageSectionData = {
    id: "preview",
    type: "banner",
    title: title || null,
    subtitle: subtitle || null,
    content: { ...banner, imageUrl: toStoreUrl(banner.imageUrl) },
    displayOrder: 0,
    isActive: true,
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="space-y-4">
        <div className="space-y-2">
          <Label>Gambar Banner</Label>
          <div className="border rounded-lg p-4 space-y-3">
            {banner.imageUrl ? (
              <div className="relative">
                <img
                  src={toStoreUrl(banner.imageUrl)}
                  alt="banner"
                  className="w-full h-32 object-cover rounded-md"
                />
                <button
                  type="button"
                  onClick={handleRemoveImage}
                  className="absolute top-1 right-1 bg-black/60 text-white p-1 rounded-md"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ) : (
              <div className="w-full h-32 bg-muted rounded-md flex items-center justify-center text-muted-foreground text-sm">
                Belum ada gambar
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              className="hidden"
              onChange={handleFileChange}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-2"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              Upload Gambar
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="altText">Alt Text (aksesibilitas)</Label>
          <input
            id="altText"
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={banner.altText ?? ""}
            onChange={(e) => update("altText", e.target.value)}
            placeholder="Deskripsi gambar untuk aksesibilitas"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="ctaText">Teks Tombol CTA</Label>
            <input
              id="ctaText"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={banner.ctaText ?? ""}
              onChange={(e) => update("ctaText", e.target.value)}
              placeholder="Belanja Sekarang"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ctaLink">Link CTA</Label>
            <input
              id="ctaLink"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={banner.ctaLink ?? ""}
              onChange={(e) => update("ctaLink", e.target.value)}
              placeholder="/products"
            />
          </div>
        </div>
      </div>

      <div className="rounded-lg border bg-muted/30 p-4">
        <p className="text-xs text-muted-foreground mb-2">Preview</p>
        <div className="rounded-md overflow-hidden">
          <BannerSection section={previewSection} preview />
        </div>
      </div>
    </div>
  );
}
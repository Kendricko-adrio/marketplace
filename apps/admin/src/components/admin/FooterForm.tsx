"use client";

import { useEffect, useState } from "react";
import { Loader2, AlertCircle, Plus, Trash2, GripVertical, Eye } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  SocialIcon,
  SOCIAL_PLATFORMS,
  SOCIAL_PLATFORM_LABELS,
  type SocialPlatform,
  type FooterConfigData,
} from "@marketplace/ui";
import {
  FooterLinkPicker,
  type LinkableDestinations,
} from "@/components/admin/footer/FooterLinkPicker";
import { FooterPreviewDialog } from "@/components/admin/footer/FooterPreviewDialog";

// ---- Constants mirroring server-side zod limits ----
const MAX_COLUMNS = 3;
const MAX_LINKS_PER_COLUMN = 5;

// ---- Local types for form state ----
interface FooterLinkForm {
  label: string;
  href: string;
}
interface FooterColumnForm {
  title: string;
  links: FooterLinkForm[];
}
interface SocialMediaForm {
  platform: SocialPlatform;
  url: string;
  enabled: boolean;
}
interface FooterConfigForm {
  brandName: string;
  tagline: string;
  columns: FooterColumnForm[];
  copyrightText: string;
  socialMedia: SocialMediaForm[];
}

// Pre-fill the social media array with all 7 platforms (disabled by default),
// preserving any URLs already present in initialData.
function buildSocialState(
  initial?: SocialMediaForm[] | undefined
): SocialMediaForm[] {
  const initialMap = new Map<SocialPlatform, SocialMediaForm>();
  if (Array.isArray(initial)) {
    for (const item of initial) {
      if (item?.platform) initialMap.set(item.platform, item);
    }
  }
  return SOCIAL_PLATFORMS.map((platform) => {
    const existing = initialMap.get(platform);
    return existing
      ? { platform, url: existing.url ?? "", enabled: existing.enabled ?? false }
      : { platform, url: "", enabled: false };
  });
}

interface FooterFormProps {
  initialData?: FooterConfigData | null;
}

export function FooterForm({ initialData }: FooterFormProps) {
  const [formData, setFormData] = useState<FooterConfigForm>({
    brandName: initialData?.brandName ?? "",
    tagline: initialData?.tagline ?? "",
    columns: Array.isArray(initialData?.columns)
      ? initialData!.columns.map((c) => ({
          title: c.title ?? "",
          links: Array.isArray(c.links)
            ? c.links.map((l) => ({ label: l.label ?? "", href: l.href ?? "" }))
            : [],
        }))
      : [],
    copyrightText: initialData?.copyrightText ?? "",
    socialMedia: buildSocialState(initialData?.socialMedia as SocialMediaForm[]),
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [destinations, setDestinations] = useState<LinkableDestinations | null>(
    null
  );

  // Fetch linkable destinations once on mount. Shared across all link rows.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/linkable-destinations")
      .then((r) => r.json())
      .then((json) => {
        if (cancelled || !json?.success) return;
        setDestinations(json.data as LinkableDestinations);
      })
      .catch((err) => {
        console.error("Error fetching linkable destinations:", err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // --- Field updaters ---
  function updateBrandName(value: string) {
    setFormData((p) => ({ ...p, brandName: value }));
  }
  function updateTagline(value: string) {
    setFormData((p) => ({ ...p, tagline: value }));
  }
  function updateCopyright(value: string) {
    setFormData((p) => ({ ...p, copyrightText: value }));
  }

  // --- Column operations ---
  function addColumn() {
    setFormData((p) => {
      if (p.columns.length >= MAX_COLUMNS) return p;
      return {
        ...p,
        columns: [...p.columns, { title: "", links: [] }],
      };
    });
  }
  function removeColumn(idx: number) {
    setFormData((p) => ({
      ...p,
      columns: p.columns.filter((_, i) => i !== idx),
    }));
  }
  function updateColumnTitle(idx: number, title: string) {
    setFormData((p) => {
      const next = [...p.columns];
      next[idx] = { ...next[idx], title };
      return { ...p, columns: next };
    });
  }

  // --- Link operations within a column ---
  function addLink(colIdx: number) {
    setFormData((p) => {
      const next = [...p.columns];
      const col = next[colIdx];
      if (col.links.length >= MAX_LINKS_PER_COLUMN) return p;
      next[colIdx] = { ...col, links: [...col.links, { label: "", href: "" }] };
      return { ...p, columns: next };
    });
  }
  function removeLink(colIdx: number, linkIdx: number) {
    setFormData((p) => {
      const next = [...p.columns];
      const col = next[colIdx];
      next[colIdx] = {
        ...col,
        links: col.links.filter((_, i) => i !== linkIdx),
      };
      return { ...p, columns: next };
    });
  }
  function updateLink(
    colIdx: number,
    linkIdx: number,
    field: "label" | "href",
    value: string
  ) {
    setFormData((p) => {
      const next = [...p.columns];
      const col = next[colIdx];
      const links = [...col.links];
      links[linkIdx] = { ...links[linkIdx], [field]: value };
      next[colIdx] = { ...col, links };
      return { ...p, columns: next };
    });
  }

  // --- Social media operations ---
  function updateSocial(
    platform: SocialPlatform,
    field: "url" | "enabled",
    value: string | boolean
  ) {
    setFormData((p) => {
      const next = p.socialMedia.map((s) =>
        s.platform === platform ? { ...s, [field]: value } : s
      );
      return { ...p, socialMedia: next };
    });
  }

  // --- Submit ---
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Light client-side validation; server-side zod is the source of truth.
    if (!formData.brandName.trim()) {
      setError("Nama brand wajib diisi.");
      return;
    }
    if (!formData.copyrightText.trim()) {
      setError("Teks copyright wajib diisi.");
      return;
    }
    for (const col of formData.columns) {
      if (!col.title.trim()) {
        setError("Setiap kolom harus memiliki judul.");
        return;
      }
      for (const link of col.links) {
        if (!link.label.trim() || !link.href.trim()) {
          setError("Setiap link harus memiliki label dan URL.");
          return;
        }
      }
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/footer", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || "Gagal menyimpan footer");
      }
      toast.success("Konfigurasi footer tersimpan");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Terjadi kesalahan";
      setError(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  // Preview config uses the same shape as the server stores, so the live
  // <Footer /> from @marketplace/ui can render it directly.
  const previewConfig: FooterConfigData = {
    brandName: formData.brandName,
    tagline: formData.tagline,
    columns: formData.columns,
    copyrightText: formData.copyrightText,
    socialMedia: formData.socialMedia,
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div className="bg-destructive/10 text-destructive text-sm p-3 rounded-md flex items-center gap-2">
          <AlertCircle className="h-4 w-4" />
          {error}
        </div>
      )}

      {/* Top action bar: Preview button */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-xs text-muted-foreground">
          Atur konten footer, lalu klik &quot;Preview&quot; untuk melihat tampilan
          pada lebar penuh.
        </p>
        <Button
          type="button"
          variant="outline"
          onClick={() => setPreviewOpen(true)}
          className="gap-2"
        >
          <Eye className="h-4 w-4" />
          Preview
        </Button>
      </div>

      {/* ===== EDITOR (full width) ===== */}
      <div className="space-y-6">
        {/* Brand section */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Brand
            </h3>
            <div className="space-y-2">
              <Label htmlFor="brandName">Nama Brand</Label>
              <Input
                id="brandName"
                value={formData.brandName}
                onChange={(e) => updateBrandName(e.target.value)}
                placeholder="StoreFront"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tagline">Tagline</Label>
              <Textarea
                id="tagline"
                value={formData.tagline}
                onChange={(e) => updateTagline(e.target.value)}
                placeholder="Belanja aman, nyaman, dan terpercaya..."
                rows={3}
                maxLength={300}
              />
              <p className="text-xs text-muted-foreground">
                {formData.tagline.length}/300 karakter
              </p>
            </div>
          </div>

          <Separator />

          {/* Columns section */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                Kolom Link
              </h3>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addColumn}
                disabled={formData.columns.length >= MAX_COLUMNS}
                className="gap-2"
              >
                <Plus className="h-4 w-4" />
                Tambah Kolom
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Maksimal {MAX_COLUMNS} kolom. Setiap kolom maksimal{" "}
              {MAX_LINKS_PER_COLUMN} link.
            </p>

            {formData.columns.length === 0 ? (
              <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                Belum ada kolom. Klik &quot;Tambah Kolom&quot; untuk membuatnya.
              </div>
            ) : (
              <div className="space-y-4">
                {formData.columns.map((col, colIdx) => (
                  <div
                    key={colIdx}
                    className="rounded-md border p-4 space-y-3 bg-muted/30"
                  >
                    <div className="flex items-center gap-2">
                      <GripVertical className="h-4 w-4 text-muted-foreground shrink-0" />
                      <Input
                        value={col.title}
                        onChange={(e) => updateColumnTitle(colIdx, e.target.value)}
                        placeholder="Judul kolom (mis. Layanan)"
                        className="flex-1"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeColumn(colIdx)}
                        className="text-destructive hover:text-destructive shrink-0"
                        aria-label="Hapus kolom"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>

                    <div className="pl-6 space-y-2">
                      {col.links.map((link, linkIdx) => (
                        <div key={linkIdx} className="flex items-center gap-2">
                          <Input
                            value={link.label}
                            onChange={(e) =>
                              updateLink(colIdx, linkIdx, "label", e.target.value)
                            }
                            placeholder="Label link"
                            className="flex-1"
                          />
                          <FooterLinkPicker
                            value={link.href}
                            destinations={destinations}
                            onChange={(href, autoLabel) => {
                              updateLink(colIdx, linkIdx, "href", href);
                              if (autoLabel && !link.label.trim()) {
                                updateLink(colIdx, linkIdx, "label", autoLabel);
                              }
                            }}
                            className="flex-1"
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => removeLink(colIdx, linkIdx)}
                            className="text-destructive hover:text-destructive shrink-0"
                            aria-label="Hapus link"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                      {col.links.length < MAX_LINKS_PER_COLUMN ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => addLink(colIdx)}
                          className="gap-2 text-xs"
                        >
                          <Plus className="h-3 w-3" />
                          Tambah Link
                        </Button>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          Maksimal {MAX_LINKS_PER_COLUMN} link tercapai.
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <Separator />

          {/* Social media section */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Social Media
            </h3>
            <p className="text-xs text-muted-foreground">
              Aktifkan platform dan masukkan URL. Hanya platform yang
              diaktifkan yang akan tampil di footer.
            </p>
            <div className="space-y-2">
              {formData.socialMedia.map((s) => (
                <div
                  key={s.platform}
                  className="flex items-center gap-3 rounded-md border p-3 bg-muted/30"
                >
                  <SocialIcon platform={s.platform} size={20} />
                  <span className="text-sm font-medium w-28 shrink-0">
                    {SOCIAL_PLATFORM_LABELS[s.platform]}
                  </span>
                  <Input
                    value={s.url}
                    onChange={(e) => updateSocial(s.platform, "url", e.target.value)}
                    placeholder="https://..."
                    className="flex-1"
                    disabled={!s.enabled}
                  />
                  <Switch
                    checked={s.enabled}
                    onCheckedChange={(v) => updateSocial(s.platform, "enabled", v)}
                    aria-label={`Aktifkan ${SOCIAL_PLATFORM_LABELS[s.platform]}`}
                  />
                </div>
              ))}
            </div>
          </div>

          <Separator />

          {/* Copyright section */}
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Copyright
            </h3>
            <Label htmlFor="copyrightText">Teks Copyright</Label>
            <Input
              id="copyrightText"
              value={formData.copyrightText}
              onChange={(e) => updateCopyright(e.target.value)}
              placeholder="© 2026 StoreFront. All rights reserved."
              required
            />
          </div>
      </div>

      <div className="flex gap-2 justify-end border-t pt-4">
        <Button type="submit" disabled={submitting}>
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Menyimpan...
            </>
          ) : (
            "Simpan"
          )}
        </Button>
      </div>

      <FooterPreviewDialog
        config={previewConfig}
        open={previewOpen}
        onOpenChange={setPreviewOpen}
      />
    </form>
  );
}
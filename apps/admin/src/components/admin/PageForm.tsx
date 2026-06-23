"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { MarkdownEditor } from "@/components/admin/MarkdownEditor";

export interface PageFormData {
  slug: string;
  title: string;
  content: string;
  isPublished: boolean;
  displayOrder: number;
}

interface PageFormProps {
  mode: "create" | "edit";
  pageId?: string;
  initialData?: Partial<PageFormData>;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/[\s]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function PageForm({ mode, pageId, initialData }: PageFormProps) {
  const router = useRouter();
  const [formData, setFormData] = useState<PageFormData>({
    slug: initialData?.slug ?? "",
    title: initialData?.title ?? "",
    content: initialData?.content ?? "",
    isPublished: initialData?.isPublished ?? true,
    displayOrder: initialData?.displayOrder ?? 0,
  });
  const [slugTouched, setSlugTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateField<K extends keyof PageFormData>(
    key: K,
    value: PageFormData[K]
  ) {
    setFormData((prev) => {
      const next = { ...prev, [key]: value };
      // Auto-suggest slug from title unless the slug has been manually edited.
      if (key === "title" && !slugTouched) {
        next.slug = slugify(value as string);
      }
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!formData.title.trim()) {
      setError("Judul wajib diisi.");
      return;
    }
    if (!formData.slug.trim()) {
      setError("Slug wajib diisi.");
      return;
    }

    setSubmitting(true);
    try {
      const url =
        mode === "create" ? "/api/admin/pages" : `/api/admin/pages/${pageId}`;
      const method = mode === "create" ? "POST" : "PUT";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: formData.slug,
          title: formData.title,
          content: formData.content,
          isPublished: formData.isPublished,
          displayOrder: formData.displayOrder,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || "Gagal menyimpan halaman");
      }
      router.push("/admin/pages");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Terjadi kesalahan");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div className="bg-destructive/10 text-destructive text-sm p-3 rounded-md flex items-center gap-2">
          <AlertCircle className="h-4 w-4" />
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="title">Judul</Label>
          <Input
            id="title"
            value={formData.title}
            onChange={(e) => updateField("title", e.target.value)}
            placeholder="Tentang Kami"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="slug">Slug (URL)</Label>
          <div className="flex items-center gap-1">
            <span className="text-sm text-muted-foreground whitespace-nowrap">
              /pages/
            </span>
            <Input
              id="slug"
              value={formData.slug}
              onChange={(e) => {
                setSlugTouched(true);
                updateField("slug", e.target.value);
              }}
              placeholder="about"
              required
              className="font-mono text-sm"
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
        <div className="space-y-2">
          <Label htmlFor="displayOrder">Urutan Tampil</Label>
          <Input
            id="displayOrder"
            type="number"
            min={0}
            value={formData.displayOrder}
            onChange={(e) =>
              updateField("displayOrder", parseInt(e.target.value, 10) || 0)
            }
          />
        </div>
        <div className="flex items-center gap-2 md:col-span-2">
          <Switch
            id="isPublished"
            checked={formData.isPublished}
            onCheckedChange={(v) => updateField("isPublished", v)}
          />
          <Label htmlFor="isPublished" className="cursor-pointer">
            {formData.isPublished
              ? "Dipublikasi"
              : "Draft (tidak tampil di toko)"}
          </Label>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="content">Konten</Label>
        <MarkdownEditor
          value={formData.content}
          onChange={(md) => updateField("content", md)}
        />
        <p className="text-xs text-muted-foreground">
          Konten disimpan sebagai markdown di latar belakang. Gunakan toolbar
          di atas editor untuk memformat teks — Anda tidak perlu menulis sintaks
          markdown secara manual.
        </p>
      </div>

      <div className="flex gap-2 justify-end">
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push("/admin/pages")}
          disabled={submitting}
        >
          Batal
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Menyimpan...
            </>
          ) : mode === "create" ? (
            "Buat Halaman"
          ) : (
            "Simpan Perubahan"
          )}
        </Button>
      </div>
    </form>
  );
}
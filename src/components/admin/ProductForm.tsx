"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import {
  Plus,
  Trash2,
  Upload,
  X,
  Loader2,
  ChevronUp,
  ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

// ── Types ──────────────────────────────────────────────

interface VariantImage {
  id?: string;
  url: string;
  displayOrder: number;
}

interface VariantFormData {
  id?: string;
  color?: string;
  size?: string;
  price: string;
  stock: number;
  sku: string;
  isDefault: boolean;
  images: VariantImage[];
}

export interface ProductFormData {
  name: string;
  slug: string;
  description?: string;
  basePrice: string;
  status: "aktif" | "habis" | "arsip";
  categoryIds: string[];
  variants: VariantFormData[];
}

interface Category {
  id: string;
  name: string;
  slug: string;
}

interface ProductFormProps {
  mode: "create" | "edit";
  initialData?: ProductFormData;
  onSubmit: (data: ProductFormData) => Promise<void>;
  submitLabel?: string;
}

// ── Validation Schema ──────────────────────────────────

const variantSchema = z.object({
  id: z.string().optional(),
  color: z.string().optional(),
  size: z.string().optional(),
  price: z.string().min(1, "Harga wajib diisi"),
  stock: z.coerce.number().int().min(0, "Stok tidak boleh negatif"),
  sku: z.string().min(1, "SKU wajib diisi"),
  isDefault: z.boolean(),
  images: z.array(
    z.object({
      id: z.string().optional(),
      url: z.string(),
      displayOrder: z.number(),
    })
  ),
});

const productSchema = z.object({
  name: z.string().min(1, "Nama produk wajib diisi"),
  slug: z.string().min(1, "Slug wajib diisi"),
  description: z.string().optional(),
  basePrice: z.string().min(1, "Harga dasar wajib diisi"),
  status: z.enum(["aktif", "habis", "arsip"]),
  categoryIds: z.array(z.string()),
  variants: z.array(variantSchema).min(1, "Minimal 1 varian"),
});

// ── Helpers ────────────────────────────────────────────

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function formatRupiah(value: string): string {
  const num = Math.round(parseFloat(value));
  if (isNaN(num)) return "";
  return num.toLocaleString("id-ID");
}

// ── Component ──────────────────────────────────────────

export default function ProductForm({
  mode,
  initialData,
  onSubmit,
  submitLabel,
}: ProductFormProps) {
  const router = useRouter();

  // Form state
  const [name, setName] = useState(initialData?.name ?? "");
  const [slug, setSlug] = useState(initialData?.slug ?? "");
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(mode === "edit");
  const [description, setDescription] = useState(initialData?.description ?? "");
  const [basePrice, setBasePrice] = useState(initialData?.basePrice ?? "");
  const [status, setStatus] = useState<"aktif" | "habis" | "arsip">(
    initialData?.status ?? "aktif"
  );
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>(
    initialData?.categoryIds ?? []
  );
  const [variants, setVariants] = useState<VariantFormData[]>(
    initialData?.variants?.length
      ? initialData.variants
      : [
          {
            color: "",
            size: "",
            price: "",
            stock: 0,
            sku: "",
            isDefault: true,
            images: [],
          },
        ]
  );

  // UI state
  const [categories, setCategories] = useState<Category[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [uploadingImage, setUploadingImage] = useState<number | null>(null);

  // Refs for file inputs per variant
  const fileInputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // ── Fetch categories ─────────────────────────────────
  useEffect(() => {
    fetch("/api/admin/categories")
      .then((r) => r.json())
      .then((data) => {
        if (data.success) setCategories(data.data);
      })
      .catch(console.error);
  }, []);

  // ── Auto-generate slug from name ─────────────────────
  useEffect(() => {
    if (!slugManuallyEdited) {
      setSlug(slugify(name));
    }
  }, [name, slugManuallyEdited]);

  // ── Variant helpers ──────────────────────────────────
  function addVariant() {
    setVariants((prev) => [
      ...prev,
      {
        color: "",
        size: "",
        price: "",
        stock: 0,
        sku: "",
        isDefault: false,
        images: [],
      },
    ]);
  }

  function removeVariant(index: number) {
    if (variants.length <= 1) return;
    setVariants((prev) => prev.filter((_, i) => i !== index));
  }

  function updateVariant(index: number, field: keyof VariantFormData, value: unknown) {
    setVariants((prev) =>
      prev.map((v, i) => (i === index ? { ...v, [field]: value } : v))
    );
  }

  // ── Image upload ─────────────────────────────────────
  async function handleImageUpload(variantIndex: number, file: File) {
    setUploadingImage(variantIndex);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/admin/upload", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();

      if (data.success) {
        setVariants((prev) =>
          prev.map((v, i) => {
            if (i !== variantIndex) return v;
            return {
              ...v,
              images: [
                ...v.images,
                { url: data.url, displayOrder: v.images.length },
              ],
            };
          })
        );
      } else {
        alert(data.error || "Upload gagal");
      }
    } catch {
      alert("Upload gagal");
    } finally {
      setUploadingImage(null);
    }
  }

  function removeImage(variantIndex: number, imageIndex: number) {
    setVariants((prev) =>
      prev.map((v, i) => {
        if (i !== variantIndex) return v;
        return {
          ...v,
          images: v.images
            .filter((_, idx) => idx !== imageIndex)
            .map((img, idx) => ({ ...img, displayOrder: idx })),
        };
      })
    );
  }

  function moveImage(variantIndex: number, imageIndex: number, direction: -1 | 1) {
    setVariants((prev) =>
      prev.map((v, vi) => {
        if (vi !== variantIndex) return v;
        const newIndex = imageIndex + direction;
        if (newIndex < 0 || newIndex >= v.images.length) return v;
        const updated = [...v.images];
        [updated[imageIndex], updated[newIndex]] = [
          updated[newIndex],
          updated[imageIndex],
        ];
        return {
          ...v,
          images: updated.map((img, idx) => ({ ...img, displayOrder: idx })),
        };
      })
    );
  }

  // ── Category toggle ──────────────────────────────────
  function toggleCategory(categoryId: string) {
    setSelectedCategoryIds((prev) =>
      prev.includes(categoryId)
        ? prev.filter((id) => id !== categoryId)
        : [...prev, categoryId]
    );
  }

  // ── Submit ───────────────────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});

    const formData: ProductFormData = {
      name,
      slug,
      description,
      basePrice,
      status,
      categoryIds: selectedCategoryIds,
      variants: variants.map((v) => ({
        ...v,
        price: v.price.replace(/\./g, "").replace(/[^0-9]/g, ""),
      })),
    };

    const result = productSchema.safeParse(formData);
    if (!result.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of result.error.issues) {
        const path = issue.path.join(".");
        if (!fieldErrors[path]) {
          fieldErrors[path] = issue.message;
        }
      }
      setErrors(fieldErrors);
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit(result.data);
    } catch (err) {
      console.error("Submit error:", err);
      alert("Terjadi kesalahan saat menyimpan produk");
    } finally {
      setSubmitting(false);
    }
  }

  // ── Render ───────────────────────────────────────────
  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      {/* ── Basic Info ────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Informasi Dasar</CardTitle>
          <CardDescription>Nama, slug, deskripsi, dan harga produk.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Name */}
          <div className="space-y-2">
            <Label htmlFor="name">Nama Produk *</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nama produk"
            />
            {errors.name && (
              <p className="text-sm text-destructive">{errors.name}</p>
            )}
          </div>

          {/* Slug */}
          <div className="space-y-2">
            <Label htmlFor="slug">Slug *</Label>
            <Input
              id="slug"
              value={slug}
              onChange={(e) => {
                setSlug(e.target.value);
                setSlugManuallyEdited(true);
              }}
              placeholder="slug-produk"
            />
            {errors.slug && (
              <p className="text-sm text-destructive">{errors.slug}</p>
            )}
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="description">Deskripsi</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Deskripsi produk (opsional)"
              rows={4}
            />
          </div>

          {/* Base Price */}
          <div className="space-y-2">
            <Label htmlFor="basePrice">Harga Dasar (Rp) *</Label>
            <Input
              id="basePrice"
              value={formatRupiah(basePrice)}
              onChange={(e) => {
                const raw = e.target.value.replace(/\D/g, "");
                setBasePrice(raw);
              }}
              placeholder="150.000"
            />
            {errors.basePrice && (
              <p className="text-sm text-destructive">{errors.basePrice}</p>
            )}
          </div>

          {/* Status */}
          <div className="space-y-2">
            <Label htmlFor="status">Status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="aktif">Aktif</SelectItem>
                <SelectItem value="habis">Habis</SelectItem>
                <SelectItem value="arsip">Arsip</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* ── Categories ────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Kategori</CardTitle>
          <CardDescription>Pilih kategori untuk produk ini.</CardDescription>
        </CardHeader>
        <CardContent>
          {categories.length === 0 ? (
            <p className="text-sm text-muted-foreground">Memuat kategori...</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
              {categories.map((cat) => (
                <label
                  key={cat.id}
                  className={`flex items-center gap-2 rounded-md border p-3 cursor-pointer transition-colors ${
                    selectedCategoryIds.includes(cat.id)
                      ? "border-primary bg-primary/5"
                      : "hover:bg-muted/50"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selectedCategoryIds.includes(cat.id)}
                    onChange={() => toggleCategory(cat.id)}
                    className="rounded"
                  />
                  <span className="text-sm">{cat.name}</span>
                </label>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Variants ──────────────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Varian Produk</CardTitle>
              <CardDescription>
                Tambahkan varian (warna, ukuran) beserta stok dan gambar.
              </CardDescription>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={addVariant}>
              <Plus className="h-4 w-4 mr-1" /> Tambah Varian
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {errors.variants && (
            <p className="text-sm text-destructive">{errors.variants}</p>
          )}

          {variants.map((variant, vi) => (
            <div key={vi} className="rounded-lg border p-4 space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="font-medium">Varian {vi + 1}</h4>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={variant.isDefault}
                      onCheckedChange={(checked) =>
                        updateVariant(vi, "isDefault", checked)
                      }
                    />
                    <Label className="text-xs text-muted-foreground">Default</Label>
                  </div>
                  {variants.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="text-destructive hover:text-destructive"
                      onClick={() => removeVariant(vi)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Warna</Label>
                  <Input
                    value={variant.color}
                    onChange={(e) => updateVariant(vi, "color", e.target.value)}
                    placeholder="Merah"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Ukuran</Label>
                  <Input
                    value={variant.size}
                    onChange={(e) => updateVariant(vi, "size", e.target.value)}
                    placeholder="L"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Harga (Rp) *</Label>
                  <Input
                    value={formatRupiah(variant.price)}
                    onChange={(e) => {
                      const raw = e.target.value.replace(/\D/g, "");
                      updateVariant(vi, "price", raw);
                    }}
                    placeholder="150.000"
                  />
                  {errors[`variants.${vi}.price`] && (
                    <p className="text-xs text-destructive">
                      {errors[`variants.${vi}.price`]}
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label>Stok *</Label>
                  <Input
                    type="number"
                    min={0}
                    value={variant.stock}
                    onChange={(e) =>
                      updateVariant(vi, "stock", parseInt(e.target.value) || 0)
                    }
                    placeholder="0"
                  />
                  {errors[`variants.${vi}.stock`] && (
                    <p className="text-xs text-destructive">
                      {errors[`variants.${vi}.stock`]}
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label>SKU *</Label>
                  <Input
                    value={variant.sku}
                    onChange={(e) => updateVariant(vi, "sku", e.target.value)}
                    placeholder="PRD-RED-L"
                  />
                  {errors[`variants.${vi}.sku`] && (
                    <p className="text-xs text-destructive">
                      {errors[`variants.${vi}.sku`]}
                    </p>
                  )}
                </div>
              </div>

              {/* Variant Images */}
              <Separator />
              <div className="space-y-3">
                <Label>Gambar Varian</Label>
                <div className="flex flex-wrap gap-3">
                  {variant.images.map((img, ii) => (
                    <div
                      key={ii}
                      className="relative w-20 h-20 rounded-md border overflow-hidden group"
                    >
                      <img
                        src={img.url}
                        alt={`Variant ${vi + 1} image ${ii + 1}`}
                        className="w-full h-full object-cover"
                      />
                      {/* Delete button */}
                      <button
                        type="button"
                        onClick={() => removeImage(vi, ii)}
                        className="absolute top-0.5 right-0.5 bg-destructive text-destructive-foreground rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X className="h-3 w-3" />
                      </button>
                      {/* Reorder controls */}
                      <div className="absolute bottom-0.5 left-0.5 right-0.5 flex justify-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        {ii > 0 && (
                          <button
                            type="button"
                            onClick={() => moveImage(vi, ii, -1)}
                            className="bg-background/90 text-foreground rounded-sm p-0.5 hover:bg-background"
                          >
                            <ChevronUp className="h-3 w-3" />
                          </button>
                        )}
                        {ii < variant.images.length - 1 && (
                          <button
                            type="button"
                            onClick={() => moveImage(vi, ii, 1)}
                            className="bg-background/90 text-foreground rounded-sm p-0.5 hover:bg-background"
                          >
                            <ChevronDown className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}

                  {/* Upload button */}
                  <button
                    type="button"
                    onClick={() => fileInputRefs.current[vi]?.click()}
                    disabled={uploadingImage === vi}
                    className="w-20 h-20 rounded-md border-2 border-dashed flex flex-col items-center justify-center gap-1 text-muted-foreground hover:text-foreground hover:border-foreground/50 transition-colors disabled:opacity-50"
                  >
                    {uploadingImage === vi ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : (
                      <>
                        <Upload className="h-5 w-5" />
                        <span className="text-[10px]">Upload</span>
                      </>
                    )}
                  </button>
                  <input
                    ref={(el) => {
                      fileInputRefs.current[vi] = el;
                    }}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        handleImageUpload(vi, file);
                        e.target.value = "";
                      }
                    }}
                  />
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* ── Actions ───────────────────────────────────── */}
      <div className="flex items-center justify-end gap-4">
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push("/admin/products")}
          disabled={submitting}
        >
          Batal
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          {submitLabel ?? (mode === "create" ? "Buat Produk" : "Simpan Perubahan")}
        </Button>
      </div>
    </form>
  );
}

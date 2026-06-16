"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2, X, Upload, Loader2 } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";

export interface ProductImage {
  id?: string;
  url: string;
  displayOrder: number;
}

export interface ProductVariant {
  id?: string;
  color?: string;
  size?: string;
  price: string;
  stock: number;
  sku: string;
  isDefault: boolean;
  images: ProductImage[];
}

export interface ProductFormData {
  name: string;
  slug: string;
  description: string;
  basePrice: string;
  status: "aktif" | "habis" | "arsip";
  categoryIds: string[];
  variants: ProductVariant[];
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
}

const STATUS_OPTIONS: { value: ProductFormData["status"]; label: string }[] = [
  { value: "aktif", label: "Aktif" },
  { value: "habis", label: "Habis" },
  { value: "arsip", label: "Arsip" },
];

export default function ProductForm({
  mode,
  initialData,
  onSubmit,
}: ProductFormProps) {
  const [formData, setFormData] = useState<ProductFormData>({
    name: "",
    slug: "",
    description: "",
    basePrice: "",
    status: "aktif",
    categoryIds: [],
    variants: [
      {
        color: "",
        size: "",
        price: "",
        stock: 0,
        sku: "",
        isDefault: true,
        images: [],
      },
    ],
  });
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchCategories() {
      try {
        const res = await fetch("/api/categories");
        const data = await res.json();
        if (data.success) {
          setCategories(data.data);
        }
      } catch (err) {
        console.error("Error fetching categories:", err);
      }
    }

    setLoading(true);
    fetchCategories().finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (initialData) {
      setFormData(initialData);
    }
  }, [initialData]);

  function generateSlug(name: string) {
    return name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-");
  }

  function handleNameChange(name: string) {
    setFormData((prev) => ({
      ...prev,
      name,
      slug: mode === "create" ? generateSlug(name) : prev.slug,
    }));
  }

  function toggleCategory(categoryId: string) {
    setFormData((prev) => {
      const has = prev.categoryIds.includes(categoryId);
      return {
        ...prev,
        categoryIds: has
          ? prev.categoryIds.filter((id) => id !== categoryId)
          : [...prev.categoryIds, categoryId],
      };
    });
  }

  function updateVariant(index: number, updates: Partial<ProductVariant>) {
    setFormData((prev) => ({
      ...prev,
      variants: prev.variants.map((v, i) => (i === index ? { ...v, ...updates } : v)),
    }));
  }

  function addVariant() {
    setFormData((prev) => ({
      ...prev,
      variants: [
        ...prev.variants,
        {
          color: "",
          size: "",
          price: "",
          stock: 0,
          sku: "",
          isDefault: false,
          images: [],
        },
      ],
    }));
  }

  function removeVariant(index: number) {
    setFormData((prev) => ({
      ...prev,
      variants: prev.variants.filter((_, i) => i !== index),
    }));
  }

  function handleImageUpload(
    variantIndex: number,
    event: React.ChangeEvent<HTMLInputElement>
  ) {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    Array.from(files).forEach((file) => {
      const url = URL.createObjectURL(file);
      setFormData((prev) => {
        const variant = prev.variants[variantIndex];
        const newImages = [...variant.images, { url, displayOrder: variant.images.length }];
        return {
          ...prev,
          variants: prev.variants.map((v, i) =>
            i === variantIndex ? { ...v, images: newImages } : v
          ),
        };
      });
    });

    event.target.value = "";
  }

  function removeImage(variantIndex: number, imageIndex: number) {
    setFormData((prev) => {
      const variant = prev.variants[variantIndex];
      return {
        ...prev,
        variants: prev.variants.map((v, i) =>
          i === variantIndex
            ? {
                ...v,
                images: v.images.filter((_, idx) => idx !== imageIndex).map((img, idx) => ({
                  ...img,
                  displayOrder: idx,
                })),
              }
            : v
        ),
      };
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      if (formData.variants.length === 0) {
        throw new Error("Setidaknya tambahkan 1 varian produk");
      }

      await onSubmit(formData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Terjadi kesalahan");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      {error && (
        <div className="bg-destructive/10 text-destructive text-sm p-3 rounded-md">
          {error}
        </div>
      )}

      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Informasi Produk</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="name">Nama Produk</Label>
            <Input
              id="name"
              value={formData.name}
              onChange={(e) => handleNameChange(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="slug">Slug</Label>
            <Input
              id="slug"
              value={formData.slug}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, slug: e.target.value }))
              }
              required
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="description">Deskripsi</Label>
            <Textarea
              id="description"
              rows={4}
              value={formData.description}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, description: e.target.value }))
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="basePrice">Harga Dasar</Label>
            <Input
              id="basePrice"
              type="number"
              step="0.01"
              value={formData.basePrice}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, basePrice: e.target.value }))
              }
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="status">Status</Label>
            <Select
              value={formData.status}
              onValueChange={(value) =>
                setFormData((prev) => ({
                  ...prev,
                  status: value as ProductFormData["status"],
                }))
              }
            >
              <SelectTrigger id="status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Kategori</h3>
        {categories.length === 0 ? (
          <p className="text-sm text-muted-foreground">Tidak ada kategori.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {categories.map((category) => {
              const selected = formData.categoryIds.includes(category.id);
              return (
                <button
                  key={category.id}
                  type="button"
                  onClick={() => toggleCategory(category.id)}
                  className={`px-3 py-1 text-sm rounded-full border transition-colors ${
                    selected
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background hover:bg-muted"
                  }`}
                >
                  {category.name}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Varian Produk</h3>
          <Button type="button" variant="outline" size="sm" onClick={addVariant}>
            <Plus className="h-4 w-4 mr-1" /> Tambah Varian
          </Button>
        </div>

        {formData.variants.map((variant, index) => (
          <div key={index} className="rounded-lg border p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="font-medium">Varian {index + 1}</h4>
              {formData.variants.length > 1 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => removeVariant(index)}
                  className="text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-2">
                <Label>Warna</Label>
                <Input
                  value={variant.color ?? ""}
                  onChange={(e) =>
                    updateVariant(index, { color: e.target.value || undefined })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Ukuran</Label>
                <Input
                  value={variant.size ?? ""}
                  onChange={(e) =>
                    updateVariant(index, { size: e.target.value || undefined })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Harga</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={variant.price}
                  onChange={(e) => updateVariant(index, { price: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Stok</Label>
                <Input
                  type="number"
                  min={0}
                  value={variant.stock}
                  onChange={(e) =>
                    updateVariant(index, { stock: parseInt(e.target.value) || 0 })
                  }
                  required
                />
              </div>
              <div className="space-y-2 lg:col-span-2">
                <Label>SKU</Label>
                <Input
                  value={variant.sku}
                  onChange={(e) => updateVariant(index, { sku: e.target.value })}
                  required
                />
              </div>
              <div className="flex items-center space-x-2 lg:col-span-2">
                <Switch
                  id={`isDefault-${index}`}
                  checked={variant.isDefault}
                  onCheckedChange={(checked) =>
                    updateVariant(index, { isDefault: checked })
                  }
                />
                <Label htmlFor={`isDefault-${index}`}>Varian Default</Label>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Gambar Varian</Label>
              <div className="flex flex-wrap gap-2">
                {variant.images.map((img, imgIdx) => (
                  <div
                    key={imgIdx}
                    className="relative h-20 w-20 rounded-md border overflow-hidden group"
                  >
                    <img
                      src={img.url}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => removeImage(index, imgIdx)}
                      className="absolute top-0.5 right-0.5 p-0.5 bg-black/50 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
                <label className="h-20 w-20 flex flex-col items-center justify-center rounded-md border border-dashed cursor-pointer hover:bg-muted transition-colors">
                  <Upload className="h-5 w-5 text-muted-foreground" />
                  <span className="text-[10px] text-muted-foreground mt-1">Upload</span>
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(e) => handleImageUpload(index, e)}
                  />
                </label>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-end gap-2">
        <Button type="submit" disabled={submitting}>
          {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          {mode === "create" ? "Buat Produk" : "Simpan Perubahan"}
        </Button>
      </div>
    </form>
  );
}

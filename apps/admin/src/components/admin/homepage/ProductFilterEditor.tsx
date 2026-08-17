"use client";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import type { ProductFilterConfig } from "@marketplace/ui";

interface AdminCategory {
  id: string;
  name: string;
  slug: string;
}

interface ProductFilterEditorProps {
  value: ProductFilterConfig;
  onChange: (value: ProductFilterConfig) => void;
  /** Show the sort order dropdown (default true). */
  showSort?: boolean;
  /** Show the search field (default true). */
  showSearch?: boolean;
  /** Show the "has discount" toggle (default true). */
  showHasDiscount?: boolean;
  /** Show the brand dropdown (default true). */
  showBrand?: boolean;
  idPrefix?: string;
}

export default function ProductFilterEditor({
  value,
  onChange,
  showSort = true,
  showSearch = true,
  showHasDiscount = true,
  showBrand = true,
  idPrefix = "filter",
}: ProductFilterEditorProps) {
  const [categories, setCategories] = useState<AdminCategory[]>([]);
  const [brands, setBrands] = useState<AdminCategory[]>([]);
  const [loadingCats, setLoadingCats] = useState(true);
  const [loadingBrands, setLoadingBrands] = useState(true);

  useEffect(() => {
    const fetchOptions = async () => {
      try {
        const [catsRes, brandsRes] = await Promise.all([
          fetch("/api/admin/categories"),
          fetch("/api/admin/brands"),
        ]);
        const [cats, brs] = await Promise.all([
          catsRes.json(),
          brandsRes.json(),
        ]);
        if (cats.success) setCategories(cats.data);
        if (brs.success) setBrands(brs.data);
      } catch (e) {
        console.error("Error fetching filter options:", e);
      } finally {
        setLoadingCats(false);
        setLoadingBrands(false);
      }
    };
    fetchOptions();
  }, []);

  const update = <K extends keyof ProductFilterConfig>(key: K, v: ProductFilterConfig[K]) => {
    onChange({ ...value, [key]: v });
  };

  return (
    <div className="space-y-3">
      {showSearch && (
        <div className="space-y-1">
          <Label className="text-xs" htmlFor={`${idPrefix}-search`}>
            Search (opsional)
          </Label>
          <input
            id={`${idPrefix}-search`}
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={value.search ?? ""}
            onChange={(e) => update("search", e.target.value || undefined)}
            placeholder="Ketik nama produk..."
          />
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Kategori</Label>
          <Select
            value={value.category ?? "__all__"}
            onValueChange={(v) => update("category", v === "__all__" ? undefined : v)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Semua kategori" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Semua kategori</SelectItem>
              {loadingCats ? (
                <SelectItem value="__loading__" disabled>
                  Memuat...
                </SelectItem>
              ) : (
                categories.map((c) => (
                  <SelectItem key={c.id} value={c.slug}>
                    {c.name}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        </div>

        {showSort && (
          <div className="space-y-1">
            <Label className="text-xs">Urutan</Label>
            <Select
              value={value.sortOrder ?? "newest"}
              onValueChange={(v) =>
                update("sortOrder", v as ProductFilterConfig["sortOrder"])
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="newest">Terbaru</SelectItem>
                <SelectItem value="priceAsc">Harga Termurah</SelectItem>
                <SelectItem value="priceDesc">Harga Termahal</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {showBrand && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Brand</Label>
            <Select
              value={value.brand ?? "__all__"}
              onValueChange={(v) => update("brand", v === "__all__" ? undefined : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Semua brand" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Semua brand</SelectItem>
                {loadingBrands ? (
                  <SelectItem value="__loading__" disabled>
                    Memuat...
                  </SelectItem>
                ) : (
                  brands.map((b) => (
                    <SelectItem key={b.id} value={b.slug}>
                      {b.name}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs" htmlFor={`${idPrefix}-minPrice`}>
            Harga Minimum
          </Label>
          <input
            id={`${idPrefix}-minPrice`}
            type="number"
            min="0"
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={value.minPrice ?? ""}
            onChange={(e) => update("minPrice", e.target.value || undefined)}
            placeholder="0"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs" htmlFor={`${idPrefix}-maxPrice`}>
            Harga Maksimum
          </Label>
          <input
            id={`${idPrefix}-maxPrice`}
            type="number"
            min="0"
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={value.maxPrice ?? ""}
            onChange={(e) => update("maxPrice", e.target.value || undefined)}
            placeholder="Tanpa batas"
          />
        </div>
      </div>

      {showHasDiscount && (
        <label className="flex items-center gap-2 cursor-pointer">
          <Checkbox
            checked={!!value.hasDiscount}
            onCheckedChange={(v) => update("hasDiscount", v === true ? true : undefined)}
          />
          <span className="text-sm">Hanya produk dengan diskon</span>
        </label>
      )}
    </div>
  );
}

export { Loader2 };
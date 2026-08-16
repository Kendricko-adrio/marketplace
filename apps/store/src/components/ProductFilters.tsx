"use client";
import { useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

interface Option {
  id: string;
  name: string;
  slug: string;
}

// Native select styled to match the surrounding shadcn Input.
const selectClass =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

export default function ProductFilters() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [brands, setBrands] = useState<Option[]>([]);
  const [genders, setGenders] = useState<Option[]>([]);

  const [searchQuery, setSearchQuery] = useState(
    searchParams.get("search") || ""
  );
  const [selectedBrand, setSelectedBrand] = useState<string>(
    searchParams.get("brand") || ""
  );
  const [selectedGender, setSelectedGender] = useState<string>(
    searchParams.get("gender") || ""
  );
  const [minPrice, setMinPrice] = useState(searchParams.get("minPrice") || "");
  const [maxPrice, setMaxPrice] = useState(searchParams.get("maxPrice") || "");
  const [sortBy, setSortBy] = useState(searchParams.get("sortBy") || "createdAt");
  const [sortOrder, setSortOrder] = useState(
    searchParams.get("sortOrder") || "desc"
  );
  const [hasDiscount, setHasDiscount] = useState(
    searchParams.get("hasDiscount") === "true"
  );

  useEffect(() => {
    async function fetchOptions() {
      try {
        const [brandsRes, gendersRes] = await Promise.all([
          fetch("/api/brands"),
          fetch("/api/genders"),
        ]);
        const [brs, gdr] = await Promise.all([
          brandsRes.json(),
          gendersRes.json(),
        ]);
        if (brs.success) setBrands(brs.data);
        if (gdr.success) setGenders(gdr.data);
      } catch (error) {
        console.error("Error fetching filter options:", error);
      }
    }
    fetchOptions();
  }, []);

  const applyFilters = () => {
    const params = new URLSearchParams();

    if (searchQuery) params.set("search", searchQuery);
    if (selectedBrand) params.set("brand", selectedBrand);
    if (selectedGender) params.set("gender", selectedGender);
    if (minPrice) params.set("minPrice", minPrice);
    if (maxPrice) params.set("maxPrice", maxPrice);
    if (hasDiscount) params.set("hasDiscount", "true");
    if (sortBy) params.set("sortBy", sortBy);
    if (sortOrder) params.set("sortOrder", sortOrder);
    params.set("page", "1"); // Reset to first page on filter change

    router.push(`/products?${params.toString()}`);
  };

  const clearFilters = () => {
    setSelectedBrand("");
    setSelectedGender("");
    setMinPrice("");
    setMaxPrice("");
    setSearchQuery("");
    setSortBy("createdAt");
    setSortOrder("desc");
    setHasDiscount(false);
    router.push("/products");
  };

  // Sort is a single dropdown mapped to the API's sortBy + sortOrder pair.
  const sortValue = `${sortBy}|${sortOrder}`;
  const onSortChange = (v: string) => {
    const [by, order] = v.split("|");
    setSortBy(by);
    setSortOrder(order);
  };

  return (
    <aside className="w-full md:w-64 flex-shrink-0 md:border-r border-border md:pr-6 pb-8 md:pb-0 mb-8 md:mb-0">
      {/* Search */}
      <div className="mb-8">
        <h3 className="font-semibold mb-4 text-foreground">Cari Produk</h3>
        <Input
          type="text"
          placeholder="Nama produk..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="h-10"
        />
      </div>

      {/* Brand */}
      <div className="mb-8">
        <h3 className="font-semibold mb-4 text-foreground">Brand</h3>
        <select
          className={selectClass}
          value={selectedBrand}
          onChange={(e) => setSelectedBrand(e.target.value)}
        >
          <option value="">Semua brand</option>
          {brands.map((b) => (
            <option key={b.id} value={b.slug}>
              {b.name}
            </option>
          ))}
        </select>
      </div>

      {/* Gender */}
      <div className="mb-8">
        <h3 className="font-semibold mb-4 text-foreground">Gender</h3>
        <select
          className={selectClass}
          value={selectedGender}
          onChange={(e) => setSelectedGender(e.target.value)}
        >
          <option value="">Semua gender</option>
          {genders.map((g) => (
            <option key={g.id} value={g.slug}>
              {g.name}
            </option>
          ))}
        </select>
      </div>

      {/* Price Range */}
      <div className="mb-8">
        <h3 className="font-semibold mb-4 text-foreground">Harga</h3>
        <div className="flex items-center gap-2">
          <Input
            type="number"
            placeholder="Min"
            value={minPrice}
            onChange={(e) => setMinPrice(e.target.value)}
            className="h-9 px-2 text-sm"
          />
          <span className="text-muted-foreground">-</span>
          <Input
            type="number"
            placeholder="Max"
            value={maxPrice}
            onChange={(e) => setMaxPrice(e.target.value)}
            className="h-9 px-2 text-sm"
          />
        </div>
      </div>

      {/* Sort */}
      <div className="mb-8">
        <h3 className="font-semibold mb-4 text-foreground">Urutan</h3>
        <select
          className={selectClass}
          value={sortValue}
          onChange={(e) => onSortChange(e.target.value)}
        >
          <option value="createdAt|desc">Terbaru</option>
          <option value="price|asc">Harga Termurah</option>
          <option value="price|desc">Harga Termahal</option>
        </select>
      </div>

      {/* Discount toggle */}
      <div className="mb-8">
        <div className="flex items-center space-x-2">
          <Checkbox
            id="hasDiscount"
            checked={hasDiscount}
            onCheckedChange={(v) => setHasDiscount(v === true)}
          />
          <Label
            htmlFor="hasDiscount"
            className="text-sm font-normal cursor-pointer text-muted-foreground"
          >
            Hanya produk diskon
          </Label>
        </div>
      </div>

      <div className="space-y-2">
        <Button className="w-full" onClick={applyFilters}>
          Terapkan Filter
        </Button>
        <Button variant="outline" className="w-full" onClick={clearFilters}>
          Reset Filter
        </Button>
      </div>
    </aside>
  );
}
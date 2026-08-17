"use client";
import { useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { ChevronsUpDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { buildProductsQuery } from "@/lib/product-filters";

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

  const [categories, setCategories] = useState<Option[]>([]);
  const [brands, setBrands] = useState<Option[]>([]);
  const [branches, setBranches] = useState<Option[]>([]);

  const [searchQuery, setSearchQuery] = useState(
    searchParams.get("search") || ""
  );
  const [selectedCategory, setSelectedCategory] = useState<string>(
    searchParams.get("category") || ""
  );
  const [selectedBrand, setSelectedBrand] = useState<string>(
    searchParams.get("brand") || ""
  );
  const [selectedBranch, setSelectedBranch] = useState<string>(
    searchParams.get("branch") || ""
  );
  const [minPrice, setMinPrice] = useState(searchParams.get("minPrice") || "");
  const [maxPrice, setMaxPrice] = useState(searchParams.get("maxPrice") || "");
  const [sortBy, setSortBy] = useState(searchParams.get("sortBy") || "createdAt");
  const [sortOrder, setSortOrder] = useState(
    searchParams.get("sortOrder") || "desc"
  );
  const [categoryOpen, setCategoryOpen] = useState(false);

  useEffect(() => {
    async function fetchOptions() {
      try {
        const [categoriesRes, brandsRes, branchesRes] = await Promise.all([
          fetch("/api/categories"),
          fetch("/api/brands"),
          fetch("/api/branches"),
        ]);
        const [cats, brs, brn] = await Promise.all([
          categoriesRes.json(),
          brandsRes.json(),
          branchesRes.json(),
        ]);
        if (cats.success) setCategories(cats.data);
        if (brs.success) setBrands(brs.data);
        // /api/branches returns active branches only; the Option shape needs a
        // slug, so the branch id doubles as the value.
        if (brn.success)
          setBranches(
            brn.data.map((b: { id: string; name: string }) => ({
              id: b.id,
              name: b.name,
              slug: b.id,
            }))
          );
      } catch (error) {
        console.error("Error fetching filter options:", error);
      }
    }
    fetchOptions();
  }, []);

  const applyFilters = () => {
    const query = buildProductsQuery({
      search: searchQuery,
      category: selectedCategory,
      brand: selectedBrand,
      branch: selectedBranch,
      minPrice,
      maxPrice,
      sortBy,
      sortOrder,
    });
    router.push(`/products?${query}`);
  };

  const clearFilters = () => {
    setSelectedCategory("");
    setSelectedBrand("");
    setSelectedBranch("");
    setMinPrice("");
    setMaxPrice("");
    setSearchQuery("");
    setSortBy("createdAt");
    setSortOrder("desc");
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

      {/* Branch — active branches only (sourced from /api/branches). Selecting
          one narrows results to products with available stock at that branch. */}
      <div className="mb-8">
        <h3 className="font-semibold mb-4 text-foreground">Cabang</h3>
        <select
          className={selectClass}
          value={selectedBranch}
          onChange={(e) => setSelectedBranch(e.target.value)}
        >
          <option value="">Semua cabang</option>
          {branches.map((b) => (
            <option key={b.id} value={b.slug}>
              {b.name}
            </option>
          ))}
        </select>
      </div>

      {/* Category — searchable combobox, not a native select: the category
          dimension is large (Jubelio sync-managed, thousands of rows) and a
          plain dropdown would be unusable. */}
      <div className="mb-8">
        <h3 className="font-semibold mb-4 text-foreground">Kategori</h3>
        <Popover open={categoryOpen} onOpenChange={setCategoryOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={categoryOpen}
              // role="combobox" doesn't derive a name from content — label it
              // explicitly (the visible text changes with the selection).
              aria-label="Kategori"
              className="w-full justify-between font-normal"
            >
              {selectedCategory
                ? categories.find((c) => c.slug === selectedCategory)?.name ??
                  "Semua kategori"
                : "Semua kategori"}
              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            className="w-[var(--radix-popover-trigger-width)] p-0"
            align="start"
          >
            <Command>
              <CommandInput placeholder="Cari kategori..." />
              <CommandList>
                <CommandEmpty>Tidak ada kategori ditemukan.</CommandEmpty>
                <CommandGroup>
                  {/* Sentinel value (never a real slug) so cmdk's onSelect
                      always receives a non-empty string. */}
                  <CommandItem
                    value="__all__"
                    onSelect={(currentValue) => {
                      setSelectedCategory(
                        currentValue === "__all__" ? "" : currentValue
                      );
                      setCategoryOpen(false);
                    }}
                  >
                    Semua kategori
                  </CommandItem>
                  {categories.map((c) => (
                    <CommandItem
                      key={c.id}
                      value={c.slug}
                      onSelect={(currentValue) => {
                        setSelectedCategory(currentValue);
                        setCategoryOpen(false);
                      }}
                    >
                      {c.name}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
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

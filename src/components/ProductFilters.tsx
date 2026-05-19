"use client";
import { useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

interface Category {
  id: string;
  name: string;
  slug: string;
}

export default function ProductFilters() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>(
    searchParams.get("category") || ""
  );
  const [minPrice, setMinPrice] = useState(searchParams.get("minPrice") || "");
  const [maxPrice, setMaxPrice] = useState(searchParams.get("maxPrice") || "");
  const [searchQuery, setSearchQuery] = useState(
    searchParams.get("search") || ""
  );

  useEffect(() => {
    async function fetchCategories() {
      try {
        const res = await fetch("/api/categories");
        const data = await res.json();
        if (data.success) {
          setCategories(data.data);
        }
      } catch (error) {
        console.error("Error fetching categories:", error);
      }
    }
    fetchCategories();
  }, []);

  const applyFilters = () => {
    const params = new URLSearchParams();

    if (searchQuery) params.set("search", searchQuery);
    if (selectedCategory) params.set("category", selectedCategory);
    if (minPrice) params.set("minPrice", minPrice);
    if (maxPrice) params.set("maxPrice", maxPrice);
    params.set("page", "1"); // Reset to first page on filter change

    router.push(`/products?${params.toString()}`);
  };

  const clearFilters = () => {
    setSelectedCategory("");
    setMinPrice("");
    setMaxPrice("");
    setSearchQuery("");
    router.push("/products");
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

      {/* Categories */}
      <div className="mb-8">
        <h3 className="font-semibold mb-4 text-foreground">Kategori</h3>
        <div className="space-y-3">
          <div className="flex items-center space-x-2">
            <Checkbox
              id="cat-all"
              checked={selectedCategory === ""}
              onCheckedChange={() => setSelectedCategory("")}
            />
            <Label
              htmlFor="cat-all"
              className="text-sm font-normal cursor-pointer text-muted-foreground"
            >
              Semua
            </Label>
          </div>
          {categories.map((cat) => (
            <div key={cat.id} className="flex items-center space-x-2">
              <Checkbox
                id={`cat-${cat.slug}`}
                checked={selectedCategory === cat.slug}
                onCheckedChange={() =>
                  setSelectedCategory(
                    selectedCategory === cat.slug ? "" : cat.slug
                  )
                }
              />
              <Label
                htmlFor={`cat-${cat.slug}`}
                className="text-sm font-normal cursor-pointer text-muted-foreground"
              >
                {cat.name}
              </Label>
            </div>
          ))}
        </div>
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

"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import ProductCard from "@/components/ProductCard";
import type { ProductGridConfig } from "@/types/homepage";

interface Product {
  id: string;
  name: string;
  slug: string;
  price: string;
  originalPrice?: string;
  rating: string | null;
  sold: number;
  image: string | null;
  flashSalePrice?: string | null;
}

interface ProductGridSectionProps {
  config: ProductGridConfig;
  title: string;
}

export default function ProductGridSection({ config, title }: ProductGridSectionProps) {
  const [products, setProducts] = useState<Product[]>([]);

  useEffect(() => {
    async function fetchProducts() {
      let url = "/api/products";
      if (config.source === "best_seller") url = "/api/products/best-seller";
      else if (config.source === "new_arrivals") url = "/api/products";
      else if (config.source === "category" && config.categoryId) url = `/api/products?category=${config.categoryId}`;
      try {
        const res = await fetch(url, { cache: "no-store" });
        const json = await res.json();
        if (json.success) {
          let data: Product[] = json.data;
          if (config.source === "manual" && config.productIds?.length) {
            const idSet = new Set(config.productIds);
            data = data.filter((p: Product) => idSet.has(p.id));
          }
          const limit = (config.columns || 4) * (config.rows || 2);
          setProducts(data.slice(0, limit));
        }
      } catch (e) {
        console.error(e);
      }
    }
    fetchProducts();
  }, [config]);

  if (products.length === 0) return null;

  const cols = config.columns === 3 ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3" : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4";

  return (
    <section className="container mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-semibold">{title}</h2>
        {config.showViewAll !== false && (
          <Link href="/products" className="text-primary hover:underline">Lihat Semua</Link>
        )}
      </div>
      <div className={`grid ${cols} gap-6`}>
        {products.map((product) => (
          <ProductCard
            key={product.id}
            id={product.id}
            title={product.name}
            price={parseFloat(product.price || "0")}
            originalPrice={product.originalPrice ? parseFloat(product.originalPrice) : undefined}
            image={product.image || ""}
            rating={parseFloat(product.rating || "0")}
            sold={product.sold}
          />
        ))}
      </div>
    </section>
  );
}

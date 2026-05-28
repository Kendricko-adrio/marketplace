"use client";
import { useEffect, useState } from "react";
import ProductCard from "@/components/ProductCard";
import type { CarouselConfig } from "@/types/homepage";

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

interface CarouselSectionProps {
  config: CarouselConfig;
  title: string;
}

export default function CarouselSection({ config, title }: CarouselSectionProps) {
  const [products, setProducts] = useState<Product[]>([]);

  useEffect(() => {
    async function fetchProducts() {
      let url = "/api/products";
      if (config.source === "flash_sale") url = "/api/products/flash-sale";
      else if (config.source === "best_seller") url = "/api/products/best-seller";
      else if (config.source === "category" && config.categoryId) url = `/api/products?category=${config.categoryId}`;
      else if (config.source === "manual" && config.productIds?.length) {
        // fallback to best seller if manual without fetch support
        url = "/api/products/best-seller";
      }
      try {
        const res = await fetch(url, { cache: "no-store" });
        const json = await res.json();
        if (json.success) {
          let data: Product[] = json.data;
          if (config.source === "manual" && config.productIds?.length) {
            const idSet = new Set(config.productIds);
            data = data.filter((p: Product) => idSet.has(p.id));
          }
          setProducts(data.slice(0, config.maxItems || 8));
        }
      } catch (e) {
        console.error(e);
      }
    }
    fetchProducts();
  }, [config]);

  if (products.length === 0) return null;

  return (
    <section className="container mx-auto px-4 py-8">
      <h2 className="text-2xl font-semibold mb-6">{title}</h2>
      <div className="flex gap-4 overflow-x-auto pb-4 snap-x snap-mandatory scrollbar-hide">
        {products.map((product) => (
          <div key={product.id} className="min-w-[260px] sm:min-w-[280px] snap-start">
            <ProductCard
              id={product.id}
              title={product.name}
              price={parseFloat(product.flashSalePrice || product.price || "0")}
              originalPrice={product.originalPrice ? parseFloat(product.originalPrice) : undefined}
              image={product.image || ""}
              rating={parseFloat(product.rating || "0")}
              sold={product.sold}
              isFlashSale={config.source === "flash_sale"}
            />
          </div>
        ))}
      </div>
    </section>
  );
}

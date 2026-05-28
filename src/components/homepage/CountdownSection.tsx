"use client";
import { useEffect, useState } from "react";
import ProductCard from "@/components/ProductCard";
import type { CountdownConfig } from "@/types/homepage";

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

interface CountdownSectionProps {
  config: CountdownConfig;
  title: string;
}

function useCountdown(targetDate: string) {
  const [remaining, setRemaining] = useState(0);
  useEffect(() => {
    const target = new Date(targetDate).getTime();
    const tick = () => {
      const diff = target - Date.now();
      setRemaining(diff > 0 ? diff : 0);
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [targetDate]);

  const hours = Math.floor(remaining / (1000 * 60 * 60));
  const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((remaining % (1000 * 60)) / 1000);
  return { hours, minutes, seconds, expired: remaining <= 0 };
}

export default function CountdownSection({ config, title }: CountdownSectionProps) {
  const [products, setProducts] = useState<Product[]>([]);
  const { hours, minutes, seconds, expired } = useCountdown(config.endDate);

  useEffect(() => {
    async function fetchProducts() {
      try {
        const res = await fetch("/api/products/flash-sale", { cache: "no-store" });
        const json = await res.json();
        if (json.success) {
          let data: Product[] = json.data;
          if (config.source === "manual" && config.productIds?.length) {
            const idSet = new Set(config.productIds);
            data = data.filter((p: Product) => idSet.has(p.id));
          }
          setProducts(data.slice(0, config.maxItems || 6));
        }
      } catch (e) {
        console.error(e);
      }
    }
    fetchProducts();
  }, [config]);

  if (expired) {
    return (
      <section className="container mx-auto px-4 py-8 text-center">
        <h2 className="text-2xl font-semibold mb-2">{title}</h2>
        <p className="text-muted-foreground">Flash Sale Telah Berakhir</p>
      </section>
    );
  }

  return (
    <section className="container mx-auto px-4 py-8">
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 mb-6">
        <h2 className="text-2xl font-semibold">{title}</h2>
        <div className="flex items-center gap-2 text-sm font-mono bg-primary text-primary-foreground px-3 py-1 rounded-md">
          <span>{String(hours).padStart(2, "0")}</span>:
          <span>{String(minutes).padStart(2, "0")}</span>:
          <span>{String(seconds).padStart(2, "0")}</span>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {products.map((product) => (
          <ProductCard
            key={product.id}
            id={product.id}
            title={product.name}
            price={parseFloat(product.flashSalePrice || product.price || "0")}
            originalPrice={product.originalPrice ? parseFloat(product.originalPrice) : undefined}
            image={product.image || ""}
            rating={parseFloat(product.rating || "0")}
            sold={product.sold}
            isFlashSale
          />
        ))}
      </div>
    </section>
  );
}

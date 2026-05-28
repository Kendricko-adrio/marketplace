import Link from "next/link";
import { Card } from "@/components/ui/card";
import CategoryIcon from "@/components/CategoryIcon";
import type { CategoryGridConfig } from "@/types/homepage";

interface Category {
  id: string;
  name: string;
  slug: string;
  icon?: string | null;
}

async function getCategories(): Promise<Category[]> {
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/api/categories`, { cache: "no-store" });
    const data = await res.json();
    return data.success ? data.data : [];
  } catch {
    return [];
  }
}

interface CategoryGridSectionProps {
  config: CategoryGridConfig;
  title: string;
}

export default async function CategoryGridSection({ config, title }: CategoryGridSectionProps) {
  const categories = await getCategories();
  const filtered = config.categoryIds?.length
    ? categories.filter((c) => config.categoryIds.includes(c.id))
    : categories;

  if (filtered.length === 0) return null;

  const cols = config.columns === 4 ? "grid-cols-2 md:grid-cols-4" : "grid-cols-2 md:grid-cols-3 lg:grid-cols-6";

  return (
    <section className="container mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-semibold">{title}</h2>
        <Link href="/products" className="text-primary hover:underline">Lihat Semua</Link>
      </div>
      <div className={`grid ${cols} gap-4`}>
        {filtered.map((cat) => (
          <Link key={cat.id} href={`/products?category=${cat.slug}`}>
            <Card className="p-6 flex flex-col items-center justify-center text-center cursor-pointer hover:bg-secondary/50 transition-colors border-none shadow-sm hover:shadow-md">
              {config.showIcon !== false && <CategoryIcon name={cat.icon} className="w-10 h-10 mb-2" />}
              <span className="text-sm font-medium">{cat.name}</span>
            </Card>
          </Link>
        ))}
      </div>
    </section>
  );
}

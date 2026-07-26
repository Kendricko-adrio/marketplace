import Link from "next/link";
import Image from "next/image";
import { ArrowRight } from "lucide-react";
import type {
  HomepageSectionData,
  PromoCardsContent,
  PromoCardItem,
  ProductFilterConfig,
} from "./types";

interface PromoCardsSectionProps {
  section: HomepageSectionData;
  preview?: boolean;
}

/**
 * Build a /products query string from a ProductFilterConfig.
 * Field names match the storefront /products page format.
 */
export function buildProductFilterQuery(filter: ProductFilterConfig): string {
  const params = new URLSearchParams();
  if (filter.search) params.set("search", filter.search);
  if (filter.category) params.set("category", filter.category);
  if (filter.minPrice) params.set("minPrice", filter.minPrice);
  if (filter.maxPrice) params.set("maxPrice", filter.maxPrice);
  if (filter.flashSale) params.set("flashSale", "true");
  if (filter.sortOrder) {
    const order = filter.sortOrder;
    if (order === "priceAsc") {
      params.set("sortOrder", "asc");
      params.set("sortBy", "price");
    } else if (order === "priceDesc") {
      params.set("sortOrder", "desc");
      params.set("sortBy", "price");
    } else if (order === "bestseller") {
      params.set("sortOrder", "desc");
      params.set("sortBy", "sold");
    } else if (order === "rating") {
      params.set("sortOrder", "desc");
      params.set("sortBy", "rating");
    } else {
      // newest
      params.set("sortOrder", "desc");
      params.set("sortBy", "createdAt");
    }
  }
  const qs = params.toString();
  return qs ? `/products?${qs}` : "/products";
}

export default function PromoCardsSection({
  section,
  preview,
}: PromoCardsSectionProps) {
  const content = (section.content ?? {}) as PromoCardsContent;
  const cards = content.cards ?? [];

  if (cards.length === 0) return null;

  return (
    <section className="container mx-auto px-4 py-8">
      {section.title && (
        <h2 className="text-xl sm:text-2xl font-bold mb-4">{section.title}</h2>
      )}
      {section.subtitle && (
        <p className="text-sm text-muted-foreground mb-4">{section.subtitle}</p>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {cards.map((card) => {
          // Backward-compat: legacy linkUrl (string) is ignored under the new
          // filter-based schema; cards without a filter object render as plain divs.
          const legacy = card as unknown as { linkUrl?: string };
          const hasFilter =
            !!card.filter &&
            typeof card.filter === "object" &&
            Object.keys(card.filter).length > 0;
          const href = hasFilter ? buildProductFilterQuery(card.filter as ProductFilterConfig) : null;
          const useLink = !preview && !!href && !legacy.linkUrl;

          const inner = (
            <div className="group rounded-xl border bg-card text-card-foreground shadow-sm overflow-hidden hover:shadow-lg transition-shadow duration-200">
              <div className="relative aspect-[16/9] bg-muted overflow-hidden">
                {card.imageUrl ? (
                  <Image
                    src={card.imageUrl}
                    alt={card.title}
                    fill
                    className="object-cover transition-transform group-hover:scale-105"
                    sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                  />
                ) : (
                  <div className="absolute inset-0 bg-gradient-to-br from-secondary to-accent" />
                )}
              </div>
              <div className="p-4 flex items-center justify-between">
                <h3 className="font-semibold text-base">{card.title}</h3>
                <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary group-hover:translate-x-1 transition-all" />
              </div>
            </div>
          );

          if (!useLink) {
            return <div key={card.id}>{inner}</div>;
          }
          return (
            <Link key={card.id} href={href as string}>
              {inner}
            </Link>
          );
        })}
      </div>
    </section>
  );
}
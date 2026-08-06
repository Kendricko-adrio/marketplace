import ProductCard from "../store/ProductCard";
import type { HomepageSectionData, HomepageProduct } from "./types";

interface CarouselProductSectionProps {
  section: HomepageSectionData;
  preview?: boolean;
}

export default function CarouselProductSection({
  section,
  preview,
}: CarouselProductSectionProps) {
  const products = section.products ?? [];

  if (products.length === 0) return null;

  return (
    <section className="container mx-auto px-4 py-8">
      {section.title && (
        <h2 className="text-xl sm:text-2xl font-bold mb-4">{section.title}</h2>
      )}
      {section.subtitle && (
        <p className="text-sm text-muted-foreground mb-4">{section.subtitle}</p>
      )}
      <div className="flex gap-4 overflow-x-auto snap-x snap-mandatory pb-4 -mx-4 px-4">
        {products.map((p) => (
          <div
            key={p.id}
            className="snap-start shrink-0 w-[200px] sm:w-[240px] md:w-[260px]"
          >
            <CarouselProductCard product={p} preview={preview} />
          </div>
        ))}
      </div>
    </section>
  );
}

function CarouselProductCard({
  product,
  preview,
}: {
  product: HomepageProduct;
  preview?: boolean;
}) {
  const price = parseFloat(String(product.price ?? product.basePrice ?? "0"));
  const basePrice = parseFloat(String(product.basePrice ?? "0"));
  const originalPrice = basePrice > price ? basePrice : undefined;

  return (
    <ProductCard
      id={product.id}
      title={product.name}
      price={price}
      originalPrice={originalPrice}
      image={product.image ?? ""}
      preview={preview}
      gender={product.gender ?? undefined}
      collection={product.collection ?? undefined}
    />
  );
}
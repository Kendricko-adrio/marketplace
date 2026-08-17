import Link from "next/link";
import Image from "next/image";
import { ShoppingCart } from "lucide-react";
import { Card, CardContent } from "../ui/card";
import { Badge } from "../ui/badge";

interface ProductCardProps {
  /** Product slug — used for the detail-page link (never the raw id, which is
   *  an internal PK and must not be exposed in customer-facing URLs). */
  slug: string;
  title: string;
  price: number;
  originalPrice?: number;
  image: string;
  preview?: boolean;
  gender?: string;
  collection?: string;
  /** True when the product has no sellable stock in any branch — the card is
   *  greyed out and the detail link is disabled. */
  outOfStock?: boolean;
}

export default function ProductCard({
  slug,
  title,
  price,
  originalPrice,
  image,
  preview,
  gender,
  collection,
  outOfStock,
}: ProductCardProps) {
  const discount = originalPrice
    ? Math.round(((originalPrice - price) / originalPrice) * 100)
    : 0;

  const imageBlock = (
    <>
      {image ? (
        <Image
          src={image}
          alt={title}
          fill
          className="object-cover"
          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
        />
      ) : (
        <div className="flex items-center justify-center h-full text-muted-foreground">
          <ShoppingCart className="h-10 w-10 opacity-20" />
        </div>
      )}
      {discount > 0 && (
        <Badge className="absolute top-2 right-2 bg-destructive text-destructive-foreground hover:bg-destructive">
          {discount}%
        </Badge>
      )}
      {outOfStock && (
        <Badge className="absolute top-2 left-2 bg-muted text-muted-foreground">
          Stok Habis
        </Badge>
      )}
    </>
  );

  const titleBlock = (
    <span className="font-medium text-sm text-card-foreground line-clamp-2 mb-2 hover:text-primary transition-colors h-10">
      {title}
    </span>
  );

  return (
    <Card
      className={`overflow-hidden h-full flex flex-col hover:shadow-lg transition-shadow duration-200 ${
        outOfStock ? "opacity-50" : ""
      }`}
    >
      <div
        className="relative block aspect-square bg-muted overflow-hidden"
        {...(preview ? {} : { "data-href": `/products/${slug}` })}
      >
        {preview ? (
          imageBlock
        ) : outOfStock ? (
          // Out of stock: no navigation — the card is greyed out and the
          // detail link is disabled (nothing to add to cart).
          <span className="contents">{imageBlock}</span>
        ) : (
          <Link href={`/products/${slug}`} className="contents">
            {imageBlock}
          </Link>
        )}
      </div>

      <CardContent className="p-4 flex-1 flex flex-col">
        {preview ? (
          titleBlock
        ) : outOfStock ? (
          <span className="font-medium text-sm text-card-foreground line-clamp-2 mb-2 h-10">
            {title}
          </span>
        ) : (
          <Link
            href={`/products/${slug}`}
            className="font-medium text-sm text-card-foreground line-clamp-2 mb-2 hover:text-primary transition-colors h-10"
          >
            {title}
          </Link>
        )}

        {(gender || collection) && (
          <div className="mb-3 flex flex-wrap gap-2">
            {gender && (
              <span className="inline-flex items-center rounded-md bg-blue-500/15 text-blue-700 px-2 py-1 text-xs font-medium">
                {gender}
              </span>
            )}
            {collection && (
              <span className="inline-flex items-center rounded-md bg-amber-500/15 text-amber-700 px-2 py-1 text-xs font-medium">
                {collection}
              </span>
            )}
          </div>
        )}

        <div className="mt-auto">
          <div className="flex flex-col mb-2">
            <span className="text-lg font-bold text-primary">
              Rp {price.toLocaleString("id-ID")}
            </span>
            {originalPrice && (
              <span className="text-xs text-muted-foreground line-through">
                Rp {originalPrice.toLocaleString("id-ID")}
              </span>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
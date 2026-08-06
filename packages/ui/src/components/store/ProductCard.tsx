import Link from "next/link";
import Image from "next/image";
import { ShoppingCart } from "lucide-react";
import { Card, CardContent } from "../ui/card";
import { Badge } from "../ui/badge";

interface ProductCardProps {
  id: string;
  title: string;
  price: number;
  originalPrice?: number;
  image: string;
  preview?: boolean;
  gender?: string;
  collection?: string;
}

export default function ProductCard({
  id,
  title,
  price,
  originalPrice,
  image,
  preview,
  gender,
  collection,
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
    </>
  );

  const titleBlock = (
    <span className="font-medium text-sm text-card-foreground line-clamp-2 mb-2 hover:text-primary transition-colors h-10">
      {title}
    </span>
  );

  return (
    <Card className="overflow-hidden h-full flex flex-col hover:shadow-lg transition-shadow duration-200">
      <div
        className="relative block aspect-square bg-muted overflow-hidden"
        {...(preview ? {} : { "data-href": `/products/${id}` })}
      >
        {preview ? (
          imageBlock
        ) : (
          <Link href={`/products/${id}`} className="contents">
            {imageBlock}
          </Link>
        )}
      </div>

      <CardContent className="p-4 flex-1 flex flex-col">
        {preview ? (
          titleBlock
        ) : (
          <Link
            href={`/products/${id}`}
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
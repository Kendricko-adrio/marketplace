import Link from "next/link";
import { ShoppingCart, Star, Heart } from "lucide-react";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface ProductCardProps {
  id: string;
  title: string;
  price: number;
  originalPrice?: number;
  image: string;
  rating: number;
  sold: number;
  isFlashSale?: boolean;
  isWishlisted?: boolean;
  onToggleWishlist?: (productId: string) => void;
}

export default function ProductCard({
  id,
  title,
  price,
  originalPrice,
  image,
  rating,
  sold,
  isFlashSale,
  isWishlisted,
  onToggleWishlist,
}: ProductCardProps) {
  const discount = originalPrice
    ? Math.round(((originalPrice - price) / originalPrice) * 100)
    : 0;

  return (
    <Card className="overflow-hidden h-full flex flex-col hover:shadow-lg transition-shadow duration-200">
      <Link
        href={`/products/${id}`}
        className="relative block aspect-square bg-muted"
      >
        {/* <Image src={image} alt={title} fill className="object-cover" /> */}
        {onToggleWishlist && (
          <button
            onClick={(e) => {
              e.preventDefault(); // Jangan navigate ke product detail
              e.stopPropagation();
              onToggleWishlist(id);
            }}
            className="absolute top-2 left-2 z-10 p-1.5 rounded-full bg-background/80 hover:bg-background transition-colors"
          >
            <Heart
              className={`w-4 h-4 ${
                isWishlisted ? "fill-red-500 text-red-500" : "text-muted-foreground"
              }`}
            />
          </button>
        )}
        {discount > 0 && (
          <Badge className="absolute top-2 right-2 bg-destructive text-destructive-foreground hover:bg-destructive">
            {discount}%
          </Badge>
        )}
      </Link>

      <CardContent className="p-4 flex-1 flex flex-col">
        <Link
          href={`/products/${id}`}
          className="font-medium text-sm text-card-foreground line-clamp-2 mb-2 hover:text-primary transition-colors h-10"
        >
          {title}
        </Link>

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

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <div className="flex items-center gap-1">
              <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
              <span>{rating}</span>
            </div>
            <span>Terjual {sold}</span>
          </div>
        </div>
      </CardContent>

      <CardFooter className="p-4 pt-0">
        <Button className="w-full gap-2" variant="outline">
          <ShoppingCart className="h-4 w-4" />
          <span>+ Keranjang</span>
        </Button>
      </CardFooter>
    </Card>
  );
}

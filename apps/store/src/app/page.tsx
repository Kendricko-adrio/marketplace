import Link from "next/link";
import ProductCard from "@/components/ProductCard";
import CategoryIcon from "@/components/CategoryIcon";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

// Types
interface Product {
  id: string;
  name: string;
  slug: string;
  price: string;
  basePrice: string;
  originalPrice?: string;
  rating: string | null;
  sold: number;
  image: string | null;
  isFlashSale?: boolean;
  flashSalePrice?: string | null;
}

interface Category {
  id: string;
  name: string;
  slug: string;
  icon?: string | null;
}

// Fetch functions
async function getFlashSaleProducts(): Promise<Product[]> {
  try {
    const res = await fetch(
      `${
        process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"
      }/api/products/flash-sale`,
      {
        cache: "no-store",
      }
    );
    const data = await res.json();
    return data.success ? data.data : [];
  } catch (error) {
    console.error("Error fetching flash sale products:", error);
    return [];
  }
}

async function getBestSellerProducts(): Promise<Product[]> {
  try {
    const res = await fetch(
      `${
        process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"
      }/api/products/best-seller`,
      {
        cache: "no-store",
      }
    );
    const data = await res.json();
    return data.success ? data.data : [];
  } catch (error) {
    console.error("Error fetching best seller products:", error);
    return [];
  }
}

async function getCategories(): Promise<Category[]> {
  try {
    const res = await fetch(
      `${
        process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"
      }/api/categories`,
      {
        cache: "no-store",
      }
    );
    const data = await res.json();
    return data.success ? data.data : [];
  } catch (error) {
    console.error("Error fetching categories:", error);
    return [];
  }
}

export default async function Home() {
  const [flashSaleProducts, bestSellerProducts, categories] = await Promise.all(
    [getFlashSaleProducts(), getBestSellerProducts(), getCategories()]
  );

  return (
    <div className="container mx-auto px-4">
      {/* Hero Section */}
      <section className="py-16 text-center bg-secondary/30 rounded-3xl mt-8">
        <h1 className="text-5xl font-bold mb-4 text-foreground tracking-tight">
          Promo Spesial Akhir Tahun
        </h1>
        <p className="text-xl text-muted-foreground mb-8">
          Diskon hingga 70% untuk produk pilihan.
        </p>
        <Link href="/products">
          <Button size="lg" className="rounded-full px-8">
            Belanja Sekarang
          </Button>
        </Link>
      </section>

      {/* Categories Grid */}
      <section className="my-16">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-semibold">Kategori Pilihan</h2>
          <Link href="/products" className="text-primary hover:underline">
            Lihat Semua
          </Link>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {categories.map((cat) => (
            <Link key={cat.id} href={`/products?category=${cat.slug}`}>
              <Card className="p-6 flex flex-col items-center justify-center text-center cursor-pointer hover:bg-secondary/50 transition-colors border-none shadow-sm hover:shadow-md">
                <CategoryIcon name={cat.icon} className="w-10 h-10 mb-2" />
                <span className="text-sm font-medium">{cat.name}</span>
              </Card>
            </Link>
          ))}
        </div>
      </section>

      {/* Flash Sale Section */}
      {flashSaleProducts.length > 0 && (
        <section className="my-16">
          <div className="flex items-center gap-4 mb-6">
            <h2 className="text-2xl font-semibold">Flash Sale</h2>
            <span className="bg-destructive text-destructive-foreground text-sm font-semibold px-3 py-1 rounded-full">
              Sedang Berlangsung
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {flashSaleProducts.slice(0, 4).map((product) => (
              <ProductCard
                key={product.id}
                id={product.id}
                title={product.name}
                price={parseFloat(
                  product.price || product.flashSalePrice || product.basePrice
                )}
                originalPrice={parseFloat(
                  product.originalPrice || product.basePrice
                )}
                image={product.image || ""}
                rating={parseFloat(product.rating || "0")}
                sold={product.sold}
                isFlashSale={true}
              />
            ))}
          </div>
        </section>
      )}

      {/* Best Seller Section */}
      {bestSellerProducts.length > 0 && (
        <section className="my-16">
          <h2 className="text-2xl font-semibold mb-6">Produk Terlaris</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {bestSellerProducts.slice(0, 8).map((product) => (
              <ProductCard
                key={product.id}
                id={product.id}
                title={product.name}
                price={parseFloat(product.price || product.basePrice)}
                image={product.image || ""}
                rating={parseFloat(product.rating || "0")}
                sold={product.sold}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

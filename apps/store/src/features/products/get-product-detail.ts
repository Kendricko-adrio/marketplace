import { cache } from "react";
import type { Metadata } from "next";
import { and, asc, eq, sql } from "drizzle-orm";
import {
  branches,
  branchStocks,
  brands,
  categories,
  db,
  genders,
  productImages,
  products,
  productToCategory,
  productVariants,
} from "@/db";
import { sellableUnits } from "@/lib/stock";
import { sellableVariantSql } from "@/lib/storefront-stock";
import { readVariantProjections } from "@/lib/variant-price-projection";

export interface ProductBranchStockDto {
  branchId: string;
  name: string;
  code: string;
  city: string | null;
  stock: number;
  reservedStock: number;
  pendingRemoteStock?: number;
  availableStock?: number | null;
  available: number;
}

export interface ProductVariantDto {
  id: string;
  sku: string;
  color: string | null;
  size: string | null;
  /** Effective price (Markdown applied when active). */
  price: string;
  /** Source (Jubelio base) price of THIS variant. */
  sourcePrice?: string;
  storedTarget?: string | null;
  markdownActive?: boolean;
  markdownRevisionId?: string | null;
  isDefault: boolean;
  images: string[];
  branchStock: ProductBranchStockDto[];
}

export interface ProductCategoryDto {
  id: string;
  name: string;
  slug: string;
}

export interface ProductDetailDto {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  basePrice: string;
  status: string;
  brand: string | null;
  gender: string | null;
  collection: string | null;
  season: string | null;
  articleNumber: string | null;
  images?: Array<{ url: string }> | null;
  categories: ProductCategoryDto[];
  variants: ProductVariantDto[];
  colors: string[];
  sizes: string[];
}

const MAX_META_DESCRIPTION_LENGTH = 160;

/**
 * Strip HTML tags from product description and clamp to 160 characters for
 * clean SEO & Open Graph previews.
 */
function formatPlainDescription(
  rawDescription: string | null,
  productName: string
): string {
  const plain = (rawDescription ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!plain) {
    return `Beli ${productName} di ADF Sports.`;
  }

  if (plain.length <= MAX_META_DESCRIPTION_LENGTH) {
    return plain;
  }

  return `${plain.slice(0, MAX_META_DESCRIPTION_LENGTH - 3).trimEnd()}...`;
}

/**
 * Pure helper to build Next.js Metadata (title, description, Open Graph) for
 * a product detail page.
 */
export function buildProductMetadata(
  product: ProductDetailDto | null
): Metadata {
  if (!product) {
    return {
      title: "Produk tidak ditemukan | ADF Sports",
    };
  }

  const title = `${product.name} | ADF Sports`;
  const description = formatPlainDescription(product.description, product.name);
  const defaultVariant =
    product.variants.find((v) => v.isDefault) ?? product.variants[0];
  const primaryImage =
    defaultVariant?.images[0] ??
    product.variants.find((v) => v.images.length > 0)?.images[0] ??
    product.images?.[0]?.url;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: primaryImage ? [primaryImage] : undefined,
    },
  };
}

/**
 * Load full product detail (by ID or slug) including categories, brand,
 * gender, sellable variants with active Markdown projections, images, and
 * active branch stocks.
 */
export async function getProductDetailByIdOrSlug(
  idOrSlug: string
): Promise<ProductDetailDto | null> {
  const [byId] = await db
    .select()
    .from(products)
    .where(eq(products.id, idOrSlug))
    .limit(1);

  const productData =
    byId ??
    (
      await db
        .select()
        .from(products)
        .where(eq(products.slug, idOrSlug))
        .limit(1)
    )[0];

  if (!productData) {
    return null;
  }

  const productCategories = await db
    .select({
      id: categories.id,
      name: categories.name,
      slug: categories.slug,
    })
    .from(productToCategory)
    .innerJoin(categories, eq(productToCategory.categoryId, categories.id))
    .where(eq(productToCategory.productId, productData.id));

  // brandId / genderId are nullable FKs; preserve products without them.
  const [brandRow] = productData.brandId
    ? await db
        .select({ name: brands.name })
        .from(brands)
        .where(eq(brands.id, productData.brandId))
        .limit(1)
    : [];

  const [genderRow] = productData.genderId
    ? await db
        .select({ name: genders.name })
        .from(genders)
        .where(eq(genders.id, productData.genderId))
        .limit(1)
    : [];

  const variants = await db
    .select()
    .from(productVariants)
    .where(
      and(eq(productVariants.productId, productData.id), sellableVariantSql())
    )
    .orderBy(asc(productVariants.isDefault));

  const projections = await readVariantProjections(variants.map((v) => v.id));

  const variantsWithImagesAndStock = await Promise.all(
    variants.map(async (variant) => {
      const variantImages = await db
        .select()
        .from(productImages)
        .where(eq(productImages.variantId, variant.id))
        .orderBy(asc(productImages.displayOrder));

      const images =
        variantImages.length > 0
          ? variantImages.map((img) => img.url)
          : (productData.images ?? []).map((img) => img.url);

      // Hanya cabang dengan sellable > 0 yang dapat dipilih.
      const branchStockRows =
        variant.jubelioItemId == null
          ? []
          : await db
              .select({
                branchId: branches.id,
                name: branches.name,
                code: branches.code,
                city: branches.city,
                stock: branchStocks.stock,
                reservedStock: branchStocks.reservedStock,
                pendingRemoteStock: branchStocks.pendingRemoteStock,
                availableStock: branchStocks.availableStock,
              })
              .from(branchStocks)
              .innerJoin(branches, eq(branchStocks.branchId, branches.id))
              .where(
                and(
                  eq(branchStocks.productVariantId, variant.id),
                  eq(branches.status, "aktif"),
                  sql`${branches.jubelioLocationId} is not null`,
                  sql`COALESCE(${branchStocks.availableStock}, 0) - ${branchStocks.pendingRemoteStock} > 0`
                )
              )
              .orderBy(asc(branches.name));

      const branchStock = branchStockRows.map((b) => ({
        ...b,
        available: sellableUnits(b),
      }));

      const projection = projections.get(variant.id);
      return {
        ...variant,
        price: projection?.effectiveUnitPrice ?? variant.price,
        sourcePrice: projection?.sourceUnitPrice ?? variant.price,
        storedTarget: projection?.storedTarget ?? null,
        markdownActive: projection?.markdownActive ?? false,
        markdownRevisionId: projection?.markdownRevisionId ?? null,
        images,
        branchStock,
      };
    })
  );

  const colors = [
    ...new Set(
      variants.map((v) => v.color).filter((c): c is string => Boolean(c))
    ),
  ];
  const sizes = [
    ...new Set(
      variants.map((v) => v.size).filter((s): s is string => Boolean(s))
    ),
  ];

  return {
    ...productData,
    brand: brandRow?.name ?? null,
    gender: genderRow?.name ?? null,
    collection: productData.collection ?? null,
    categories: productCategories,
    variants: variantsWithImagesAndStock,
    colors,
    sizes,
  };
}

/**
 * Request-scoped memoized product detail loader for Server Components
 * (`generateMetadata` + page render share one DB round-trip).
 */
export const getCachedProductDetail = cache(getProductDetailByIdOrSlug);

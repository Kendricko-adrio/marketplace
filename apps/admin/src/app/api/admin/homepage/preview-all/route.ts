import { NextResponse } from "next/server";
import { db } from "@/db";
import {
  homepageSections,
  homepageSectionProducts,
  products,
  productVariants,
  productImages,
  productToCategory,
  categories,
  branches,
} from "@/db";
import { eq, and, asc, inArray, desc, ilike, or, gte, lte } from "drizzle-orm";
import { withPermission } from "@/lib/auth-guard";
import type { ProductFilterConfig, CarouselContent } from "@/db";

/**
 * Returns ALL homepage sections (active and inactive) with the same data
 * shape as the storefront /api/homepage endpoint — carousel products and
 * store_banner branches are fully hydrated so the admin preview page can
 * render every section, even when it is inactive.
 *
 * The storefront /api/homepage endpoint only returns active sections, so it
 * cannot be used (even via a proxy) to preview inactive sections. This
 * endpoint fills that gap by querying the DB directly on the admin side.
 */
export const GET = withPermission(async () => {
  try {
    const sections = await db
      .select()
      .from(homepageSections)
      .orderBy(asc(homepageSections.displayOrder));

    if (sections.length === 0) {
      return NextResponse.json({ success: true, data: [] });
    }

    // --- Carousel: manual mode (junction) ---
    const manualCarouselIds: string[] = [];
    const filterCarousels: { id: string; content: CarouselContent }[] = [];
    for (const s of sections) {
      if (s.type !== "carousel_product") continue;
      const c = (s.content ?? {}) as Partial<CarouselContent>;
      if (c.mode === "filter") {
        filterCarousels.push({
          id: s.id,
          content: {
            mode: "filter",
            filter: c.filter ?? {},
            limit: c.limit ?? 10,
          },
        });
      } else {
        manualCarouselIds.push(s.id);
      }
    }

    const productSectionsMap = new Map<
      string,
      { productId: string; displayOrder: number }[]
    >();

    if (manualCarouselIds.length > 0) {
      const junctionRows = await db
        .select()
        .from(homepageSectionProducts)
        .where(inArray(homepageSectionProducts.sectionId, manualCarouselIds))
        .orderBy(asc(homepageSectionProducts.displayOrder));

      for (const row of junctionRows) {
        const arr = productSectionsMap.get(row.sectionId) ?? [];
        arr.push({ productId: row.productId, displayOrder: row.displayOrder });
        productSectionsMap.set(row.sectionId, arr);
      }
    }

    const allProductIds = Array.from(
      new Set(
        Array.from(productSectionsMap.values()).flatMap((arr) =>
          arr.map((r) => r.productId)
        )
      )
    );

    const productMap = new Map<
      string,
      (typeof products)["$inferSelect"] & { _image?: string | null; _price?: string }
    >();
    if (allProductIds.length > 0) {
      const productRows = await db
        .select()
        .from(products)
        .where(inArray(products.id, allProductIds));
      for (const p of productRows) productMap.set(p.id, p);

      const defaultVariants = await db
        .select()
        .from(productVariants)
        .where(
          and(
            inArray(productVariants.productId, allProductIds),
            eq(productVariants.isDefault, true)
          )
        );

      const variantIds = defaultVariants.map((v) => v.id);
      const images =
        variantIds.length > 0
          ? await db
              .select()
              .from(productImages)
              .where(inArray(productImages.variantId, variantIds))
              .orderBy(asc(productImages.displayOrder))
          : [];

      const imageMap = new Map<string, string>();
      for (const img of images) {
        if (!imageMap.has(img.variantId)) {
          imageMap.set(img.variantId, img.url);
        }
      }

      const variantMap = new Map(defaultVariants.map((v) => [v.productId, v]));
      for (const p of productRows) {
        const variant = variantMap.get(p.id);
        (p as unknown as { _image?: string | null })._image = variant
          ? imageMap.get(variant.id) ?? null
          : null;
        (p as unknown as { _price?: string })._price = variant?.price ?? p.basePrice;
      }
    }

    // --- Carousel: filter mode (dynamic query per section) ---
    const filterResults = await Promise.all(
      filterCarousels.map(async (c) => ({
        sectionId: c.id,
        items: await resolveFilterModeProducts(c.content.filter ?? {}, c.content.limit ?? 10),
      }))
    );
    const filterResultsMap = new Map(filterResults.map((r) => [r.sectionId, r.items]));

    // --- store_banner: fetch active branches for every store_banner section ---
    const storeBannerSectionIds = sections
      .filter((s) => s.type === "store_banner")
      .map((s) => s.id);

    const branchRows = storeBannerSectionIds.length
      ? await db
          .select()
          .from(branches)
          .where(eq(branches.status, "aktif"))
          .orderBy(asc(branches.name))
      : [];

    // --- Assemble final payload ---
    const data = sections.map((section) => {
      if (section.type === "carousel_product") {
        const c = (section.content ?? {}) as Partial<CarouselContent>;
        if (c.mode === "filter") {
          const items = filterResultsMap.get(section.id) ?? [];
          return {
            ...section,
            products: items.map((p) => ({
              id: p.id,
              name: p.name,
              slug: p.slug,
              price: p.price,
              basePrice: p.basePrice,
              image: p.image,
              rating: p.rating,
              sold: p.sold,
              isFlashSale: p.isFlashSale,
              flashSalePrice: p.flashSalePrice,
            })),
          };
        }
        const linked = productSectionsMap.get(section.id) ?? [];
        const sectionProducts = linked
          .map((link) => {
            const p = productMap.get(link.productId);
            if (!p) return null;
            const img = (p as unknown as { _image?: string | null })._image ?? null;
            const price = (p as unknown as { _price?: string })._price ?? p.basePrice;
            return {
              id: p.id,
              name: p.name,
              slug: p.slug,
              price: price,
              basePrice: p.basePrice,
              image: img,
              rating: p.rating,
              sold: p.sold,
              isFlashSale: p.isFlashSale,
              flashSalePrice: p.flashSalePrice,
            };
          })
          .filter((x): x is NonNullable<typeof x> => x !== null);
        return { ...section, products: sectionProducts };
      }
      if (section.type === "store_banner") {
        return { ...section, branches: branchRows };
      }
      return section;
    });

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error("Error fetching all homepage sections for preview:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch homepage sections" },
      { status: 500 }
    );
  }
}, "homepage", "view");

/**
 * Resolve carousel products for "filter" mode. Mirrors the logic in the
 * storefront /api/homepage endpoint and /api/products route.
 */
type FilteredProduct = {
  id: string;
  name: string;
  slug: string;
  price: string;
  basePrice: string;
  rating: string | null;
  sold: number;
  isFlashSale: boolean;
  flashSalePrice: string | null;
  image: string | null;
};

async function resolveFilterModeProducts(
  filter: ProductFilterConfig,
  limit: number
): Promise<FilteredProduct[]> {
  const conditions = [];
  conditions.push(eq(products.status, "aktif"));
  if (filter.search) {
    conditions.push(
      or(
        ilike(products.name, `%${filter.search}%`),
        ilike(products.description, `%${filter.search}%`)
      ) as unknown as ReturnType<typeof eq>
    );
  }
  if (filter.flashSale) conditions.push(eq(products.isFlashSale, true));
  if (filter.minPrice) conditions.push(gte(products.basePrice, filter.minPrice));
  if (filter.maxPrice) conditions.push(lte(products.basePrice, filter.maxPrice));

  const order = filter.sortOrder ?? "newest";
  let orderBy;
  switch (order) {
    case "priceAsc":
      orderBy = asc(products.basePrice);
      break;
    case "priceDesc":
      orderBy = desc(products.basePrice);
      break;
    case "bestseller":
      orderBy = desc(products.sold);
      break;
    case "rating":
      orderBy = desc(products.rating);
      break;
    case "newest":
    default:
      orderBy = desc(products.createdAt);
      break;
  }

  const safeLimit = Math.min(20, Math.max(1, limit || 10));

  if (filter.category) {
    const category = await db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.slug, filter.category))
      .limit(1);

    if (category.length === 0) return [];

    const rows = await db
      .select({
        id: products.id,
        name: products.name,
        slug: products.slug,
        basePrice: products.basePrice,
        rating: products.rating,
        sold: products.sold,
        isFlashSale: products.isFlashSale,
        flashSalePrice: products.flashSalePrice,
        createdAt: products.createdAt,
      })
      .from(products)
      .innerJoin(productToCategory, eq(products.id, productToCategory.productId))
      .where(and(eq(productToCategory.categoryId, category[0].id), ...conditions))
      .orderBy(orderBy)
      .limit(safeLimit);

    return hydrateProducts(rows);
  }

  const rows = await db
    .select({
      id: products.id,
      name: products.name,
      slug: products.slug,
      basePrice: products.basePrice,
      rating: products.rating,
      sold: products.sold,
      isFlashSale: products.isFlashSale,
      flashSalePrice: products.flashSalePrice,
      createdAt: products.createdAt,
    })
    .from(products)
    .where(and(...conditions))
    .orderBy(orderBy)
    .limit(safeLimit);

  return hydrateProducts(rows);
}

async function hydrateProducts(
  rows: Array<{
    id: string;
    name: string;
    slug: string;
    basePrice: string;
    rating: string | null;
    sold: number;
    isFlashSale: boolean;
    flashSalePrice: string | null;
    createdAt: Date;
  }>
) {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const defaultVariants = await db
    .select()
    .from(productVariants)
    .where(and(inArray(productVariants.productId, ids), eq(productVariants.isDefault, true)));
  const variantIds = defaultVariants.map((v) => v.id);
  const images =
    variantIds.length > 0
      ? await db
          .select()
          .from(productImages)
          .where(inArray(productImages.variantId, variantIds))
          .orderBy(asc(productImages.displayOrder))
      : [];
  const imageMap = new Map<string, string>();
  for (const img of images) {
    if (!imageMap.has(img.variantId)) imageMap.set(img.variantId, img.url);
  }
  const variantMap = new Map(defaultVariants.map((v) => [v.productId, v]));

  return rows.map((r) => {
    const variant = variantMap.get(r.id);
    return {
      id: r.id,
      name: r.name,
      slug: r.slug,
      price: variant?.price ?? r.basePrice,
      basePrice: r.basePrice,
      rating: r.rating,
      sold: r.sold,
      isFlashSale: r.isFlashSale,
      flashSalePrice: r.flashSalePrice,
      image: variant ? imageMap.get(variant.id) ?? null : null,
    };
  });
}
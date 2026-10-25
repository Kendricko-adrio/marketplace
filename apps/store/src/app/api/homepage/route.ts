import { NextResponse } from "next/server";
import { createModuleLogger, withRequestContext } from "@/lib/logger";
import { sellableVariantSql, sellableProductSql } from "@/lib/storefront-stock";
import { db } from "@/db";
import {
  homepageSections,
  homepageSectionProducts,
  products,
  productVariants,
  productImages,
  productToCategory,
  categories,
  brands,
  genders,
  branches,
  variantPriceCurrent,
  variantPriceRevisions,
} from "@/db";
import { eq, and, asc, inArray, desc, ilike, or, gte, lte, sql } from "drizzle-orm";
import type { ProductFilterConfig, CarouselContent } from "@/db";
import {
  effectivePriceSql,
  markdownActiveSql,
  projectRow,
} from "@/lib/variant-price-projection";

/**
 * Module logger untuk route ini: dibuat sekali di module scope, sedangkan
 * `requestId` dibaca dari scope HTTP yang aktif setiap kali log ditulis
 * (`withRequestContext` di export handler membuka scope tersebut).
 */
const log = createModuleLogger("homepage");

/**
 * Proyeksi teknis statis untuk field `error`: pesan asli dari DB/Next/provider
 * tidak pernah masuk log, hanya pesan yang ditulis module ini.
 */
class RouteLogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RouteLogError";
  }
}

type ProductRow = (typeof products)["$inferSelect"];

/**
 * Resolve carousel products in "filter" mode. Mirrors the filter logic in
 * apps/store/src/app/api/products/route.ts but returns up to `limit` items
 * already shaped as HomepageProduct.
 */
async function resolveFilterModeProducts(
  filter: ProductFilterConfig,
  limit: number
): Promise<{
  id: string;
  name: string;
  slug: string;
  price: string;
  sourcePrice: string;
  markdownActive: boolean;
  basePrice: string;
  image: string | null;
  collection: string | null;
  gender: string | null;
}[]> {
  // Cheapest variant EFFECTIVE price per product (Markdown applied only while
  // the target is below the variant's current source). Joined, no N+1.
  const minPriceSq = db
    .select({
      productId: productVariants.productId,
      minPrice: sql<string>`min(${effectivePriceSql(
        productVariants.price,
        variantPriceRevisions.targetUnitPrice
      )})`.as("minPrice"),
      hasMarkdown: sql<boolean>`bool_or(${markdownActiveSql(
        productVariants.price,
        variantPriceRevisions.targetUnitPrice
      )})`.as("hasMarkdown"),
    })
    .from(productVariants)
    .leftJoin(
      variantPriceCurrent,
      eq(variantPriceCurrent.variantId, productVariants.id)
    )
    .leftJoin(
      variantPriceRevisions,
      and(
        eq(variantPriceRevisions.id, variantPriceCurrent.revisionId),
        eq(variantPriceRevisions.variantId, variantPriceCurrent.variantId)
      )
    )
    .where(sellableVariantSql())
    .groupBy(productVariants.productId)
    .as("vp");

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
  if (filter.hasDiscount) {
    // "Diskon" means an ACTIVE Markdown on a relevant variant — never the
    // legacy RRP (product.base_price) above the cheapest variant.
    conditions.push(sql`${minPriceSq.hasMarkdown}`);
  }
  if (filter.minPrice) conditions.push(gte(minPriceSq.minPrice, filter.minPrice));
  if (filter.maxPrice) conditions.push(lte(minPriceSq.minPrice, filter.maxPrice));

  // Brand filter (slug → brandId). Unknown slug → no results.
  if (filter.brand) {
    const brand = await db
      .select({ id: brands.id })
      .from(brands)
      .where(eq(brands.slug, filter.brand))
      .limit(1);
    conditions.push(brand.length ? eq(products.brandId, brand[0].id) : sql`false`);
  }

  // Category filter (slug → id) via a subquery on the junction table.
  if (filter.category) {
    const category = await db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.slug, filter.category))
      .limit(1);
    if (category.length === 0) return [];
    conditions.push(
      inArray(
        products.id,
        db
          .select({ productId: productToCategory.productId })
          .from(productToCategory)
          .where(eq(productToCategory.categoryId, category[0].id))
      )
    );
  }

  const order = filter.sortOrder ?? "newest";
  let orderBy;
  switch (order) {
    case "priceAsc":
      orderBy = asc(minPriceSq.minPrice);
      break;
    case "priceDesc":
      orderBy = desc(minPriceSq.minPrice);
      break;
    case "newest":
    default:
      orderBy = desc(products.createdAt);
      break;
  }

  const safeLimit = Math.min(20, Math.max(1, limit || 10));

  const selectCols = {
    id: products.id,
    name: products.name,
    slug: products.slug,
    basePrice: products.basePrice,
    createdAt: products.createdAt,
    price: minPriceSq.minPrice,
    collection: products.collection,
    gender: genders.name,
    thumbnail: products.thumbnail,
  };

  const rows = await db
    .select(selectCols)
    .from(products)
    .innerJoin(minPriceSq, eq(products.id, minPriceSq.productId))
    .leftJoin(genders, eq(products.genderId, genders.id))
    .where(and(...conditions))
    .orderBy(orderBy)
    .limit(safeLimit);

  return hydrateProducts(rows);
}

/**
 * Attach the default-variant image to each product row. Price (cheapest
 * variant net) already comes from the joined subquery; image comes from the
 * default/first variant — kept separate from the price source.
 */
async function hydrateProducts(
  rows: Array<{
    id: string;
    name: string;
    slug: string;
    basePrice: string;
    price: string | null;
    createdAt: Date;
    collection: string | null;
    gender: string | null;
    thumbnail: string | null;
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

  // Cheapest EFFECTIVE variant + its own source (bounded to one homepage page).
  const variantRows = await db
    .select({
      id: productVariants.id,
      productId: productVariants.productId,
      price: productVariants.price,
      targetUnitPrice: variantPriceRevisions.targetUnitPrice,
      markdownRevisionId: variantPriceRevisions.id,
      revisionVariantId: variantPriceRevisions.variantId,
    })
    .from(productVariants)
    .leftJoin(
      variantPriceCurrent,
      eq(variantPriceCurrent.variantId, productVariants.id)
    )
    .leftJoin(
      variantPriceRevisions,
      and(
        eq(variantPriceRevisions.id, variantPriceCurrent.revisionId),
        eq(variantPriceRevisions.variantId, variantPriceCurrent.variantId)
      )
    )
    .where(and(inArray(productVariants.productId, ids), sellableVariantSql()));
  type DisplayPrice = {
    effective: bigint;
    source: bigint;
    active: boolean;
    variantId: string;
  };
  const displayByProduct = new Map<string, DisplayPrice>();
  for (const row of variantRows) {
    const projection = projectRow({
      variantId: row.id,
      sourceUnitPrice: row.price,
      storedTargetUnitPrice: row.targetUnitPrice,
      markdownRevisionId:
        row.revisionVariantId === null ? null : row.markdownRevisionId,
    });
    const candidate: DisplayPrice = {
      effective: BigInt(projection.effectiveUnitPrice),
      source: BigInt(projection.sourceUnitPrice),
      active: projection.markdownActive,
      variantId: row.id,
    };
    const current = displayByProduct.get(row.productId);
    if (
      !current ||
      candidate.effective < current.effective ||
      (candidate.effective === current.effective &&
        candidate.variantId < current.variantId)
    ) {
      displayByProduct.set(row.productId, candidate);
    }
  }

  return rows.map((r) => {
    const variant = variantMap.get(r.id);
    const display = displayByProduct.get(r.id);
    return {
      id: r.id,
      name: r.name,
      slug: r.slug,
      price: display ? display.effective.toString() : (r.price ?? r.basePrice),
      sourcePrice: display ? display.source.toString() : (r.price ?? r.basePrice),
      markdownActive: display?.active ?? false,
      basePrice: r.basePrice,
      // Prefer product-level thumbnail (Jubelio CDN); fall back to variant image.
      image: r.thumbnail ?? (variant ? imageMap.get(variant.id) ?? null : null),
      collection: r.collection,
      gender: r.gender,
    };
  });
}

/** HTTP adapter: section homepage aktif + produk terpilih, map ke status/body existing. */
async function getHomepage(): Promise<Response> {
  try {
    const sections = await db
      .select()
      .from(homepageSections)
      .where(eq(homepageSections.isActive, true))
      .orderBy(asc(homepageSections.displayOrder));

    if (sections.length === 0) {
      log.info("homepage loaded: 0 section");
      return NextResponse.json({ success: true, data: [] });
    }

    const storeBannerSectionIds = sections
      .filter((s) => s.type === "store_banner")
      .map((s) => s.id);

    // Manual-mode carousels: collect junction rows.
    const productSectionsMap = new Map<
      string,
      { productId: string; displayOrder: number }[]
    >();

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

    const productMap = new Map<string, ProductRow>();
    const genderNameMap = new Map<string, string>();
    if (allProductIds.length > 0) {
      const productRows = await db
        .select()
        .from(products)
        .where(and(inArray(products.id, allProductIds), eq(products.status, "aktif"), sellableProductSql()));
      for (const p of productRows) productMap.set(p.id, p);

      // Fetch all variants for these products with their Markdown projection to
      // compute the cheapest EFFECTIVE price + its own source per product. Image
      // still comes from the default variant.
      const allVariants = await db
        .select({
          id: productVariants.id,
          productId: productVariants.productId,
          price: productVariants.price,
          isDefault: productVariants.isDefault,
          targetUnitPrice: variantPriceRevisions.targetUnitPrice,
          markdownRevisionId: variantPriceRevisions.id,
          revisionVariantId: variantPriceRevisions.variantId,
        })
        .from(productVariants)
        .leftJoin(
          variantPriceCurrent,
          eq(variantPriceCurrent.variantId, productVariants.id)
        )
        .leftJoin(
          variantPriceRevisions,
          and(
            eq(variantPriceRevisions.id, variantPriceCurrent.revisionId),
            eq(variantPriceRevisions.variantId, variantPriceCurrent.variantId)
          )
        )
        .where(and(inArray(productVariants.productId, allProductIds), sellableVariantSql()))
        .orderBy(asc(productVariants.id));

      type DisplayPrice = { effective: string; source: string; active: boolean };
      const minPriceMap = new Map<string, DisplayPrice>();
      const defaultVariantMap = new Map<string, (typeof allVariants)[number]>();
      for (const v of allVariants) {
        const projection = projectRow({
          variantId: v.id,
          sourceUnitPrice: v.price,
          storedTargetUnitPrice: v.targetUnitPrice,
          markdownRevisionId:
            v.revisionVariantId === null ? null : v.markdownRevisionId,
        });
        const candidate: DisplayPrice = {
          effective: projection.effectiveUnitPrice,
          source: projection.sourceUnitPrice,
          active: projection.markdownActive,
        };
        const cur = minPriceMap.get(v.productId);
        if (
          cur === undefined ||
          BigInt(candidate.effective) < BigInt(cur.effective)
        ) {
          minPriceMap.set(v.productId, candidate);
        }
        if (v.isDefault) defaultVariantMap.set(v.productId, v);
      }

      const variantIds = [...defaultVariantMap.values()].map((v) => v.id);
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

      for (const p of productRows) {
        const variant = defaultVariantMap.get(p.id);
        // Prefer the product-level thumbnail (Jubelio CDN); fall back to the
        // default variant's first variant-level image for legacy products.
        (p as unknown as { _image?: string | null })._image =
          p.thumbnail ?? (variant ? imageMap.get(variant.id) ?? null : null);
        const display = minPriceMap.get(p.id);
        (p as unknown as { _price?: string })._price =
          display?.effective ?? p.basePrice;
        (p as unknown as { _sourcePrice?: string })._sourcePrice =
          display?.source ?? p.basePrice;
        (p as unknown as { _markdownActive?: boolean })._markdownActive =
          display?.active ?? false;
      }

      // Resolve gender names for the manual-mode products (productRow only has
      // genderId; the card needs the display name). genderId is nullable.
      const genderIds = [
        ...new Set(
          productRows.map((p) => p.genderId).filter((g): g is string => !!g)
        ),
      ];
      if (genderIds.length > 0) {
        const genderRows = await db
          .select({ id: genders.id, name: genders.name })
          .from(genders)
          .where(inArray(genders.id, genderIds));
        for (const g of genderRows) genderNameMap.set(g.id, g.name);
      }
    }

    // Resolve filter-mode carousels in parallel.
    const filterResults = await Promise.all(
      filterCarousels.map(async (c) => ({
        sectionId: c.id,
        items: await resolveFilterModeProducts(c.content.filter ?? {}, c.content.limit ?? 10),
      }))
    );
    const filterResultsMap = new Map(filterResults.map((r) => [r.sectionId, r.items]));

    const branchRows = storeBannerSectionIds.length
      ? await db
          .select()
          .from(branches)
          .where(eq(branches.status, "aktif"))
          .orderBy(asc(branches.name))
      : [];

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
              sourcePrice: p.sourcePrice,
              markdownActive: p.markdownActive,
              basePrice: p.basePrice,
              image: p.image,
              collection: p.collection,
              gender: p.gender,
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
            const sourcePrice =
              (p as unknown as { _sourcePrice?: string })._sourcePrice ?? price;
            const markdownActive =
              (p as unknown as { _markdownActive?: boolean })._markdownActive ?? false;
            return {
              id: p.id,
              name: p.name,
              slug: p.slug,
              price: price,
              sourcePrice,
              markdownActive,
              basePrice: p.basePrice,
              image: img,
              collection: p.collection,
              gender: p.genderId ? genderNameMap.get(p.genderId) ?? null : null,
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

    log.info(`homepage loaded: ${data.length} section`);
    return NextResponse.json({ success: true, data });
  } catch {
    log.error("homepage load failed", new RouteLogError("homepage load failed"));
    return NextResponse.json(
      { success: false, error: "Failed to fetch homepage sections" },
      { status: 500 }
    );
  }
}

/** HTTP entry: wrapper menambahkan `x-request-id` kanonik + satu baris completion. */
export const GET = withRequestContext(getHomepage, "homepage");
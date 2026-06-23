import { NextResponse } from "next/server";
import { db } from "@/db";
import {
  homepageSections,
  homepageSectionProducts,
  products,
  productVariants,
  productImages,
  branches,
} from "@/db";
import { eq, and, asc, inArray } from "drizzle-orm";

export async function GET() {
  try {
    const sections = await db
      .select()
      .from(homepageSections)
      .where(eq(homepageSections.isActive, true))
      .orderBy(asc(homepageSections.displayOrder));

    if (sections.length === 0) {
      return NextResponse.json({ success: true, data: [] });
    }

    const carouselSectionIds = sections
      .filter((s) => s.type === "carousel_product")
      .map((s) => s.id);

    const storeBannerSectionIds = sections
      .filter((s) => s.type === "store_banner")
      .map((s) => s.id);

    const productSectionsMap = new Map<
      string,
      { productId: string; displayOrder: number }[]
    >();

    if (carouselSectionIds.length > 0) {
      const junctionRows = await db
        .select()
        .from(homepageSectionProducts)
        .where(inArray(homepageSectionProducts.sectionId, carouselSectionIds))
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

    const productMap = new Map<string, (typeof products)["$inferSelect"]>();
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
        (p as unknown as { _price?: string })._price =
          variant?.price ?? p.basePrice;
      }
    }

    const branchRows = storeBannerSectionIds.length
      ? await db
          .select()
          .from(branches)
          .where(eq(branches.status, "aktif"))
          .orderBy(asc(branches.name))
      : [];

    const data = sections.map((section) => {
      if (section.type === "carousel_product") {
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
    console.error("Error fetching homepage sections:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch homepage sections" },
      { status: 500 }
    );
  }
}
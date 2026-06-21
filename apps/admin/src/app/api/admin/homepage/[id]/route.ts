import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  homepageSections,
  homepageSectionProducts,
  products,
} from "@/db";
import { eq, asc, inArray } from "drizzle-orm";
import { z } from "zod";
import { withAuth } from "@/lib/auth-guard";

export const GET = withAuth(
  async (_ctx, _request: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
    try {
      const { id } = await ctx.params;

      const sectionRows = await db
        .select()
        .from(homepageSections)
        .where(eq(homepageSections.id, id))
        .limit(1);

      if (sectionRows.length === 0) {
        return NextResponse.json(
          { success: false, error: "Section not found" },
          { status: 404 }
        );
      }

      const section = sectionRows[0];
      let linkedProducts: {
        id: string;
        name: string;
        slug: string;
        displayOrder: number;
      }[] = [];

      if (section.type === "carousel_product") {
        const junctionRows = await db
          .select()
          .from(homepageSectionProducts)
          .where(eq(homepageSectionProducts.sectionId, id))
          .orderBy(asc(homepageSectionProducts.displayOrder));

        const productIds = junctionRows.map((r) => r.productId);
        if (productIds.length > 0) {
          const productRows = await db
            .select({
              id: products.id,
              name: products.name,
              slug: products.slug,
            })
            .from(products)
            .where(inArray(products.id, productIds));
          const map = new Map(productRows.map((p) => [p.id, p]));
          linkedProducts = junctionRows.map((r) => ({
            id: r.productId,
            name: map.get(r.productId)?.name ?? "",
            slug: map.get(r.productId)?.slug ?? "",
            displayOrder: r.displayOrder,
          }));
        }
      }

      return NextResponse.json({
        success: true,
        data: { ...section, products: linkedProducts },
      });
    } catch (error) {
      console.error("Error fetching homepage section:", error);
      return NextResponse.json(
        { success: false, error: "Failed to fetch section" },
        { status: 500 }
      );
    }
  },
  ["hq"]
);

const updateSectionSchema = z.object({
  type: z
    .enum([
      "banner",
      "carousel_product",
      "promo_cards",
      "announcement_bar",
      "store_banner",
    ])
    .optional(),
  title: z.string().nullable().optional(),
  subtitle: z.string().nullable().optional(),
  content: z.record(z.string(), z.unknown()).optional(),
  isActive: z.boolean().optional(),
  displayOrder: z.number().optional(),
  productIds: z.array(z.string()).optional(),
});

export const PATCH = withAuth(
  async (_ctx, request: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
    try {
      const { id } = await ctx.params;

      const existing = await db
        .select()
        .from(homepageSections)
        .where(eq(homepageSections.id, id))
        .limit(1);

      if (existing.length === 0) {
        return NextResponse.json(
          { success: false, error: "Section not found" },
          { status: 404 }
        );
      }

      const body = await request.json();
      const parsed = updateSectionSchema.safeParse(body);

      if (!parsed.success) {
        return NextResponse.json(
          {
            success: false,
            error: "Invalid request body",
            details: parsed.error,
          },
          { status: 400 }
        );
      }

      const data = parsed.data;
      const { productIds, ...fieldsToUpdate } = data;

      const updateData: Record<string, unknown> = {
        updatedAt: new Date(),
      };
      if (fieldsToUpdate.type !== undefined) updateData.type = fieldsToUpdate.type;
      if (fieldsToUpdate.title !== undefined) updateData.title = fieldsToUpdate.title;
      if (fieldsToUpdate.subtitle !== undefined)
        updateData.subtitle = fieldsToUpdate.subtitle;
      if (fieldsToUpdate.content !== undefined)
        updateData.content = fieldsToUpdate.content;
      if (fieldsToUpdate.isActive !== undefined)
        updateData.isActive = fieldsToUpdate.isActive;
      if (fieldsToUpdate.displayOrder !== undefined)
        updateData.displayOrder = fieldsToUpdate.displayOrder;

      await db
        .update(homepageSections)
        .set(updateData)
        .where(eq(homepageSections.id, id));

      if (
        existing[0].type === "carousel_product" ||
        fieldsToUpdate.type === "carousel_product"
      ) {
        if (productIds !== undefined) {
          await db
            .delete(homepageSectionProducts)
            .where(eq(homepageSectionProducts.sectionId, id));
          for (let i = 0; i < productIds.length; i++) {
            await db.insert(homepageSectionProducts).values({
              sectionId: id,
              productId: productIds[i],
              displayOrder: i + 1,
            });
          }
        }
      }

      return NextResponse.json({ success: true });
    } catch (error) {
      console.error("Error updating homepage section:", error);
      return NextResponse.json(
        { success: false, error: "Failed to update section" },
        { status: 500 }
      );
    }
  },
  ["hq"]
);

export const DELETE = withAuth(
  async (_ctx, _request: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
    try {
      const { id } = await ctx.params;

      const existing = await db
        .select()
        .from(homepageSections)
        .where(eq(homepageSections.id, id))
        .limit(1);

      if (existing.length === 0) {
        return NextResponse.json(
          { success: false, error: "Section not found" },
          { status: 404 }
        );
      }

      await db.delete(homepageSections).where(eq(homepageSections.id, id));

      return NextResponse.json({ success: true });
    } catch (error) {
      console.error("Error deleting homepage section:", error);
      return NextResponse.json(
        { success: false, error: "Failed to delete section" },
        { status: 500 }
      );
    }
  },
  ["hq"]
);
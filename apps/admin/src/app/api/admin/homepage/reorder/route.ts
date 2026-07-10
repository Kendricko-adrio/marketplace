import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { homepageSections } from "@/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { withPermission } from "@/lib/auth-guard";

const reorderSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      displayOrder: z.number(),
    })
  ),
});

export const PATCH = withPermission(async (_ctx, request: NextRequest) => {
  try {
    const body = await request.json();
    const parsed = reorderSchema.safeParse(body);

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

    const { items } = parsed.data;

    for (const item of items) {
      await db
        .update(homepageSections)
        .set({ displayOrder: item.displayOrder, updatedAt: new Date() })
        .where(eq(homepageSections.id, item.id));
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error reordering homepage sections:", error);
    return NextResponse.json(
      { success: false, error: "Failed to reorder sections" },
      { status: 500 }
    );
  }
}, "homepage", "edit");
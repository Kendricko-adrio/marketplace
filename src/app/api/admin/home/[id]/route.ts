import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { homepageSections } from "@/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { withAuth } from "@/lib/auth-guard";

export const GET = withAuth(async (_ctx, _request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const { id } = await params;
    const section = await db
      .select()
      .from(homepageSections)
      .where(eq(homepageSections.id, id))
      .limit(1);

    if (!section[0]) {
      return NextResponse.json(
        { success: false, error: "Section not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data: section[0] });
  } catch (error) {
    console.error("Error fetching section:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch section" },
      { status: 500 }
    );
  }
}, ["admin", "staff"]);

const updateSectionSchema = z.object({
  title: z.string().min(1).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  isActive: z.boolean().optional(),
});

export const PUT = withAuth(async (_ctx, request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const { id } = await params;
    const body = await request.json();
    const parsed = updateSectionSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid request body", details: parsed.error },
        { status: 400 }
      );
    }

    const updateData: Partial<typeof homepageSections.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (parsed.data.title !== undefined) updateData.title = parsed.data.title;
    if (parsed.data.config !== undefined) updateData.config = parsed.data.config;
    if (parsed.data.isActive !== undefined) updateData.isActive = parsed.data.isActive;

    await db
      .update(homepageSections)
      .set(updateData)
      .where(eq(homepageSections.id, id));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error updating section:", error);
    return NextResponse.json(
      { success: false, error: "Failed to update section" },
      { status: 500 }
    );
  }
}, ["admin", "staff"]);

export const DELETE = withAuth(async (_ctx, _request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const { id } = await params;
    await db.delete(homepageSections).where(eq(homepageSections.id, id));
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting section:", error);
    return NextResponse.json(
      { success: false, error: "Failed to delete section" },
      { status: 500 }
    );
  }
}, ["admin", "staff"]);

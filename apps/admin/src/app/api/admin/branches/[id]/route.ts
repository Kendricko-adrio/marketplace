import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { branches } from "@/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { withPermission } from "@/lib/auth-guard";

export const GET = withPermission(
  async (_ctx, request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    try {
      const { id } = await params;

      const branch = await db
        .select()
        .from(branches)
        .where(eq(branches.id, id))
        .limit(1);

      if (branch.length === 0) {
        return NextResponse.json(
          { success: false, error: "Branch not found" },
          { status: 404 }
        );
      }

      return NextResponse.json({
        success: true,
        data: branch[0],
      });
    } catch (error) {
      console.error("Error fetching branch:", error);
      return NextResponse.json(
        { success: false, error: "Failed to fetch branch" },
        { status: 500 }
      );
    }
  },
  "branches",
  "view"
);

const dayHoursSchema = z
  .object({
    open: z.string(),
    close: z.string(),
  })
  .nullable();

const updateBranchSchema = z.object({
  name: z.string().min(1),
  code: z.string().min(1),
  city: z.string().min(1),
  address: z.string().min(1),
  latitude: z.string().optional(),
  longitude: z.string().optional(),
  operatingHours: z.object({
    monday: dayHoursSchema.optional(),
    tuesday: dayHoursSchema.optional(),
    wednesday: dayHoursSchema.optional(),
    thursday: dayHoursSchema.optional(),
    friday: dayHoursSchema.optional(),
    saturday: dayHoursSchema.optional(),
    sunday: dayHoursSchema.optional(),
  }),
  googleMapsUrl: z.string().url().optional().or(z.literal("")),
  status: z.enum(["aktif", "nonaktif"]),
});

export const PUT = withPermission(
  async (_ctx, request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    try {
      const { id } = await params;

      const existing = await db
        .select()
        .from(branches)
        .where(eq(branches.id, id))
        .limit(1);

      if (existing.length === 0) {
        return NextResponse.json(
          { success: false, error: "Branch not found" },
          { status: 404 }
        );
      }

      const body = await request.json();
      const parsed = updateBranchSchema.safeParse(body);

      if (!parsed.success) {
        return NextResponse.json(
          { success: false, error: "Invalid request body", details: parsed.error },
          { status: 400 }
        );
      }

      const data = parsed.data;

      await db
        .update(branches)
        .set({
          name: data.name,
          code: data.code,
          city: data.city,
          address: data.address,
          latitude: data.latitude || null,
          longitude: data.longitude || null,
          operatingHours: data.operatingHours,
          googleMapsUrl: data.googleMapsUrl || null,
          status: data.status,
          updatedAt: new Date(),
        })
        .where(eq(branches.id, id));

      return NextResponse.json({ success: true, data: { id } });
    } catch (error) {
      console.error("Error updating branch:", error);
      return NextResponse.json(
        { success: false, error: "Failed to update branch" },
        { status: 500 }
      );
    }
  },
  "branches",
  "edit"
);

export const DELETE = withPermission(
  async (_ctx, request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    try {
      const { id } = await params;

      const existing = await db
        .select()
        .from(branches)
        .where(eq(branches.id, id))
        .limit(1);

      if (existing.length === 0) {
        return NextResponse.json(
          { success: false, error: "Branch not found" },
          { status: 404 }
        );
      }

      await db.delete(branches).where(eq(branches.id, id));

      return NextResponse.json({ success: true });
    } catch (error) {
      console.error("Error deleting branch:", error);
      return NextResponse.json(
        { success: false, error: "Failed to delete branch" },
        { status: 500 }
      );
    }
  },
  "branches",
  "delete"
);
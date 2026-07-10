import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { branches } from "@/db";
import { desc, sql } from "drizzle-orm";
import { z } from "zod";
import { withPermission } from "@/lib/auth-guard";

export const GET = withPermission(async (_ctx, request: NextRequest) => {
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "20");
    const offset = (page - 1) * limit;

    const allBranches = await db
      .select()
      .from(branches)
      .orderBy(desc(branches.createdAt))
      .limit(limit)
      .offset(offset);

    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(branches);
    const total = Number(countResult[0]?.count || 0);

    return NextResponse.json({
      success: true,
      data: allBranches,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Error fetching admin branches:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch branches" },
      { status: 500 }
    );
  }
}, "branches", "view");

const dayHoursSchema = z
  .object({
    open: z.string(),
    close: z.string(),
  })
  .nullable();

const createBranchSchema = z.object({
  name: z.string().min(1),
  code: z.string().min(1),
  city: z.string().min(1),
  address: z.string().min(1),
  latitude: z.string().optional(),
  longitude: z.string().optional(),
  operatingHours: z
    .object({
      monday: dayHoursSchema.optional(),
      tuesday: dayHoursSchema.optional(),
      wednesday: dayHoursSchema.optional(),
      thursday: dayHoursSchema.optional(),
      friday: dayHoursSchema.optional(),
      saturday: dayHoursSchema.optional(),
      sunday: dayHoursSchema.optional(),
    })
    .default({}),
  googleMapsUrl: z.string().url().optional().or(z.literal("")),
  status: z.enum(["aktif", "nonaktif"]).default("aktif"),
});

export const POST = withPermission(async (_ctx, request: NextRequest) => {
  try {
    const body = await request.json();
    const parsed = createBranchSchema.safeParse(body);

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
    const branchId = crypto.randomUUID();

    await db.insert(branches).values({
      id: branchId,
      name: data.name,
      code: data.code,
      city: data.city,
      address: data.address,
      latitude: data.latitude || null,
      longitude: data.longitude || null,
      operatingHours: data.operatingHours,
      googleMapsUrl: data.googleMapsUrl || null,
      status: data.status,
    });

    return NextResponse.json({
      success: true,
      data: { id: branchId },
    });
  } catch (error) {
    console.error("Error creating branch:", error);
    return NextResponse.json(
      { success: false, error: "Failed to create branch" },
      { status: 500 }
    );
  }
}, "branches", "edit");
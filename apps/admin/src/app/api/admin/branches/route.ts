import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { branches } from "@/db";
import { desc, sql, eq } from "drizzle-orm";
import { z } from "zod";
import { guard } from "@/lib/rbac/guard";
import { branchScopeFromAuthorization } from "@/lib/rbac/branch-scope";
import { createBranch, BranchServiceError } from "@/lib/branches-service";
import { serializeError } from "@/lib/logger";
import { parsePagination } from "@/lib/pagination";
// GET /api/admin/branches   [branches:view]
//
// Own-branch view reaches only the Home Branch; all-branch view lists every
// Branch. The SQL `where` is the real access control.
export async function GET(request: NextRequest) {
  const guardResult = await guard("branches", "view", { request });
  if (!guardResult.ok) return guardResult.response;
  const { logger, ctx } = guardResult;

  try {
    const scope = branchScopeFromAuthorization(ctx.authorization);
    if (!scope) {
      logger.warn("branches.list.scope_unresolvable", {
        outcome: "denied",
        reason: "missing_home_branch",
        userId: ctx.user.id,
      });
      return NextResponse.json(
        { success: false, error: "Forbidden", code: "DENIED" },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const { page, limit } = parsePagination(
      searchParams.get("page"),
      searchParams.get("limit")
    );
    const offset = (page - 1) * limit;

    // Own-branch scope: the Home Branch is the only visible row.
    const whereCondition =
      scope.mode === "own" ? eq(branches.id, scope.branchId) : undefined;

    const allBranches = await db
      .select()
      .from(branches)
      .where(whereCondition)
      .orderBy(desc(branches.createdAt))
      .limit(limit)
      .offset(offset);

    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(branches)
      .where(whereCondition);
    const total = Number(countResult[0]?.count || 0);

    logger.info("branches.list", {
      outcome: "success",
      total,
      page,
      scope: scope.mode,
    });
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
    logger.error("branches.list.failure", {
      outcome: "error",
      error: serializeError(error),
    });
    return NextResponse.json(
      { success: false, error: "Failed to fetch branches" },
      { status: 500 }
    );
  }
}

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

// POST /api/admin/branches   [branches:edit:all]
//
// Creating a Branch is an explicit all-branch operation: own-branch edit
// cannot create a Branch (403), matching the catalog (edit: own/all,
// create requires edit-all).
export async function POST(request: NextRequest) {
  const guardResult = await guard("branches", "edit", {
    request,
    requiredScope: "all_branches",
  });
  if (!guardResult.ok) return guardResult.response;
  const { logger, ctx } = guardResult;

  try {
    const body = await request.json();
    const parsed = createBranchSchema.safeParse(body);

    if (!parsed.success) {
      logger.warn("branches.create.invalid_input", {
        outcome: "denied",
        issues: parsed.error.issues,
      });
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

    // Mutation + audit run in one local DB transaction (branches-service);
    // a failed audit write aborts the insert and vice versa.
    let created;
    try {
      created = await createBranch(
        {
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
        },
        { actorId: ctx.user.id, policyVersion: ctx.policy.policyVersion }
      );
    } catch (error) {
      if (error instanceof BranchServiceError) {
        // Currently unreachable for create (no typed pre-checks), but the
        // mapping is kept exhaustive so the contract stays stable.
        logger.error("branches.create.service_error", {
          outcome: "error",
          code: error.code,
          branchId,
          error: serializeError(error),
        });
      } else {
        logger.error("branches.create.db_failure", {
          outcome: "error",
          branchId,
          error: serializeError(error),
        });
      }
      return NextResponse.json(
        { success: false, error: "Failed to create branch" },
        { status: 500 }
      );
    }

    logger.info("branches.create", {
      outcome: "success",
      branchId,
    });
    // Created resources return 201 with the created row (same contract as
    // the Roles/Users POST endpoints).
    return NextResponse.json({ success: true, data: created }, { status: 201 });
  } catch (error) {
    logger.error("branches.create.failure", {
      outcome: "error",
      error: serializeError(error),
    });
    return NextResponse.json(
      { success: false, error: "Failed to create branch" },
      { status: 500 }
    );
  }
}
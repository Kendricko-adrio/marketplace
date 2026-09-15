import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { branches, users } from "@/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { guard, crossBranchNotFound } from "@/lib/rbac/guard";
import { branchScopeFromAuthorization } from "@/lib/rbac/branch-scope";
import {
  BranchServiceError,
  deleteBranch,
  updateBranch,
} from "@/lib/branches-service";
import { serializeError } from "@/lib/logger";

// GET /api/admin/branches/[id]   [branches:view]
//
// Own-branch view reaches only the Home Branch; another Branch id maps to
// 404 so existence is not disclosed. All-branch view is unrestricted.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guardResult = await guard("branches", "view", { request });
  if (!guardResult.ok) return guardResult.response;
  const { logger, ctx } = guardResult;

  try {
    const { id } = await params;
    const branchLog = logger.child({ branchId: id });

    const scope = branchScopeFromAuthorization(ctx.authorization);
    if (!scope) {
      branchLog.warn("branches.detail.scope_unresolvable", {
        outcome: "denied",
        reason: "missing_home_branch",
        userId: ctx.user.id,
      });
      return NextResponse.json(
        { success: false, error: "Forbidden", code: "DENIED" },
        { status: 403 }
      );
    }

    const branch = await db
      .select()
      .from(branches)
      .where(eq(branches.id, id))
      .limit(1);

    if (branch.length === 0) {
      crossBranchNotFound(branchLog);
      return NextResponse.json(
        { success: false, error: "Branch not found" },
        { status: 404 }
      );
    }

    if (scope.mode === "own" && branch[0].id !== scope.branchId) {
      crossBranchNotFound(branchLog);
      return NextResponse.json(
        { success: false, error: "Branch not found" },
        { status: 404 }
      );
    }

    branchLog.info("branches.detail", {
      outcome: "success",
      scope: scope.mode,
    });
    return NextResponse.json({
      success: true,
      data: branch[0],
    });
  } catch (error) {
    logger.error("branches.detail.failure", {
      outcome: "error",
      error: serializeError(error),
    });
    return NextResponse.json(
      { success: false, error: "Failed to fetch branch" },
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

// PUT /api/admin/branches/[id]   [branches:edit]
//
// Own-branch edit reaches only the Home Branch; another Branch id maps to
// 404. All-branch edit may edit any Branch.
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guardResult = await guard("branches", "edit", { request });
  if (!guardResult.ok) return guardResult.response;
  const { logger, ctx } = guardResult;

  try {
    const { id } = await params;
    const branchLog = logger.child({ branchId: id });

    const scope = branchScopeFromAuthorization(ctx.authorization);
    if (!scope) {
      branchLog.warn("branches.update.scope_unresolvable", {
        outcome: "denied",
        reason: "missing_home_branch",
        userId: ctx.user.id,
      });
      return NextResponse.json(
        { success: false, error: "Forbidden", code: "DENIED" },
        { status: 403 }
      );
    }

    const existing = await db
      .select()
      .from(branches)
      .where(eq(branches.id, id))
      .limit(1);

    if (
      existing.length === 0 ||
      (scope.mode === "own" && existing[0].id !== scope.branchId)
    ) {
      crossBranchNotFound(branchLog);
      return NextResponse.json(
        { success: false, error: "Branch not found" },
        { status: 404 }
      );
    }

    const body = await request.json();
    const parsed = updateBranchSchema.safeParse(body);

    if (!parsed.success) {
      branchLog.warn("branches.update.invalid_input", {
        outcome: "denied",
        issues: parsed.error.issues,
      });
      return NextResponse.json(
        { success: false, error: "Invalid request body", details: parsed.error },
        { status: 400 }
      );
    }

    const data = parsed.data;

    // Mutation + audit run in one local DB transaction (branches-service).
    // The branch row is locked and its existence re-checked inside the tx;
    // a NOT_FOUND from the recheck maps to the same 404 as the pre-check.
    try {
      await updateBranch(
        id,
        {
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
      if (error instanceof BranchServiceError && error.code === "NOT_FOUND") {
        branchLog.warn("branches.update.vanished_mid_request", {
          outcome: "denied",
          reason: "branch_deleted_concurrently",
        });
        return NextResponse.json(
          { success: false, error: "Branch not found" },
          { status: 404 }
        );
    }
      branchLog.error("branches.update.db_failure", {
        outcome: "error",
        error: serializeError(error),
      });
      return NextResponse.json(
        { success: false, error: "Failed to update branch" },
        { status: 500 }
      );
    }

    branchLog.info("branches.update", {
      outcome: "success",
      scope: scope.mode,
    });
    return NextResponse.json({ success: true, data: { id } });
  } catch (error) {
    logger.error("branches.update.failure", {
      outcome: "error",
      error: serializeError(error),
    });
    return NextResponse.json(
      { success: false, error: "Failed to update branch" },
      { status: 500 }
    );
  }
}

// DELETE /api/admin/branches/[id]   [branches:delete:all]
//
// Deleting a Branch is an all-branch operation. A Branch cannot be deleted
// while it remains the Home Branch of any active OR inactive Admin User
// (409 BRANCH_IN_USE). The existence check and the BRANCH_IN_USE re-check
// run INSIDE the delete transaction (branches-service): the branch row is
// locked FOR UPDATE so a concurrent admin assignment cannot slip in between
// check and delete.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guardResult = await guard("branches", "delete", {
    request,
    requiredScope: "all_branches",
  });
  if (!guardResult.ok) return guardResult.response;
  const { logger, ctx } = guardResult;

  try {
    const { id } = await params;
    const branchLog = logger.child({ branchId: id });

    try {
      await deleteBranch(id, {
        actorId: ctx.user.id,
        policyVersion: ctx.policy.policyVersion,
      });
    } catch (error) {
      if (error instanceof BranchServiceError) {
        if (error.code === "NOT_FOUND") {
          crossBranchNotFound(branchLog);
          return NextResponse.json(
            { success: false, error: "Branch not found" },
            { status: 404 }
          );
        }
        // BRANCH_IN_USE — re-checked inside the transaction against the
        // locked branch row.
        branchLog.warn("branches.delete.branch_in_use", {
          outcome: "denied",
          reason: "home_branch_assignment",
        });
        return NextResponse.json(
          {
            success: false,
            error: "Branch masih memiliki admin. Pindahkan admin sebelum menghapus branch.",
            code: "BRANCH_IN_USE",
          },
          { status: 409 }
        );
      }
      branchLog.error("branches.delete.db_failure", {
        outcome: "error",
        error: serializeError(error),
      });
      return NextResponse.json(
        { success: false, error: "Failed to delete branch" },
        { status: 500 }
      );
    }

    branchLog.info("branches.delete", { outcome: "success" });
    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error("branches.delete.failure", {
      outcome: "error",
      error: serializeError(error),
    });
    return NextResponse.json(
      { success: false, error: "Failed to delete branch" },
      { status: 500 }
    );
  }
}
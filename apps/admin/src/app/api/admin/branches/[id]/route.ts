import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { branches } from "@/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { createModuleLogger, withRequestContext } from "@/lib/logger";
import { guard, crossBranchNotFound } from "@/lib/rbac/guard";
import { branchScopeFromAuthorization } from "@/lib/rbac/branch-scope";
import {
  BranchServiceError,
  deleteBranch,
  parseBranchOrigin,
  updateBranch,
} from "@/lib/branches-service";
import { branchRegionSchema, verifyBranchRegion } from "@/lib/shipment-regions";

/**
 * Module logger untuk route ini: dibuat sekali di module scope, sedangkan
 * `requestId` dibaca dari scope HTTP yang aktif setiap kali log ditulis.
 */
const log = createModuleLogger("admin-branch-detail");

/**
 * Proyeksi teknis statis untuk field `error` pada jalur kegagalan tak terduga
 * (bisa memuat SQL/provider text).
 */
class BranchDetailLogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BranchDetailLogError";
  }
}

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/admin/branches/[id]   [branches:view]
//
// Own-branch view reaches only the Home Branch; another Branch id maps to
// 404 so existence is not disclosed. All-branch view is unrestricted.
async function branchDetail(
  _request: NextRequest,
  { params }: RouteContext
): Promise<Response> {
  const guardResult = await guard("branches", "view");
  if (!guardResult.ok) return guardResult.response;
  const { ctx } = guardResult;

  let branchId: string | null = null;
  try {
    const { id } = await params;
    branchId = id;

    const scope = branchScopeFromAuthorization(ctx.authorization);
    if (!scope) {
      log.warn(
        `branches.detail scope tidak dapat ditentukan (userId ${ctx.user.id}, branchId ${id}, reason missing_home_branch, outcome denied)`
      );
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
      crossBranchNotFound();
      return NextResponse.json(
        { success: false, error: "Branch not found" },
        { status: 404 }
      );
    }

    if (scope.mode === "own" && branch[0].id !== scope.branchId) {
      crossBranchNotFound();
      return NextResponse.json(
        { success: false, error: "Branch not found" },
        { status: 404 }
      );
    }

    log.info(
      `branches.detail (branchId ${id}, scope ${scope.mode}, outcome success)`
    );
    return NextResponse.json({
      success: true,
      data: branch[0],
    });
  } catch {
    // Nilai yang tertangkap tidak pernah masuk log: bisa memuat SQL/nilai baris.
    log.error(
      `branches.detail gagal (branchId ${branchId ?? "unknown"}, outcome error)`,
      new BranchDetailLogError("branches detail gagal")
    );
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
  shippingPhone: z.string().nullable().optional(),
  shippingAddress: z.string().nullable().optional(),
  ...branchRegionSchema,
});

// PUT /api/admin/branches/[id]   [branches:edit]
//
// Own-branch edit reaches only the Home Branch; another Branch id maps to
// 404. All-branch edit may edit any Branch.
async function updateBranchRow(
  request: NextRequest,
  { params }: RouteContext
): Promise<Response> {
  const guardResult = await guard("branches", "edit");
  if (!guardResult.ok) return guardResult.response;
  const { ctx } = guardResult;

  let branchId: string | null = null;
  try {
    const { id } = await params;
    branchId = id;

    const scope = branchScopeFromAuthorization(ctx.authorization);
    if (!scope) {
      log.warn(
        `branches.update scope tidak dapat ditentukan (userId ${ctx.user.id}, branchId ${id}, reason missing_home_branch, outcome denied)`
      );
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
      crossBranchNotFound();
      return NextResponse.json(
        { success: false, error: "Branch not found" },
        { status: 404 }
      );
    }

    const body = await request.json();
    const parsed = updateBranchSchema.safeParse(body);

    if (!parsed.success) {
      log.warn(
        `branches.update ditolak: body tidak valid (branchId ${id}, issueCodes ${parsed.error.issues
          .map(({ code }) => code)
          .join(",")}, outcome denied)`
      );
      return NextResponse.json(
        { success: false, error: "Invalid request body", details: parsed.error.issues.map(({ path, code }) => ({ path, code })) },
        { status: 400 }
      );
    }

    const data = parsed.data;

    // Shipping-origin complement (ticket 02): every SUPPLIED value is
    // validated fail-closed as one unit BEFORE any mutation; an invalid
    // origin rejects the edit without touching the branch or the audit log.
    const origin = parseBranchOrigin(data);
    if (!origin.ok) {
      // `origin.error` adalah pesan validasi statis milik branches-service.
      log.error(
        `branches.update ditolak: origin pengiriman tidak valid (branchId ${id}, reason ${origin.error}, outcome denied)`,
        new BranchDetailLogError("branches.update origin tidak valid")
      );
      return NextResponse.json(
        { success: false, error: origin.error },
        { status: 400 }
      );
    }

    let region;
    try {
      region = await verifyBranchRegion(data);
    } catch (error) {
      // Klasifikasi tetap dari penanda internal yang sama seperti sebelumnya;
      // pesan provider tidak pernah masuk log.
      const invalid = error instanceof Error && error.message === "REGION_INPUT_INVALID";
      log.error(
        `branches.update ditolak: wilayah shipment tidak dapat diverifikasi (branchId ${id}, reason ${
          invalid ? "invalid_region" : "provider_unavailable"
        }, outcome denied)`,
        new BranchDetailLogError("branches.update region gagal")
      );
      return NextResponse.json({ success: false, error: invalid ? "Wilayah pengiriman atau kode pos tidak valid" : "Wilayah Shipment tidak tersedia. Silakan coba lagi." }, { status: invalid ? 400 : 503 });
    }

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
          // Omitted fields stay undefined so Drizzle skips them under the
          // service's row lock. Never copy a stale route pre-check value.
          ...origin.origin,
          ...region,
        },
        { actorId: ctx.user.id, policyVersion: ctx.policy.policyVersion }
      );
    } catch (error) {
      if (error instanceof BranchServiceError && error.code === "NOT_FOUND") {
        log.warn(
          `branches.update ditolak: branch hilang di tengah request (branchId ${id}, reason branch_deleted_concurrently, outcome denied)`
        );
        return NextResponse.json(
          { success: false, error: "Branch not found" },
          { status: 404 }
        );
    }
      log.error(
        `branches.update gagal: transaksi DB (branchId ${id}, outcome error)`,
        new BranchDetailLogError("branches.update db_failure")
      );
      return NextResponse.json(
        { success: false, error: "Failed to update branch" },
        { status: 500 }
      );
    }

    log.info(`branches.update (branchId ${id}, scope ${scope.mode}, outcome success)`);
    return NextResponse.json({ success: true, data: { id } });
  } catch {
    // Nilai yang tertangkap tidak pernah masuk log: bisa memuat SQL/provider text.
    log.error(
      `branches.update gagal (branchId ${branchId ?? "unknown"}, outcome error)`,
      new BranchDetailLogError("branches update gagal")
    );
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
async function removeBranch(
  _request: NextRequest,
  { params }: RouteContext
): Promise<Response> {
  const guardResult = await guard("branches", "delete", {
    requiredScope: "all_branches",
  });
  if (!guardResult.ok) return guardResult.response;
  const { ctx } = guardResult;

  let branchId: string | null = null;
  try {
    const { id } = await params;
    branchId = id;

    try {
      await deleteBranch(id, {
        actorId: ctx.user.id,
        policyVersion: ctx.policy.policyVersion,
      });
    } catch (error) {
      if (error instanceof BranchServiceError) {
        if (error.code === "NOT_FOUND") {
          crossBranchNotFound();
          return NextResponse.json(
            { success: false, error: "Branch not found" },
            { status: 404 }
          );
        }
        // BRANCH_IN_USE — re-checked inside the transaction against the
        // locked branch row.
        log.warn(
          `branches.delete ditolak: branch masih menjadi Home Branch admin (branchId ${id}, reason home_branch_assignment, outcome denied)`
        );
        return NextResponse.json(
          {
            success: false,
            error: "Branch masih memiliki admin. Pindahkan admin sebelum menghapus branch.",
            code: "BRANCH_IN_USE",
          },
          { status: 409 }
        );
      }
      log.error(
        `branches.delete gagal: transaksi DB (branchId ${id}, outcome error)`,
        new BranchDetailLogError("branches.delete db_failure")
      );
      return NextResponse.json(
        { success: false, error: "Failed to delete branch" },
        { status: 500 }
      );
    }

    log.info(`branches.delete (branchId ${id}, outcome success)`);
    return NextResponse.json({ success: true });
  } catch {
    // Nilai yang tertangkap tidak pernah masuk log: bisa memuat SQL/provider text.
    log.error(
      `branches.delete gagal (branchId ${branchId ?? "unknown"}, outcome error)`,
      new BranchDetailLogError("branches delete gagal")
    );
    return NextResponse.json(
      { success: false, error: "Failed to delete branch" },
      { status: 500 }
    );
  }
}

export const GET = withRequestContext(branchDetail, "admin-branch-detail");
export const PUT = withRequestContext(updateBranchRow, "admin-branch-detail");
export const DELETE = withRequestContext(removeBranch, "admin-branch-detail");

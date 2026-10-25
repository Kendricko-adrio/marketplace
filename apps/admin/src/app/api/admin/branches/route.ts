import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createModuleLogger, withRequestContext } from "@/lib/logger";
import { guard } from "@/lib/rbac/guard";
import { branchScopeFromAuthorization } from "@/lib/rbac/branch-scope";
import { listBranches } from "@/lib/branches-list";
import { createBranch, parseBranchOrigin, BranchServiceError } from "@/lib/branches-service";
import { parsePagination } from "@/lib/pagination";
import { branchRegionSchema, verifyBranchRegion } from "@/lib/shipment-regions";

/**
 * Module logger untuk route ini: dibuat sekali di module scope, sedangkan
 * `requestId` dibaca dari scope HTTP yang aktif setiap kali log ditulis.
 */
const log = createModuleLogger("admin-branches");

/**
 * Proyeksi teknis statis untuk field `error` pada jalur kegagalan tak terduga
 * (bisa memuat SQL/provider text). Jalur yang expected memakai pesan statis
 * milik module ini, tanpa nilai yang tertangkap.
 */
class BranchesLogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BranchesLogError";
  }
}

// GET /api/admin/branches   [branches:view]
//
// Own-branch view reaches only the Home Branch; all-branch view lists every
// Branch. The SQL `where` is the real access control.
//
// `search` filters SERVER-SIDE (name/code/city, case-insensitive) before the
// page slice, so a match on page 2+ is still found; the pagination totals come
// from the same predicate (see lib/branches-list.ts).
async function listBranchRows(request: NextRequest): Promise<Response> {
  const guardResult = await guard("branches", "view");
  if (!guardResult.ok) return guardResult.response;
  const { ctx } = guardResult;

  try {
    const scope = branchScopeFromAuthorization(ctx.authorization);
    if (!scope) {
      log.warn(
        `branches.list scope tidak dapat ditentukan (userId ${ctx.user.id}, reason missing_home_branch, outcome denied)`
      );
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
    const search = searchParams.get("search")?.trim() ?? "";

    const { rows: allBranches, total } = await listBranches({
      scope,
      search,
      page,
      limit,
    });

    // Istilah pencarian tidak dicatat (input bebas dari klien).
    log.info(
      `branches.list (total ${total}, page ${page}, limit ${limit}, scope ${scope.mode}, hasSearch ${search !== ""}, outcome success)`
    );
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
  } catch {
    // Nilai yang tertangkap tidak pernah masuk log: bisa memuat SQL/nilai baris.
    log.error(
      "branches.list gagal (outcome error)",
      new BranchesLogError("branches list gagal")
    );
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
  shippingPhone: z.string().nullable().optional(),
  shippingAddress: z.string().nullable().optional(),
  ...branchRegionSchema,
});

// POST /api/admin/branches   [branches:edit:all]
//
// Creating a Branch is an explicit all-branch operation: own-branch edit
// cannot create a Branch (403), matching the catalog (edit: own/all,
// create requires edit-all).
async function createBranchRow(request: NextRequest): Promise<Response> {
  const guardResult = await guard("branches", "edit", {
    requiredScope: "all_branches",
  });
  if (!guardResult.ok) return guardResult.response;
  const { ctx } = guardResult;

  let branchId: string | null = null;
  try {
    const body = await request.json();
    const parsed = createBranchSchema.safeParse(body);

    if (!parsed.success) {
      log.warn(
        `branches.create ditolak: body tidak valid (issueCodes ${parsed.error.issues
          .map(({ code }) => code)
          .join(",")}, outcome denied)`
      );
      return NextResponse.json(
        {
          success: false,
          error: "Invalid request body",
          details: parsed.error.issues.map(({ path, code }) => ({ path, code })),
        },
        { status: 400 }
      );
    }

    const data = parsed.data;
    const newBranchId = crypto.randomUUID();
    branchId = newBranchId;

    // Shipping-origin complement (ticket 02): supplied values are validated
    // fail-closed BEFORE any mutation; omitted/empty normalize to NULL — a
    // new branch is never born with invented ready origin data.
    const origin = parseBranchOrigin(data);
    if (!origin.ok) {
      // `origin.error` adalah pesan validasi statis milik branches-service,
      // bukan nilai pengguna yang tertangkap.
      log.error(
        `branches.create ditolak: origin pengiriman tidak valid (branchId ${newBranchId}, reason ${origin.error}, outcome denied)`,
        new BranchesLogError("branches.create origin tidak valid")
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
        `branches.create ditolak: wilayah shipment tidak dapat diverifikasi (branchId ${newBranchId}, reason ${
          invalid ? "invalid_region" : "provider_unavailable"
        }, outcome denied)`,
        new BranchesLogError("branches.create region gagal")
      );
      return NextResponse.json({ success: false, error: invalid ? "Wilayah pengiriman atau kode pos tidak valid" : "Wilayah Shipment tidak tersedia. Silakan coba lagi." }, { status: invalid ? 400 : 503 });
    }

    // Mutation + audit run in one local DB transaction (branches-service);
    // a failed audit write aborts the insert and vice versa.
    let created;
    try {
      created = await createBranch(
        {
          id: newBranchId,
          name: data.name,
          code: data.code,
          city: data.city,
          address: data.address,
          latitude: data.latitude || null,
          longitude: data.longitude || null,
          operatingHours: data.operatingHours,
          googleMapsUrl: data.googleMapsUrl || null,
          status: data.status,
          shippingPhone: origin.origin.shippingPhone ?? null,
          shippingAddress: origin.origin.shippingAddress ?? null,
          ...region,
        },
        { actorId: ctx.user.id, policyVersion: ctx.policy.policyVersion }
      );
    } catch (error) {
      if (error instanceof BranchServiceError) {
        // Currently unreachable for create (no typed pre-checks), but the
        // mapping is kept exhaustive so the contract stays stable.
        log.error(
          `branches.create gagal: service menolak (branchId ${newBranchId}, code ${error.code}, outcome error)`,
          new BranchesLogError("branches.create service error")
        );
      } else {
        log.error(
          `branches.create gagal: transaksi DB (branchId ${newBranchId}, outcome error)`,
          new BranchesLogError("branches.create db_failure")
        );
      }
      return NextResponse.json(
        { success: false, error: "Failed to create branch" },
        { status: 500 }
      );
    }

    log.info(`branches.create (branchId ${newBranchId}, outcome success)`);
    // Created resources return 201 with the created row (same contract as
    // the Roles/Users POST endpoints).
    return NextResponse.json({ success: true, data: created }, { status: 201 });
  } catch {
    // Nilai yang tertangkap tidak pernah masuk log: bisa memuat SQL/provider text.
    log.error(
      `branches.create gagal (branchId ${branchId ?? "unknown"}, outcome error)`,
      new BranchesLogError("branches create gagal")
    );
    return NextResponse.json(
      { success: false, error: "Failed to create branch" },
      { status: 500 }
    );
  }
}

export const GET = withRequestContext(listBranchRows, "admin-branches");
export const POST = withRequestContext(createBranchRow, "admin-branches");

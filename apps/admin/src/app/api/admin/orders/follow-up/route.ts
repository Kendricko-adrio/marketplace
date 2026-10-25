import { NextRequest, NextResponse } from "next/server";
import { guard, crossBranchNotFound } from "@/lib/rbac/guard";
import { branchScopeFromAuthorization } from "@/lib/rbac/branch-scope";
import { createModuleLogger, withRequestContext } from "@/lib/logger";
import {
  createDeliveryFollowUp,
  type FollowUpListKind,
  type FollowUpViewActor,
} from "@/lib/delivery-follow-up";
import { db } from "@/db";
import { listDeliveryWork } from "@/lib/delivery-work-list";
import { DELIVERY_STAGE_LABELS } from "@/lib/delivery-workflow";
import { parsePagination } from "@/lib/pagination";

// GET /api/admin/orders/follow-up?kind=settlement|packing|booking|shipment|all
//   [orders:view + Branch Scope]
//
// The single admin follow-up AREA (ticket 07): the paid-but-blocked
// settlement, the packing failures, the settled ambiguous bookings and the
// RETURNED/SHIPMENT_ISSUE tracked shipments BEFORE the order completes. The
// scope comes from the SERVER-side Current Policy (never the browser) and a
// denied/unresolvable view yields an empty, safe list body (403) — never a
// leak.
const KINDS = new Set<FollowUpListKind>([
  "settlement",
  "packing",
  "booking",
  "shipment",
  "all",
]);

/**
 * Module logger untuk route ini: dibuat sekali di module scope, sedangkan
 * `requestId` dibaca dari scope HTTP yang aktif setiap kali log ditulis
 * (`withRequestContext` di export handler membuka scope tersebut).
 */
const log = createModuleLogger("admin-orders-follow-up");

/**
 * Proyeksi teknis statis untuk field `error`: pesan asli dari DB tidak pernah
 * masuk log, hanya pesan yang ditulis module ini.
 */
class RouteLogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RouteLogError";
  }
}

async function listFollowUp(request: NextRequest): Promise<Response> {
  const guardResult = await guard("orders", "view");
  if (!guardResult.ok) return guardResult.response;
  const { ctx } = guardResult;

  try {
    const authorization = branchScopeFromAuthorization(ctx.authorization);
    if (!authorization) {
      log.warn(
        `follow-up list ditolak: branch scope tidak dapat ditentukan (userId ${ctx.user.id}, outcome denied)`
      );
      return NextResponse.json(
        { success: false, error: "Forbidden", code: "DENIED" },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const requested = (searchParams.get("kind") ?? "all").trim();
    const kind: FollowUpListKind = (KINDS.has(requested as FollowUpListKind)
      ? requested
      : "all") as FollowUpListKind;

    const viewActor: FollowUpViewActor = {
      canViewOrders: true,
      viewScope: authorization.mode === "own" ? "own_branch" : "all",
      homeBranchId: ctx.policy.user.homeBranchId ?? null,
    };

    // A cross-branch/unresolvable scope is presented as not-found rather than
    // disclosed — but for the LIST the scope itself already filters; the
    // policy-mismatch guard mirrors the other scoped routes.
    if (viewActor.viewScope === "own_branch" && !viewActor.homeBranchId) {
      crossBranchNotFound();
      return NextResponse.json(
        { success: false, error: "Order not found" },
        { status: 404 }
      );
    }

    const cases = await createDeliveryFollowUp(db).list(viewActor, kind);
    const stage = searchParams.get("stage");
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    if ((stage && !DELIVERY_STAGE_LABELS.includes(stage)) || [from, to].some((date) => date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date))))) return NextResponse.json({ success: false, error: "Invalid delivery filters" }, { status: 400 });
    const result = await listDeliveryWork(db, {
      scope: authorization, queue: "all", orderIds: cases.map((row) => row.orderId), stage,
      branchId: searchParams.get("branchId"), search: searchParams.get("search"), from, to,
      page: parsePagination(searchParams.get("page"), "20").page,
    });
    const byId = new Map(cases.map((row) => [row.orderId, row]));
    const data = result.data.map((row) => ({ ...byId.get(row.id), stage: row.stage, createdAt: row.createdAt }));
    log.info(
      `follow-up list served (kind ${kind}, rows ${data.length}, page ${result.pagination.page}, total ${result.pagination.total}, outcome success)`
    );
    return NextResponse.json({ success: true, data, pagination: result.pagination });
  } catch {
    log.error(
      "follow-up list gagal (outcome error)",
      new RouteLogError("follow-up list gagal")
    );
    return NextResponse.json(
      { success: false, error: "Gagal memuat daftar tindak lanjut." },
      { status: 500 }
    );
  }
}

/** HTTP entry: wrapper menambahkan `x-request-id` kanonik + satu baris completion. */
export const GET = withRequestContext(listFollowUp, "admin-orders-follow-up");

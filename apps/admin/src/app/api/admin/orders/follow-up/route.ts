import { NextRequest, NextResponse } from "next/server";
import { guard, crossBranchNotFound } from "@/lib/rbac/guard";
import { branchScopeFromAuthorization } from "@/lib/rbac/branch-scope";
import { serializeError, type Logger } from "@/lib/logger";
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

export async function GET(request: NextRequest) {
  const guardResult = await guard("orders", "view", { request });
  if (!guardResult.ok) return guardResult.response;
  const { logger, ctx } = guardResult;
  const listLog: Logger = logger.child({ module: "delivery-follow-up" });

  try {
    const authorization = branchScopeFromAuthorization(ctx.authorization);
    if (!authorization) {
      listLog.warn("follow-up.scope_unresolvable", {
        outcome: "denied",
        userId: ctx.user.id,
      });
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
      crossBranchNotFound(listLog);
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
    listLog.info("follow-up list served", { kind, rows: data.length, ...result.pagination });
    return NextResponse.json({ success: true, data, pagination: result.pagination });
  } catch (error) {
    listLog.error("follow-up list failed", {
      outcome: "error",
      error: serializeError(error),
    });
    return NextResponse.json(
      { success: false, error: "Gagal memuat daftar tindak lanjut." },
      { status: 500 }
    );
  }
}
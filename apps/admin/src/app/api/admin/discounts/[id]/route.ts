import { NextRequest } from "next/server";

import { guard } from "@/lib/rbac/guard";
import { createModuleLogger, withRequestContext } from "@/lib/logger";
import { getDiscountEditorDetail } from "@/features/discounts/discount-configuration-repository";
import {
  discountFailureResponse,
  discountSuccessResponse,
  requireActorId,
} from "@/lib/discounts-http";

// =========================================================
// GET /api/admin/discounts/[id]                          [discounts:view]
// =========================================================
// Editor read model: canonical live projection plus the ONE draft snapshot
// (`draftConfiguration`) that Pengaturan and Kode share. Literal codes are only
// included for an actor holding both discounts:view and discounts:edit; a
// viewer receives masked labels and no code proposals. No provider call, no
// cache.
export const dynamic = "force-dynamic";

const log = createModuleLogger("admin-discount-detail");

type RouteContext = { params: Promise<{ id: string }> };

async function discountDetail(
  _request: NextRequest,
  { params }: RouteContext
): Promise<Response> {
  const guardResult = await guard("discounts", "view");
  if (!guardResult.ok) return guardResult.response;
  const { ctx } = guardResult;

  try {
    const { id } = await params;
    const detail = await getDiscountEditorDetail(id, requireActorId(ctx.user.id));
    log.info(
      `discounts detail (offer ${detail.id}, state ${detail.state}, source ${detail.configurationSource}, version ${detail.version}, draftVersion ${detail.draftVersion}, outcome success)`
    );
    return discountSuccessResponse(detail);
  } catch (error) {
    return discountFailureResponse(error, "discounts detail gagal");
  }
}

export const GET = withRequestContext(discountDetail, "admin-discount-detail");

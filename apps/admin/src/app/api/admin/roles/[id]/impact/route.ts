import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { createModuleLogger, withRequestContext } from "@/lib/logger";
import { guard } from "@/lib/rbac/guard";
import {
  grantSchema,
  invalidBodyResponse,
  internalErrorResponse,
  mapServiceError,
  parseGrants,
} from "@/lib/rbac/roles-http";
import {
  buildActorContext,
  impactPreview,
  type ImpactPreview,
} from "@/lib/rbac/roles-service";

// =========================================================
// POST /api/admin/roles/[id]/impact
// Previews a proposed revision: the grant diff (reductions and widenings)
// and the number of active users currently assigned to the Role.
// [roles:edit]
// =========================================================

export const dynamic = "force-dynamic";

/**
 * Module logger untuk route ini: dibuat sekali di module scope, sedangkan
 * `requestId` dibaca dari scope HTTP yang aktif setiap kali log ditulis
 * (`withRequestContext` di export handler membuka scope tersebut).
 */
const log = createModuleLogger("admin-role-impact");

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

const impactSchema = z.object({
  name: z.string().optional(),
  grants: z.array(grantSchema).optional(),
});

type RouteContext = { params: Promise<{ id: string }> };

async function roleImpact(
  request: NextRequest,
  { params }: RouteContext
): Promise<Response> {
  const guardResult = await guard("roles", "edit");
  if (!guardResult.ok) return guardResult.response;
  const { ctx } = guardResult;

  try {
    const { id } = await params;
    const body = impactSchema.safeParse(await request.json());
    if (!body.success) {
      log.warn(
        `roles impact ditolak: body tidak valid (roleId ${id}, outcome denied)`
      );
      return invalidBodyResponse();
    }

    const actor = buildActorContext(ctx.user.id, ctx.policy);
    const preview: ImpactPreview | null = await impactPreview(
      actor,
      id,
      body.data.grants
        ? { name: body.data.name, grants: parseGrants(body.data.grants) }
        : { name: body.data.name }
    );
    if (!preview) {
      log.warn(
        `roles impact ditolak: role tidak ditemukan (roleId ${id}, outcome denied)`
      );
      return NextResponse.json(
        { success: false, error: "Role not found", code: "NOT_FOUND" },
        { status: 404 }
      );
    }

    log.info(
      `roles impact (roleId ${id}, reduction ${preview.reduction}, affectedActiveUsers ${preview.affectedActiveUsers}, outcome success)`
    );
    return NextResponse.json({ success: true, data: preview });
  } catch (error) {
    const mapped = mapServiceError(error);
    if (mapped) return mapped;
    log.error(
      "roles impact gagal (outcome error)",
      new RouteLogError("roles impact gagal")
    );
    return internalErrorResponse();
  }
}

/** HTTP entry: wrapper menambahkan `x-request-id` kanonik + satu baris completion. */
export const POST = withRequestContext(roleImpact, "admin-role-impact");

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { serializeError } from "@/lib/logger";
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

const impactSchema = z.object({
  name: z.string().optional(),
  grants: z.array(grantSchema).optional(),
});

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(
  request: NextRequest,
  { params }: RouteContext
) {
  const guardResult = await guard("roles", "edit", { request });
  if (!guardResult.ok) return guardResult.response;
  const { logger, ctx } = guardResult;

  try {
    const { id } = await params;
    const body = impactSchema.safeParse(await request.json());
    if (!body.success) {
      logger.warn("roles.impact.invalid_body", {
        outcome: "denied",
        roleId: id,
      });
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
      logger.warn("roles.impact.not_found", {
        outcome: "denied",
        roleId: id,
      });
      return NextResponse.json(
        { success: false, error: "Role not found", code: "NOT_FOUND" },
        { status: 404 }
      );
    }

    logger.info("roles.impact", {
      outcome: "success",
      roleId: id,
      reduction: preview.reduction,
      affectedActiveUsers: preview.affectedActiveUsers,
    });
    return NextResponse.json({ success: true, data: preview });
  } catch (error) {
    const mapped = mapServiceError(error);
    if (mapped) return mapped;
    logger.error("roles.impact.failure", {
      outcome: "error",
      error: serializeError(error),
    });
    return internalErrorResponse();
  }
}
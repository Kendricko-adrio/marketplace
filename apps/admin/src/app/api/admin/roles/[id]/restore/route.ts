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
  roleIdentitySchema,
} from "@/lib/rbac/roles-http";
import {
  buildActorContext,
  getRestoreReview,
  restoreRole,
} from "@/lib/rbac/roles-service";

// =========================================================
// /api/admin/roles/[id]/restore
//   GET  — review draft: identity + retained grants flagged as valid or
//          invalid under the CURRENT catalog                    [roles:view]
//   POST — activate an archived Role after reviewed revalidation [roles:edit]
// =========================================================

export const dynamic = "force-dynamic";

const restoreRoleSchema = roleIdentitySchema.extend({
  grants: z.array(grantSchema),
  // Any integer: a stale/non-positive expectedVersion is a semantic, service-
  // level condition that must surface as 409 STALE_VERSION, not a body error.
  expectedVersion: z.number().int(),
});

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(
  _request: NextRequest,
  { params }: RouteContext
) {
  const guardResult = await guard("roles", "view", {});
  if (!guardResult.ok) return guardResult.response;
  const { logger } = guardResult;

  try {
    const { id } = await params;
    const review = await getRestoreReview(id);
    if (!review) {
      logger.warn("roles.restore_review.not_found", {
        outcome: "denied",
        roleId: id,
      });
      return NextResponse.json(
        {
          success: false,
          error: "Archived Role not found",
          code: "NOT_FOUND",
        },
        { status: 404 }
      );
    }
    logger.info("roles.restore_review", {
      outcome: "success",
      roleId: id,
    });
    return NextResponse.json({ success: true, data: review });
  } catch (error) {
    const mapped = mapServiceError(error);
    if (mapped) return mapped;
    logger.error("roles.restore_review.failure", {
      outcome: "error",
      error: serializeError(error),
    });
    return internalErrorResponse();
  }
}

export async function POST(
  request: NextRequest,
  { params }: RouteContext
) {
  const guardResult = await guard("roles", "edit", { request });
  if (!guardResult.ok) return guardResult.response;
  const { logger, ctx } = guardResult;

  try {
    const { id } = await params;
    const body = restoreRoleSchema.safeParse(await request.json());
    if (!body.success) {
      logger.warn("roles.restore.invalid_body", {
        outcome: "denied",
        roleId: id,
      });
      return invalidBodyResponse();
    }

    const actor = buildActorContext(ctx.user.id, ctx.policy);
    const restored = await restoreRole(actor, id, {
      expectedVersion: body.data.expectedVersion,
      name: body.data.name,
      description: body.data.description ?? null,
      grants: parseGrants(body.data.grants) ?? [],
    });

    logger.info("roles.restore", {
      outcome: "success",
      roleId: id,
      actorId: actor.userId,
      toVersion: restored.version,
      policyVersion: actor.policyVersion,
    });
    return NextResponse.json({ success: true, data: restored });
  } catch (error) {
    const mapped = mapServiceError(error);
    if (mapped) {
      logger.warn("roles.restore.denied", {
        outcome: "denied",
        code: (error as { code?: string }).code,
      });
      return mapped;
    }
    logger.error("roles.restore.failure", {
      outcome: "error",
      error: serializeError(error),
    });
    return internalErrorResponse();
  }
}
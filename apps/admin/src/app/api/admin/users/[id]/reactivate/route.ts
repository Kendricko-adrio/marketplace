import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { serializeError } from "@/lib/logger";
import { guard } from "@/lib/rbac/guard";
import { buildActorContext } from "@/lib/rbac/roles-service";
import { reactivateUser } from "@/lib/rbac/users-service";
import {
  internalErrorResponse,
  mapServiceError,
} from "@/lib/rbac/roles-http";

// =========================================================
// POST /api/admin/users/[id]/reactivate
// Validated reactivation within the actor's Authorization Ceiling: blocks
// when the retained Role is archived/invalid or the required Home Branch is
// missing.  [users:edit]
// =========================================================

export const dynamic = "force-dynamic";

const reactivateSchema = z.strictObject({
  reason: z.string().min(1).nullable().optional(),
});

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(
  request: NextRequest,
  { params }: RouteContext
) {
  const guardResult = await guard("users", "edit", { request });
  if (!guardResult.ok) return guardResult.response;
  const { logger, ctx } = guardResult;

  try {
    const { id } = await params;
    const body = reactivateSchema.safeParse(
      await request.json().catch(() => ({}))
    );
    if (!body.success) {
      logger.warn("users.reactivate.invalid_body", {
        outcome: "denied",
        userId: id,
      });
      return NextResponse.json(
        {
          success: false,
          error: "Invalid request body",
          code: "INVALID_BODY",
        },
        { status: 400 }
      );
    }

    const actor = buildActorContext(ctx.user.id, ctx.policy);
    const reactivated = await reactivateUser(
      actor,
      id,
      body.data.reason ?? null
    );

    logger.info("users.reactivate", {
      outcome: "success",
      actorId: actor.userId,
      userId: id,
      policyVersion: actor.policyVersion,
    });
    return NextResponse.json({ success: true, data: reactivated });
  } catch (error) {
    const mapped = mapServiceError(error);
    if (mapped) {
      logger.warn("users.reactivate.denied", {
        outcome: "denied",
        userId: (await params).id,
        code: (error as { code?: string }).code,
      });
      return mapped;
    }
    logger.error("users.reactivate.failure", {
      outcome: "error",
      error: serializeError(error),
    });
    return internalErrorResponse();
  }
}
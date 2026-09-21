import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { serializeError } from "@/lib/logger";
import { guard } from "@/lib/rbac/guard";
import { buildActorContext } from "@/lib/rbac/roles-service";
import { deactivateUser } from "@/lib/rbac/users-service";
import {
  internalErrorResponse,
  mapServiceError,
} from "@/lib/rbac/roles-http";

// =========================================================
// POST /api/admin/users/[id]/deactivate
// Soft-deactivation (reason required): retains the Role, Home Branch,
// identity, and audit attribution; revokes every existing session in the
// same transaction and blocks future sign-in.  [users:edit]
// =========================================================

export const dynamic = "force-dynamic";

const deactivateSchema = z.strictObject({
  reason: z.string().min(1),
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
    const body = deactivateSchema.safeParse(await request.json());
    if (!body.success) {
      logger.warn("users.deactivate.invalid_body", {
        outcome: "denied",
        userId: id,
      });
      return NextResponse.json(
        {
          success: false,
          error: "A reason is required to deactivate a user",
          code: "REASON_REQUIRED",
        },
        { status: 400 }
      );
    }

    const actor = buildActorContext(ctx.user.id, ctx.policy);
    const deactivated = await deactivateUser(actor, id, body.data.reason);

    logger.info("users.deactivate", {
      outcome: "success",
      actorId: actor.userId,
      userId: id,
      policyVersion: actor.policyVersion,
    });
    return NextResponse.json({ success: true, data: deactivated });
  } catch (error) {
    const mapped = mapServiceError(error);
    if (mapped) {
      logger.warn("users.deactivate.denied", {
        outcome: "denied",
        userId: (await params).id,
        code: (error as { code?: string }).code,
      });
      return mapped;
    }
    logger.error("users.deactivate.failure", {
      outcome: "error",
      error: serializeError(error),
    });
    return internalErrorResponse();
  }
}
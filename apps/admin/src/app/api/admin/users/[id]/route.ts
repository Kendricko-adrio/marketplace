import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { serializeError } from "@/lib/logger";
import { guard } from "@/lib/rbac/guard";
import { buildActorContext } from "@/lib/rbac/roles-service";
import {
  getUserDetail,
  updateUser,
} from "@/lib/rbac/users-service";
import {
  internalErrorResponse,
  mapServiceError,
} from "@/lib/rbac/roles-http";

// =========================================================
// /api/admin/users/[id]
//   GET    — user detail with Role object and activity  [users:view]
//   PUT    — identity/assignment update (strict payload) [users:edit]
//   DELETE — REMOVED: users are soft-deactivated, not hard-deleted.
//            The endpoint answers 405 directing callers to
//            POST /api/admin/users/[id]/deactivate.
// =========================================================

export const dynamic = "force-dynamic";

// z.strictObject rejects unknown keys — a legacy `role` payload fails 400.
const updateUserSchema = z.strictObject({
  name: z.string().min(2).max(100).optional(),
  email: z.email().optional(),
  roleId: z.string().min(1).optional(),
  branchId: z.string().min(1).nullable().optional(),
  reason: z.string().min(1).nullable().optional(),
});

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(
  _request: NextRequest,
  { params }: RouteContext
) {
  const guardResult = await guard("users", "view", {});
  if (!guardResult.ok) return guardResult.response;
  const { logger } = guardResult;

  try {
    const { id } = await params;
    const user = await getUserDetail(id);
    if (!user) {
      logger.warn("users.detail.not_found", {
        outcome: "denied",
        userId: id,
      });
      return NextResponse.json(
        { success: false, error: "User not found", code: "NOT_FOUND" },
        { status: 404 }
      );
    }
    logger.info("users.detail", { outcome: "success", userId: id });
    return NextResponse.json({ success: true, data: user });
  } catch (error) {
    logger.error("users.detail.failure", {
      outcome: "error",
      error: serializeError(error),
    });
    return internalErrorResponse();
  }
}

export async function PUT(
  request: NextRequest,
  { params }: RouteContext
) {
  const guardResult = await guard("users", "edit", { request });
  if (!guardResult.ok) return guardResult.response;
  const { logger, ctx } = guardResult;

  try {
    const { id } = await params;
    const body = updateUserSchema.safeParse(await request.json());
    if (!body.success) {
      logger.warn("users.update.invalid_body", {
        outcome: "denied",
        userId: id,
      });
      return NextResponse.json(
        {
          success: false,
          error: "Invalid request body",
          code: "INVALID_BODY",
          details: body.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    const actor = buildActorContext(ctx.user.id, ctx.policy);
    const updated = await updateUser(actor, id, {
      name: body.data.name,
      email: body.data.email,
      roleId: body.data.roleId,
      branchId: body.data.branchId,
      reason: body.data.reason ?? null,
    });

    logger.info("users.update", {
      outcome: "success",
      actorId: actor.userId,
      userId: id,
      roleId: updated.role?.id ?? null,
      policyVersion: actor.policyVersion,
    });
    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    const mapped = mapServiceError(error);
    if (mapped) {
      logger.warn("users.update.denied", {
        outcome: "denied",
        userId: (await params).id,
        code: (error as { code?: string }).code,
      });
      return mapped;
    }
    logger.error("users.update.failure", {
      outcome: "error",
      error: serializeError(error),
    });
    return internalErrorResponse();
  }
}

/**
 * Users are soft-deactivated, never hard-deleted (audit attribution and
 * identity reservation). The legacy hard DELETE is answered with 405.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: RouteContext
) {
  const { id } = await params;
  return NextResponse.json(
    {
      success: false,
      error:
        "Users are deactivated, not deleted. Use POST /api/admin/users/{id}/deactivate.",
      code: "USER_DEACTIVATE_REQUIRED",
    },
    { status: 405, headers: { Allow: "GET, PUT" } }
  );
}
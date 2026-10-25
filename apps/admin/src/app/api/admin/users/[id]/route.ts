import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { createModuleLogger, withRequestContext } from "@/lib/logger";
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

/**
 * Module logger untuk route ini: dibuat sekali di module scope, sedangkan
 * `requestId` dibaca dari scope HTTP yang aktif setiap kali log ditulis
 * (`withRequestContext` di export handler membuka scope tersebut).
 */
const log = createModuleLogger("admin-user-detail");

/**
 * Proyeksi teknis statis untuk field `error`: pesan asli dari DB/hash library
 * tidak pernah masuk log, hanya pesan yang ditulis module ini.
 */
class RouteLogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RouteLogError";
  }
}

// z.strictObject rejects unknown keys — a legacy `role` payload fails 400.
const updateUserSchema = z.strictObject({
  name: z.string().min(2).max(100).optional(),
  email: z.email().optional(),
  roleId: z.string().min(1).optional(),
  branchId: z.string().min(1).nullable().optional(),
  reason: z.string().min(1).nullable().optional(),
});

type RouteContext = { params: Promise<{ id: string }> };

async function userDetail(
  _request: NextRequest,
  { params }: RouteContext
): Promise<Response> {
  const guardResult = await guard("users", "view");
  if (!guardResult.ok) return guardResult.response;

  try {
    const { id } = await params;
    const user = await getUserDetail(id);
    if (!user) {
      log.warn(
        `users detail ditolak: user tidak ditemukan (userId ${id}, outcome denied)`
      );
      return NextResponse.json(
        { success: false, error: "User not found", code: "NOT_FOUND" },
        { status: 404 }
      );
    }
    log.info(`users detail (userId ${id}, outcome success)`);
    return NextResponse.json({ success: true, data: user });
  } catch {
    log.error(
      "users detail gagal (outcome error)",
      new RouteLogError("users detail gagal")
    );
    return internalErrorResponse();
  }
}

async function updateUserAccount(
  request: NextRequest,
  { params }: RouteContext
): Promise<Response> {
  const guardResult = await guard("users", "edit");
  if (!guardResult.ok) return guardResult.response;
  const { ctx } = guardResult;

  let userId: string | null = null;
  try {
    const { id } = await params;
    userId = id;
    const body = updateUserSchema.safeParse(await request.json());
    if (!body.success) {
      log.warn(
        `users update ditolak: body tidak valid (userId ${id}, outcome denied)`
      );
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

    // Email/nama/alasan free-text user tidak pernah masuk log.
    log.info(
      `users update (actor ${actor.userId}, userId ${id}, roleId ${updated.role?.id ?? "none"}, policyVersion ${actor.policyVersion}, outcome success)`
    );
    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    const mapped = mapServiceError(error);
    if (mapped) {
      log.warn(
        `users update denied (userId ${userId ?? "unknown"}, code ${(error as { code?: string }).code}, outcome denied)`
      );
      return mapped;
    }
    log.error(
      `users update gagal (userId ${userId ?? "unknown"}, outcome error)`,
      new RouteLogError("users update gagal")
    );
    return internalErrorResponse();
  }
}

async function rejectHardDelete(
  _request: NextRequest,
  { params }: RouteContext
): Promise<Response> {
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

/**
 * Users are soft-deactivated, never hard-deleted (audit attribution and
 * identity reservation). The legacy hard DELETE is answered with 405.
 */
export const GET = withRequestContext(userDetail, "admin-user-detail");
export const PUT = withRequestContext(updateUserAccount, "admin-user-detail");
export const DELETE = withRequestContext(rejectHardDelete, "admin-user-detail");

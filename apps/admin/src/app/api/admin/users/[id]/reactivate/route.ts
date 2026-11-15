import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { createModuleLogger, withRequestContext } from "@/lib/logger";
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

/**
 * Module logger untuk route ini: dibuat sekali di module scope, sedangkan
 * `requestId` dibaca dari scope HTTP yang aktif setiap kali log ditulis
 * (`withRequestContext` di export handler membuka scope tersebut).
 */
const log = createModuleLogger("admin-user-reactivate");

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

const reactivateSchema = z.strictObject({
  reason: z.string().min(1).nullable().optional(),
});

type RouteContext = { params: Promise<{ id: string }> };

async function reactivateUserAccount(
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
    const body = reactivateSchema.safeParse(
      await request.json().catch(() => ({}))
    );
    if (!body.success) {
      log.warn(
        `users reactivate ditolak: body tidak valid (userId ${id}, outcome denied)`
      );
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

    // Alasan reaktivasi adalah teks bebas operator — tidak masuk log.
    log.info(
      `users reactivate (actor ${actor.userId}, userId ${id}, policyVersion ${actor.policyVersion}, outcome success)`
    );
    return NextResponse.json({ success: true, data: reactivated });
  } catch (error) {
    const mapped = mapServiceError(error);
    if (mapped) {
      log.warn(
        `users reactivate denied (userId ${userId ?? "unknown"}, code ${(error as { code?: string }).code}, outcome denied)`
      );
      return mapped;
    }
    log.error(
      `users reactivate gagal (userId ${userId ?? "unknown"}, outcome error)`,
      new RouteLogError("users reactivate gagal")
    );
    return internalErrorResponse();
  }
}

/** HTTP entry: wrapper menambahkan `x-request-id` kanonik + satu baris completion. */
export const POST = withRequestContext(
  reactivateUserAccount,
  "admin-user-reactivate"
);

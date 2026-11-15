import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { createModuleLogger, withRequestContext } from "@/lib/logger";
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

/**
 * Module logger untuk route ini: dibuat sekali di module scope, sedangkan
 * `requestId` dibaca dari scope HTTP yang aktif setiap kali log ditulis
 * (`withRequestContext` di export handler membuka scope tersebut).
 */
const log = createModuleLogger("admin-user-deactivate");

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

const deactivateSchema = z.strictObject({
  reason: z.string().min(1),
});

type RouteContext = { params: Promise<{ id: string }> };

async function deactivateUserAccount(
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
    const body = deactivateSchema.safeParse(await request.json());
    if (!body.success) {
      log.warn(
        `users deactivate ditolak: alasan wajib (userId ${id}, outcome denied)`
      );
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

    // Alasan deaktivasi adalah teks bebas operator — tidak masuk log.
    log.info(
      `users deactivate (actor ${actor.userId}, userId ${id}, policyVersion ${actor.policyVersion}, outcome success)`
    );
    return NextResponse.json({ success: true, data: deactivated });
  } catch (error) {
    const mapped = mapServiceError(error);
    if (mapped) {
      log.warn(
        `users deactivate denied (userId ${userId ?? "unknown"}, code ${(error as { code?: string }).code}, outcome denied)`
      );
      return mapped;
    }
    log.error(
      `users deactivate gagal (userId ${userId ?? "unknown"}, outcome error)`,
      new RouteLogError("users deactivate gagal")
    );
    return internalErrorResponse();
  }
}

/** HTTP entry: wrapper menambahkan `x-request-id` kanonik + satu baris completion. */
export const POST = withRequestContext(
  deactivateUserAccount,
  "admin-user-deactivate"
);

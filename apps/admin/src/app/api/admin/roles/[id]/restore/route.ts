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

/**
 * Module logger untuk route ini: dibuat sekali di module scope, sedangkan
 * `requestId` dibaca dari scope HTTP yang aktif setiap kali log ditulis
 * (`withRequestContext` di export handler membuka scope tersebut).
 */
const log = createModuleLogger("admin-role-restore");

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

const restoreRoleSchema = roleIdentitySchema.extend({
  grants: z.array(grantSchema),
  // Any integer: a stale/non-positive expectedVersion is a semantic, service-
  // level condition that must surface as 409 STALE_VERSION, not a body error.
  expectedVersion: z.number().int(),
});

type RouteContext = { params: Promise<{ id: string }> };

async function restoreReview(
  _request: NextRequest,
  { params }: RouteContext
): Promise<Response> {
  const guardResult = await guard("roles", "view");
  if (!guardResult.ok) return guardResult.response;

  try {
    const { id } = await params;
    const review = await getRestoreReview(id);
    if (!review) {
      log.warn(
        `roles restore-review ditolak: role arsip tidak ditemukan (roleId ${id}, outcome denied)`
      );
      return NextResponse.json(
        {
          success: false,
          error: "Archived Role not found",
          code: "NOT_FOUND",
        },
        { status: 404 }
      );
    }
    log.info(`roles restore-review (roleId ${id}, outcome success)`);
    return NextResponse.json({ success: true, data: review });
  } catch (error) {
    const mapped = mapServiceError(error);
    if (mapped) return mapped;
    log.error(
      "roles restore-review gagal (outcome error)",
      new RouteLogError("roles restore-review gagal")
    );
    return internalErrorResponse();
  }
}

async function restoreArchivedRole(
  request: NextRequest,
  { params }: RouteContext
): Promise<Response> {
  const guardResult = await guard("roles", "edit");
  if (!guardResult.ok) return guardResult.response;
  const { ctx } = guardResult;

  let roleId: string | null = null;
  try {
    const { id } = await params;
    roleId = id;
    const body = restoreRoleSchema.safeParse(await request.json());
    if (!body.success) {
      log.warn(
        `roles restore ditolak: body tidak valid (roleId ${id}, outcome denied)`
      );
      return invalidBodyResponse();
    }

    const actor = buildActorContext(ctx.user.id, ctx.policy);
    const restored = await restoreRole(actor, id, {
      expectedVersion: body.data.expectedVersion,
      name: body.data.name,
      description: body.data.description ?? null,
      grants: parseGrants(body.data.grants) ?? [],
    });

    log.info(
      `roles restore (roleId ${id}, actor ${actor.userId}, toVersion ${restored.version}, policyVersion ${actor.policyVersion}, outcome success)`
    );
    return NextResponse.json({ success: true, data: restored });
  } catch (error) {
    const mapped = mapServiceError(error);
    if (mapped) {
      log.warn(
        `roles restore denied (roleId ${roleId ?? "unknown"}, code ${(error as { code?: string }).code}, outcome denied)`
      );
      return mapped;
    }
    log.error(
      `roles restore gagal (roleId ${roleId ?? "unknown"}, outcome error)`,
      new RouteLogError("roles restore gagal")
    );
    return internalErrorResponse();
  }
}

/** HTTP entry: wrapper menambahkan `x-request-id` kanonik + satu baris completion. */
export const GET = withRequestContext(restoreReview, "admin-role-restore");
export const POST = withRequestContext(restoreArchivedRole, "admin-role-restore");

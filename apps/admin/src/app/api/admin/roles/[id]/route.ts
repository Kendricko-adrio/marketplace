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
  archiveRole,
  buildActorContext,
  getRoleDetail,
  reviseRole,
} from "@/lib/rbac/roles-service";

// =========================================================
// /api/admin/roles/[id]
//   GET    — Role detail incl. grants and user counts  [roles:view]
//            Archived Roles are fetchable by id (roles:view): the editor
//            needs them for the archived mode and restore review. The
//            restore review itself stays separately validated on /restore.
//   PUT    — atomic complete-draft revision            [roles:edit]
//   DELETE — archive a custom Role (reason required)   [roles:delete]
// =========================================================

export const dynamic = "force-dynamic";

/**
 * Module logger untuk route ini: dibuat sekali di module scope, sedangkan
 * `requestId` dibaca dari scope HTTP yang aktif setiap kali log ditulis
 * (`withRequestContext` di export handler membuka scope tersebut).
 */
const log = createModuleLogger("admin-role-detail");

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

const reviseRoleSchema = roleIdentitySchema.extend({
  grants: z.array(grantSchema),
  expectedVersion: z.number().int().positive(),
  reason: z.string().nullable().optional(),
});

const archiveRoleSchema = z.object({
  reason: z.string().min(1),
});

type RouteContext = { params: Promise<{ id: string }> };

async function roleDetail(
  _request: NextRequest,
  { params }: RouteContext
): Promise<Response> {
  const guardResult = await guard("roles", "view");
  if (!guardResult.ok) return guardResult.response;

  try {
    const { id } = await params;
    // Documented contract: roles:view fetches any Role by id, including an
    // archived one (default list still excludes archived). Restore review
    // remains separately validated by the /restore route and service.
    const role = await getRoleDetail(id, { includeArchived: true });
    if (!role) {
      log.warn(`roles detail ditolak: role tidak ditemukan (roleId ${id}, outcome denied)`);
      return NextResponse.json(
        { success: false, error: "Role not found", code: "NOT_FOUND" },
        { status: 404 }
      );
    }
    log.info(
      `roles detail (roleId ${id}, version ${role.version}, outcome success)`
    );
    return NextResponse.json({ success: true, data: role });
  } catch (error) {
    const mapped = mapServiceError(error);
    if (mapped) return mapped;
    log.error(
      "roles detail gagal (outcome error)",
      new RouteLogError("roles detail gagal")
    );
    return internalErrorResponse();
  }
}

async function reviseRoleHandler(
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
    const body = reviseRoleSchema.safeParse(await request.json());
    if (!body.success) {
      log.warn(
        `roles revise ditolak: body tidak valid (roleId ${id}, outcome denied)`
      );
      return invalidBodyResponse();
    }

    const actor = buildActorContext(ctx.user.id, ctx.policy);
    const updated = await reviseRole(actor, id, {
      expectedVersion: body.data.expectedVersion,
      name: body.data.name,
      description: body.data.description ?? null,
      grants: parseGrants(body.data.grants) ?? [],
      reason: body.data.reason ?? null,
    });

    // Alasan free-text operator tidak masuk log.
    log.info(
      `roles revise (roleId ${id}, actor ${actor.userId}, fromVersion ${body.data.expectedVersion}, toVersion ${updated.version}, policyVersion ${actor.policyVersion}, outcome success)`
    );
    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    const mapped = mapServiceError(error);
    if (mapped) {
      log.warn(
        `roles revise denied (roleId ${roleId ?? "unknown"}, code ${(error as { code?: string }).code}, outcome denied)`
      );
      return mapped;
    }
    log.error(
      `roles revise gagal (roleId ${roleId ?? "unknown"}, outcome error)`,
      new RouteLogError("roles revise gagal")
    );
    return internalErrorResponse();
  }
}

async function archiveRoleHandler(
  request: NextRequest,
  { params }: RouteContext
): Promise<Response> {
  const guardResult = await guard("roles", "delete");
  if (!guardResult.ok) return guardResult.response;
  const { ctx } = guardResult;

  let roleId: string | null = null;
  try {
    const { id } = await params;
    roleId = id;
    const body = archiveRoleSchema.safeParse(await request.json());
    if (!body.success) {
      log.warn(
        `roles archive ditolak: alasan wajib (roleId ${id}, outcome denied)`
      );
      return invalidBodyResponse();
    }

    const actor = buildActorContext(ctx.user.id, ctx.policy);
    const archived = await archiveRole(actor, id, body.data.reason);

    // Alasan free-text operator tidak masuk log.
    log.info(
      `roles archive (roleId ${id}, actor ${actor.userId}, policyVersion ${actor.policyVersion}, outcome success)`
    );
    return NextResponse.json({ success: true, data: archived });
  } catch (error) {
    const mapped = mapServiceError(error);
    if (mapped) {
      log.warn(
        `roles archive denied (roleId ${roleId ?? "unknown"}, code ${(error as { code?: string }).code}, outcome denied)`
      );
      return mapped;
    }
    log.error(
      `roles archive gagal (roleId ${roleId ?? "unknown"}, outcome error)`,
      new RouteLogError("roles archive gagal")
    );
    return internalErrorResponse();
  }
}

/** HTTP entry: wrapper menambahkan `x-request-id` kanonik + satu baris completion. */
export const GET = withRequestContext(roleDetail, "admin-role-detail");
export const PUT = withRequestContext(reviseRoleHandler, "admin-role-detail");
export const DELETE = withRequestContext(archiveRoleHandler, "admin-role-detail");

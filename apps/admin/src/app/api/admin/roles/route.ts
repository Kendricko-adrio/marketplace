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
  createRole,
  listRoles,
} from "@/lib/rbac/roles-service";

// =========================================================
// /api/admin/roles
//   GET  — searchable Role list (default excludes archived)   [roles:view]
//   POST — create a Role from a final deny-all/cloned draft   [roles:edit]
// =========================================================

export const dynamic = "force-dynamic";

/**
 * Module logger untuk route ini: dibuat sekali di module scope, sedangkan
 * `requestId` dibaca dari scope HTTP yang aktif setiap kali log ditulis
 * (`withRequestContext` di export handler membuka scope tersebut).
 */
const log = createModuleLogger("admin-roles");

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

const createRoleSchema = roleIdentitySchema.extend({
  grants: z.array(grantSchema).optional(),
  cloneFromId: z.string().optional(),
});

async function listRolesHandler(request: NextRequest): Promise<Response> {
  const guardResult = await guard("roles", "view");
  if (!guardResult.ok) return guardResult.response;

  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q") ?? "";
    const archived = searchParams.get("archived") === "true";

    const roles = await listRoles({ q, archived });
    // Kata kunci pencarian tidak masuk log; hanya jumlah + mode arsip.
    log.info(
      `roles list (count ${roles.length}, archived ${archived}, outcome success)`
    );
    return NextResponse.json({ success: true, data: roles });
  } catch (error) {
    const mapped = mapServiceError(error);
    if (mapped) return mapped;
    log.error(
      "roles list gagal (outcome error)",
      new RouteLogError("roles list gagal")
    );
    return internalErrorResponse();
  }
}

async function createRoleHandler(request: NextRequest): Promise<Response> {
  const guardResult = await guard("roles", "edit");
  if (!guardResult.ok) return guardResult.response;
  const { ctx } = guardResult;

  try {
    const body = createRoleSchema.safeParse(await request.json());
    if (!body.success) {
      log.warn("roles create ditolak: body tidak valid (outcome denied)");
      return invalidBodyResponse();
    }

    const actor = buildActorContext(ctx.user.id, ctx.policy);
    const created = await createRole(actor, {
      name: body.data.name,
      description: body.data.description ?? null,
      grants: parseGrants(body.data.grants),
      cloneFromId: body.data.cloneFromId,
    });

    log.info(
      `roles create (roleId ${created.id}, actor ${actor.userId}, policyVersion ${actor.policyVersion}, outcome success)`
    );
    return NextResponse.json({ success: true, data: created }, { status: 201 });
  } catch (error) {
    const mapped = mapServiceError(error);
    if (mapped) {
      log.warn(
        `roles create denied (code ${(error as { code?: string }).code}, outcome denied)`
      );
      return mapped;
    }
    log.error(
      "roles create gagal (outcome error)",
      new RouteLogError("roles create gagal")
    );
    return internalErrorResponse();
  }
}

/** HTTP entry: wrapper menambahkan `x-request-id` kanonik + satu baris completion. */
export const GET = withRequestContext(listRolesHandler, "admin-roles");
export const POST = withRequestContext(createRoleHandler, "admin-roles");

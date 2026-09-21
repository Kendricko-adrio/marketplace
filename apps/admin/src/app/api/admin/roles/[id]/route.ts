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

const reviseRoleSchema = roleIdentitySchema.extend({
  grants: z.array(grantSchema),
  expectedVersion: z.number().int().positive(),
  reason: z.string().nullable().optional(),
});

const archiveRoleSchema = z.object({
  reason: z.string().min(1),
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
    // Documented contract: roles:view fetches any Role by id, including an
    // archived one (default list still excludes archived). Restore review
    // remains separately validated by the /restore route and service.
    const role = await getRoleDetail(id, { includeArchived: true });
    if (!role) {
      logger.warn("roles.detail.not_found", {
        outcome: "denied",
        roleId: id,
      });
      return NextResponse.json(
        { success: false, error: "Role not found", code: "NOT_FOUND" },
        { status: 404 }
      );
    }
    logger.info("roles.detail", {
      outcome: "success",
      roleId: id,
      policyVersion: role.version,
    });
    return NextResponse.json({ success: true, data: role });
  } catch (error) {
    const mapped = mapServiceError(error);
    if (mapped) return mapped;
    logger.error("roles.detail.failure", {
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
  const guardResult = await guard("roles", "edit", { request });
  if (!guardResult.ok) return guardResult.response;
  const { logger, ctx } = guardResult;

  try {
    const { id } = await params;
    const body = reviseRoleSchema.safeParse(await request.json());
    if (!body.success) {
      logger.warn("roles.revise.invalid_body", {
        outcome: "denied",
        roleId: id,
      });
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

    logger.info("roles.revise", {
      outcome: "success",
      roleId: id,
      actorId: actor.userId,
      fromVersion: body.data.expectedVersion,
      toVersion: updated.version,
      policyVersion: actor.policyVersion,
    });
    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    const mapped = mapServiceError(error);
    if (mapped) {
      logger.warn("roles.revise.denied", {
        outcome: "denied",
        code: (error as { code?: string }).code,
      });
      return mapped;
    }
    logger.error("roles.revise.failure", {
      outcome: "error",
      error: serializeError(error),
    });
    return internalErrorResponse();
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: RouteContext
) {
  const guardResult = await guard("roles", "delete", { request });
  if (!guardResult.ok) return guardResult.response;
  const { logger, ctx } = guardResult;

  try {
    const { id } = await params;
    const body = archiveRoleSchema.safeParse(await request.json());
    if (!body.success) {
      logger.warn("roles.archive.invalid_body", {
        outcome: "denied",
        roleId: id,
      });
      return invalidBodyResponse();
    }

    const actor = buildActorContext(ctx.user.id, ctx.policy);
    const archived = await archiveRole(actor, id, body.data.reason);

    logger.info("roles.archive", {
      outcome: "success",
      roleId: id,
      actorId: actor.userId,
      policyVersion: actor.policyVersion,
    });
    return NextResponse.json({ success: true, data: archived });
  } catch (error) {
    const mapped = mapServiceError(error);
    if (mapped) {
      logger.warn("roles.archive.denied", {
        outcome: "denied",
        code: (error as { code?: string }).code,
      });
      return mapped;
    }
    logger.error("roles.archive.failure", {
      outcome: "error",
      error: serializeError(error),
    });
    return internalErrorResponse();
  }
}
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

const createRoleSchema = roleIdentitySchema.extend({
  grants: z.array(grantSchema).optional(),
  cloneFromId: z.string().optional(),
});

export async function GET(request: NextRequest) {
  const guardResult = await guard("roles", "view", { request });
  if (!guardResult.ok) return guardResult.response;
  const { logger } = guardResult;

  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q") ?? "";
    const archived = searchParams.get("archived") === "true";

    const roles = await listRoles({ q, archived });
    logger.info("roles.list", {
      outcome: "success",
      count: roles.length,
      archived,
    });
    return NextResponse.json({ success: true, data: roles });
  } catch (error) {
    const mapped = mapServiceError(error);
    if (mapped) return mapped;
    logger.error("roles.list.failure", {
      outcome: "error",
      error: serializeError(error),
    });
    return internalErrorResponse();
  }
}

export async function POST(request: NextRequest) {
  const guardResult = await guard("roles", "edit", { request });
  if (!guardResult.ok) return guardResult.response;
  const { logger, ctx } = guardResult;

  try {
    const body = createRoleSchema.safeParse(await request.json());
    if (!body.success) {
      logger.warn("roles.create.invalid_body", { outcome: "denied" });
      return invalidBodyResponse();
    }

    const actor = buildActorContext(ctx.user.id, ctx.policy);
    const created = await createRole(actor, {
      name: body.data.name,
      description: body.data.description ?? null,
      grants: parseGrants(body.data.grants),
      cloneFromId: body.data.cloneFromId,
    });

    logger.info("roles.create", {
      outcome: "success",
      roleId: created.id,
      actorId: actor.userId,
      policyVersion: actor.policyVersion,
    });
    return NextResponse.json({ success: true, data: created }, { status: 201 });
  } catch (error) {
    const mapped = mapServiceError(error);
    if (mapped) {
      logger.warn("roles.create.denied", {
        outcome: "denied",
        code: (error as { code?: string }).code,
      });
      return mapped;
    }
    logger.error("roles.create.failure", {
      outcome: "error",
      error: serializeError(error),
    });
    return internalErrorResponse();
  }
}
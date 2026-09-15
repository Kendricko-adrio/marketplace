import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { serializeError } from "@/lib/logger";
import { guard } from "@/lib/rbac/guard";
import {
  buildActorContext,
} from "@/lib/rbac/roles-service";
import {
  createUser,
  listUsers,
} from "@/lib/rbac/users-service";
import {
  internalErrorResponse,
  mapServiceError,
} from "@/lib/rbac/roles-http";

// =========================================================
// /api/admin/users
//   GET  — user directory (global) with role/activity filters [users:view]
//   POST — transactional user creation with Role + Home Branch [users:edit]
//
// Payloads are STRICT: assignment uses the dynamic `roleId` field with a
// mandatory Home Branch for every non-Owner Role. Assignment is validated
// (valid active Role, mandatory Home Branch, Authorization Ceiling,
// Owner-only promotion) in one transaction with the user/account insert.
// =========================================================

export const dynamic = "force-dynamic";

// z.strictObject rejects unknown keys — a role-name payload fails 400.
const createUserSchema = z.strictObject({
  name: z.string().min(2, "Nama minimal 2 karakter").max(100),
  email: z.email("Format email tidak valid"),
  roleId: z.string().min(1),
  branchId: z.string().min(1).nullable().optional(),
  passwordMode: z.enum(["manual", "generate"]),
  password: z.string().min(8, "Password minimal 8 karakter").optional(),
});

export async function GET(request: NextRequest) {
  const guardResult = await guard("users", "view", { request });
  if (!guardResult.ok) return guardResult.response;
  const { logger } = guardResult;

  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q") ?? searchParams.get("search") ?? "";
    const roleId = searchParams.get("roleId") ?? undefined;
    // Role-name filters are gone; clients must filter by Role id.
    const legacyRole = searchParams.get("role");
    if (legacyRole) {
      logger.warn("users.list.legacy_role_filter", {
        outcome: "denied",
        reason: "legacy_role_filter_removed",
      });
      return NextResponse.json(
        {
          success: false,
          error: "Filter by roleId — the legacy role filter was removed",
          code: "LEGACY_FILTER_REMOVED",
        },
        { status: 400 }
      );
    }
    const activeParam = searchParams.get("active");
    const active =
      activeParam === "true" ? true : activeParam === "false" ? false : undefined;

    const data = await listUsers({ q, roleId, active });
    logger.info("users.list", {
      outcome: "success",
      count: data.length,
      filters: { roleId, active },
    });
    return NextResponse.json({ success: true, data });
  } catch (error) {
    logger.error("users.list.failure", {
      outcome: "error",
      error: serializeError(error),
    });
    return internalErrorResponse();
  }
}

export async function POST(request: NextRequest) {
  const guardResult = await guard("users", "edit", { request });
  if (!guardResult.ok) return guardResult.response;
  const { logger, ctx } = guardResult;

  try {
    const body = createUserSchema.safeParse(await request.json());
    if (!body.success) {
      logger.warn("users.create.invalid_body", { outcome: "denied" });
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
    const created = await createUser(actor, {
      name: body.data.name,
      email: body.data.email,
      roleId: body.data.roleId,
      branchId: body.data.branchId ?? null,
      passwordMode: body.data.passwordMode,
      password: body.data.password,
    });

    logger.info("users.create", {
      outcome: "success",
      actorId: actor.userId,
      userId: created.id,
      roleId: created.role?.id ?? null,
      branchId: created.branch?.id ?? null,
      policyVersion: actor.policyVersion,
    });

    return NextResponse.json({ success: true, data: created }, { status: 201 });
  } catch (error) {
    const mapped = mapServiceError(error);
    if (mapped) {
      logger.warn("users.create.denied", {
        outcome: "denied",
        code: (error as { code?: string }).code,
      });
      return mapped;
    }
    logger.error("users.create.failure", {
      outcome: "error",
      error: serializeError(error),
    });
    return internalErrorResponse();
  }
}
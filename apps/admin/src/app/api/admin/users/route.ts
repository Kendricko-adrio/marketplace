import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { createModuleLogger, withRequestContext } from "@/lib/logger";
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

/**
 * Module logger untuk route ini: dibuat sekali di module scope, sedangkan
 * `requestId` dibaca dari scope HTTP yang aktif setiap kali log ditulis
 * (`withRequestContext` di export handler membuka scope tersebut).
 */
const log = createModuleLogger("admin-users");

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

// z.strictObject rejects unknown keys — a role-name payload fails 400.
const createUserSchema = z.strictObject({
  name: z.string().min(2, "Nama minimal 2 karakter").max(100),
  email: z.email("Format email tidak valid"),
  roleId: z.string().min(1),
  branchId: z.string().min(1).nullable().optional(),
  passwordMode: z.enum(["manual", "generate"]),
  password: z.string().min(8, "Password minimal 8 karakter").optional(),
});

async function listDirectory(request: NextRequest): Promise<Response> {
  const guardResult = await guard("users", "view");
  if (!guardResult.ok) return guardResult.response;

  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q") ?? searchParams.get("search") ?? "";
    const roleId = searchParams.get("roleId") ?? undefined;
    // Role-name filters are gone; clients must filter by Role id.
    const legacyRole = searchParams.get("role");
    if (legacyRole) {
      log.warn(
        "users list ditolak: filter role legacy sudah dihapus (reason legacy_role_filter_removed, outcome denied)"
      );
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
    // Kata kunci pencarian dan email user tidak pernah masuk log.
    log.info(
      `users list (count ${data.length}, roleId ${roleId ?? "none"}, active ${active === undefined ? "any" : String(active)}, outcome success)`
    );
    return NextResponse.json({ success: true, data });
  } catch {
    log.error("users list gagal (outcome error)", new RouteLogError("users list gagal"));
    return internalErrorResponse();
  }
}

async function createUserAccount(request: NextRequest): Promise<Response> {
  const guardResult = await guard("users", "edit");
  if (!guardResult.ok) return guardResult.response;
  const { ctx } = guardResult;

  try {
    const body = createUserSchema.safeParse(await request.json());
    if (!body.success) {
      log.warn("users create ditolak: body tidak valid (outcome denied)");
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

    // Email/nama/password user baru tidak pernah masuk log.
    log.info(
      `users create (actor ${actor.userId}, userId ${created.id}, roleId ${created.role?.id ?? "none"}, branchId ${created.branch?.id ?? "none"}, policyVersion ${actor.policyVersion}, outcome success)`
    );

    return NextResponse.json({ success: true, data: created }, { status: 201 });
  } catch (error) {
    const mapped = mapServiceError(error);
    if (mapped) {
      log.warn(
        `users create denied (code ${(error as { code?: string }).code}, outcome denied)`
      );
      return mapped;
    }
    log.error(
      "users create gagal (outcome error)",
      new RouteLogError("users create gagal")
    );
    return internalErrorResponse();
  }
}

/** HTTP entry: wrapper menambahkan `x-request-id` kanonik + satu baris completion. */
export const GET = withRequestContext(listDirectory, "admin-users");
export const POST = withRequestContext(createUserAccount, "admin-users");

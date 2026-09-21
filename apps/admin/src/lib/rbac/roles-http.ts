import { NextResponse } from "next/server";
import { z } from "zod";

import { RoleServiceError } from "./roles-service";
import type { Grant } from "@marketplace/db/src/rbac/catalog";

// =========================================================
// RBAC: shared HTTP plumbing for the /api/admin/roles routes
// =========================================================

export const grantSchema = z.object({
  module: z.string(),
  action: z.enum(["view", "edit", "delete"]),
  scope: z.string(),
});

export const roleIdentitySchema = z.object({
  name: z.string().min(1),
  description: z.string().nullable().optional(),
});

export function parseGrants(
  grants: z.infer<typeof grantSchema>[] | undefined
): Grant[] | undefined {
  if (!grants) return undefined;
  return grants.map((grant) => ({
    module: grant.module as Grant["module"],
    action: grant.action as Grant["action"],
    scope: grant.scope as Grant["scope"],
  }));
}

/** Map a RoleServiceError to its stable HTTP response; null otherwise. */
export function mapServiceError(error: unknown): NextResponse | null {
  if (error instanceof RoleServiceError) {
    return NextResponse.json(
      { success: false, error: error.message, code: error.code },
      { status: error.status }
    );
  }
  return null;
}

export function invalidBodyResponse(): NextResponse {
  return NextResponse.json(
    { success: false, error: "Invalid request body", code: "INVALID_BODY" },
    { status: 400 }
  );
}

export function internalErrorResponse(): NextResponse {
  return NextResponse.json(
    { success: false, error: "Internal server error", code: "INTERNAL" },
    { status: 500 }
  );
}
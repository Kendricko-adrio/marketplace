import { vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

// =========================================================
// Shared seam-test helpers for admin API route tests
// =========================================================
// Route tests mock `@/lib/rbac/guard` and `@/lib/logger` and inject a fake
// Drizzle executor for `@/db` (see fake-db.ts), keeping the REAL services so
// the full guard → route → service → db(transaction) seam is exercised.

/** Mock for the `guard` export of "@/lib/rbac/guard". Configured per test. */
export const guardMock = vi.fn();

/** Mock for the `crossBranchNotFound` export of "@/lib/rbac/guard". */
export function crossBranchNotFound() {
  return NextResponse.json(
    { success: false, error: "Branch not found" },
    { status: 404 }
  );
}

export function makeLogger() {
  const logger: Record<string, unknown> = {
    requestId: "test",
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  logger.child = vi.fn(() => logger);
  return logger as unknown as {
    requestId: string;
    debug: ReturnType<typeof vi.fn>;
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
    child: (context: Record<string, unknown>) => unknown;
  };
}

export type RouteLogger = ReturnType<typeof makeLogger>;

export interface GuardContextOverrides {
  userId?: string;
  policyVersion?: number;
  homeBranchId?: string;
  scope?: "own_branch" | "all_branches" | "global";
}

/** Resolve the mocked `guard` with an authorization success. */
export function guardAllow(
  logger: RouteLogger,
  overrides: GuardContextOverrides = {}
) {
  guardMock.mockResolvedValue({
    ok: true,
    ctx: {
      user: { id: overrides.userId ?? "admin-1" },
      policy: {
        policyVersion: overrides.policyVersion ?? 7,
        user: { homeBranchId: overrides.homeBranchId ?? "b-1" },
      },
      authorization: {
        allowed: true,
        scope: overrides.scope ?? "all_branches",
        homeBranchId: overrides.homeBranchId ?? "b-1",
      },
    },
    logger,
  });
}

/** Resolve the mocked `guard` with an authorization denial. */
export function guardDeny(
  response: NextResponse,
  logger: RouteLogger = makeLogger()
) {
  guardMock.mockResolvedValue({ ok: false, response, logger });
}

/** Build an admin API JSON request. */
export function jsonRequest(
  url: string,
  method: "POST" | "PUT" | "DELETE",
  body?: unknown
) {
  return new NextRequest(`http://localhost:3001${url}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** Standard mock for "@/lib/logger" (only the symbols routes import). */
export async function loggerModuleMock() {
  const self = await import("./route-test");
  return {
    createLogger: () => self.makeLogger(),
    requestLogger: () => self.makeLogger(),
    serializeError: (error: unknown) => ({ message: String(error) }),
  };
}
import { vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

// =========================================================
// Shared seam-test helpers for admin API route tests
// =========================================================
// Route tests mock `@/lib/rbac/guard` and `@/lib/logger` and inject a fake
// Drizzle executor for `@/db` (see fake-db.ts), keeping the REAL services so
// the full guard → route → service → db(transaction) seam is exercised.
//
// `@/lib/logger` hanya mengekspos facade (`createModuleLogger`,
// `withRequestContext`, `getRequestId`, `withExecutionContext`,
// `withDetachedExecutionContext`). `createModuleLogger` mengembalikan module
// logger no-op dan wrapper scope menjadi pass-through, sehingga module yang
// dimigrasikan berjalan di bawah mock ini tanpa menulis ke stdout dan tanpa
// membuka scope nyata.
//
// Yang sengaja TIDAK direproduksi mock ini: header kanonik `x-request-id`, id
// per-invocation, dan line penutup `METHOD <status>` — ketiganya dihasilkan
// facade NYATA (`withRequestContext`). Route test yang butuh perilaku itu tidak
// boleh meng-stub `@/lib/logger` sama sekali.

/** Mock for the `guard` export of "@/lib/rbac/guard". Configured per test. */
export const guardMock = vi.fn();

/** Mock for the `crossBranchNotFound` export of "@/lib/rbac/guard". */
export function crossBranchNotFound() {
  return NextResponse.json(
    { success: false, error: "Branch not found" },
    { status: 404 }
  );
}

/**
 * Facade module-logger stub — exactly the `createModuleLogger()` surface:
 * six levels taking `(message, error?)` and nothing else. No `child()`, no
 * `requestId`, no arbitrary bindings, because the facade has none either.
 */
export function makeModuleLogger() {
  return {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  };
}

export type RouteModuleLogger = ReturnType<typeof makeModuleLogger>;

/**
 * Pass-through stand-in for the facade `withRequestContext`: forwards every
 * argument (including a framework `params` promise) and awaits the handler.
 * It opens no scope and adds no header — the real wrapper owns both.
 */
export function withRequestContextPassThrough<Args extends unknown[]>(
  handler: (...args: Args) => Response | Promise<Response>
): (...args: Args) => Promise<Response> {
  return async (...args: Args) => handler(...args);
}

/** Pass-through stand-in for the facade execution-scope wrappers. */
export function runWorkPassThrough<T>(work: () => T): T {
  return work();
}

export interface GuardContextOverrides {
  userId?: string;
  policyVersion?: number;
  homeBranchId?: string;
  scope?: "own_branch" | "all_branches" | "global";
}

/**
 * Resolve the mocked `guard` with an authorization success.
 *
 * The mocked result carries only `ctx` — the resolved actor/policy and
 * authorization the routes read. No logger travels through the guard result.
 */
export function guardAllow(overrides: GuardContextOverrides = {}) {
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
  });
}

/** Resolve the mocked `guard` with an authorization denial. */
export function guardDeny(response: NextResponse) {
  guardMock.mockResolvedValue({ ok: false, response });
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

/**
 * Standard mock for "@/lib/logger": the facade API of the target contract only.
 * `getRequestId` reports `null` because this mock opens no request scope — the
 * same value the real facade reports outside an HTTP scope.
 */
export async function loggerModuleMock() {
  const self = await import("./route-test");
  return {
    createModuleLogger: () => self.makeModuleLogger(),
    withRequestContext: self.withRequestContextPassThrough,
    getRequestId: () => null,
    withExecutionContext: self.runWorkPassThrough,
    withDetachedExecutionContext: self.runWorkPassThrough,
  };
}

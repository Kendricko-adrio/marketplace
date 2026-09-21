import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { admissionDecision, authorizeLoaded, loadPolicy, type LoadedPolicy } from "./resolver";
import type { ModuleKey } from "@marketplace/db/src/rbac/catalog";
import type { ActionKey } from "@marketplace/db/src/rbac/catalog";

// =========================================================
// RBAC: server-side page guard
// =========================================================
// Server layout/pages remain authoritative: every protected admin page
// re-loads the DB-backed Current Policy on navigation and renders or
// redirects accordingly. Client policy mirrors only drive affordances.

export type PageGuardResult =
  | { ok: true; policy: LoadedPolicy }
  | { ok: false; reason: "unauthenticated" | "must_reset_password" | "no_access" };

/**
 * Resolve the session + Current Policy for a protected admin page.
 * `no_access` covers an unresolvable policy, failed admission, and a
 * missing grant for the required module/action.
 */
export async function pagePolicyGuard(
  module: ModuleKey,
  action: ActionKey
): Promise<PageGuardResult> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { ok: false, reason: "unauthenticated" };

  const mustResetPassword = Boolean(
    (session.user as { mustResetPassword?: boolean }).mustResetPassword
  );
  if (mustResetPassword) return { ok: false, reason: "must_reset_password" };

  const policy = await loadPolicy(session.user.id);
  if (!policy) return { ok: false, reason: "no_access" };

  const admission = admissionDecision({
    isActive: policy.user.isActive,
    roleId: policy.role.id,
    roleExists: true,
    roleArchived: policy.role.archived,
  });
  if (!admission.admitted) return { ok: false, reason: "no_access" };

  const result = authorizeLoaded(policy, module, action);
  if (!result.allowed) return { ok: false, reason: "no_access" };

  return { ok: true, policy };
}

/**
 * Guard a page and redirect to the shared No-Access page when the policy
 * denies the module/action. Used by protected server pages that have no
 * meaningful "denied" rendering of their own.
 */
export async function pagePermissionOrRedirect(
  module: ModuleKey,
  action: ActionKey,
  callbackUrl: string
): Promise<LoadedPolicy> {
  const result = await pagePolicyGuard(module, action);
  if (!result.ok) {
    if (result.reason === "unauthenticated") {
      redirect(`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`);
    }
    if (result.reason === "must_reset_password") {
      redirect("/reset-password?force=1");
    }
    redirect("/admin/no-access");
  }
  return result.policy;
}
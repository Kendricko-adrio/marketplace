import type {
  ActionKey,
  Grant,
  ModuleKey,
} from "@marketplace/db/src/rbac/catalog";
import { SYSTEM_OWNER_KEY } from "@marketplace/db/src/rbac/catalog";
import { authorize, type Policy } from "@marketplace/db/src/rbac/policy";

// =========================================================
// RBAC: client policy state (pure helpers)
// =========================================================
// The browser mirrors the server-resolved Current Policy through
// GET /api/admin/policy/me. This module holds the pure state machine and
// helpers consumed by AuthProvider, the AdminSidebar, and the Role UI:
//
// - `ready`        — policy resolved with at least one view grant
// - `no-access`    — policy resolved (or policy/me denied 403) but the
//                    caller has no view grant at all
// - `unavailable`  — the policy refresh FAILED (network/5xx/401): stale
//                    policy and protected navigation/data are cleared and
//                    the UI shows the Policy-Unavailable state with
//                    retry/recovery/logout
//
// Policy is revalidated on App Router navigation, window focus, and after
// any 403 (see createPolicyAwareFetch). A failed refresh never logs the
// user out — recovery actions are explicit.

export type ClientPolicyStatus =
  | "loading"
  | "ready"
  | "no-access"
  | "unavailable";

export interface ClientBranch {
  id: string;
  name: string;
  code: string;
  city: string;
}

/** Shape of the `data` payload returned by GET /api/admin/policy/me. */
export interface ClientPolicyResponseData {
  user: {
    id: string;
    name: string;
    email: string;
    isActive: boolean;
    homeBranchId: string | null;
    homeBranch?: ClientBranch | null;
  };
  role: {
    id: string;
    key: string | null;
    name: string;
    isSystem: boolean;
    archived: boolean;
  };
  grants: Grant[];
  policyVersion: number;
  mustResetPassword: boolean;
}

export interface ClientPolicy {
  user: ClientPolicyResponseData["user"];
  role: ClientPolicyResponseData["role"];
  grants: Grant[];
  policyVersion: number;
  mustResetPassword: boolean;
}

export interface PolicyFetchOutcome {
  ok: boolean;
  status: number;
  data: ClientPolicyResponseData | null;
}

/** Derive the client policy state from one /api/admin/policy/me outcome. */
export function derivePolicyState(
  outcome: PolicyFetchOutcome,
  stalePolicy?: ClientPolicy | null
): { status: ClientPolicyStatus; policy: ClientPolicy | null } {
  // A resolved-but-denied answer (403: missing/archived Role assignment or
  // inactive user from the server resolver) is a *resolved* no-access
  // state, not a refresh failure.
  if (outcome.ok && outcome.status === 403) {
    return { status: "no-access", policy: null };
  }

  if (!outcome.ok || outcome.status !== 200 || !outcome.data) {
    // Failed refresh: stale policy and protected navigation/data are
    // cleared — nothing stale survives into the Policy-Unavailable state.
    return { status: "unavailable", policy: null };
  }

  const policy: ClientPolicy = {
    user: outcome.data.user,
    role: outcome.data.role,
    grants: outcome.data.grants ?? [],
    policyVersion: outcome.data.policyVersion,
    mustResetPassword: outcome.data.mustResetPassword,
  };

  return {
    // The System Owner bypass is code-owned: zero grant rows still grant
    // full access, so the Owner must resolve to ready, never no-access.
    status:
      hasAnyViewGrant(policy) || policy.role.key === SYSTEM_OWNER_KEY
        ? "ready"
        : "no-access",
    policy,
  };
}

/** True when the policy contains at least one view grant (any scope). */
export function hasAnyViewGrant(policy: ClientPolicy | null): boolean {
  if (!policy) return false;
  return policy.grants.some((grant) => grant.action === "view");
}

/**
 * Client-side authorization check against the loaded Current Policy.
 * Mirrors the server resolver's pure decision (including the System Owner
 * code-owned bypass). Client checks drive UI affordances only — the
 * server remains authoritative on every request.
 */
export function policyAuthorizes(
  policy: ClientPolicy | null | undefined,
  module: ModuleKey,
  action: ActionKey
): boolean {
  if (!policy) return false;
  const serverPolicy: Policy = {
    user: {
      isActive: policy.user.isActive,
      homeBranchId: policy.user.homeBranchId,
    },
    role: {
      key: policy.role.key ?? "",
      isSystem: policy.role.isSystem,
      archived: policy.role.archived,
      grants: policy.grants,
    },
  };
  return authorize(serverPolicy, module, action).allowed;
}

// =========================================================
// 403-aware fetch: centralized revalidation trigger
// =========================================================

/** Window event dispatched after any 403 so policy revalidates without logout. */
export const POLICY_REVALIDATE_EVENT = "rbac:policy-revalidate";

export type FetchLike = typeof fetch;

/**
 * Wrap fetch so any 403 (module denial, ceiling violation, stale version is
 * 409 and unaffected, policy admission change) triggers a policy
 * revalidation through the centralized event — without logging the user
 * out. All policy-aware client data fetching goes through this wrapper.
 */
export function createPolicyAwareFetch(
  fetchImpl: FetchLike = fetch,
  dispatch: (event: string) => void = (name) => {
    if (typeof window !== "undefined") window.dispatchEvent(new Event(name));
  }
): FetchLike {
  return async (input, init) => {
    const response = await fetchImpl(input, init);
    if (response.status === 403) {
      dispatch(POLICY_REVALIDATE_EVENT);
    }
    return response;
  };
}
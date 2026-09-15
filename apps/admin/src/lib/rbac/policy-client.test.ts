import { describe, expect, it, vi } from "vitest";
import {
  derivePolicyState,
  policyAuthorizes,
  hasAnyViewGrant,
  createPolicyAwareFetch,
  POLICY_REVALIDATE_EVENT,
  type ClientPolicyResponseData,
} from "./policy-client";
import type { Grant } from "@marketplace/db/src/rbac/catalog";

const grant = (
  module: string,
  action: string,
  scope: string
): Grant => ({ module, action, scope } as Grant);

const policyData = (
  grants: Grant[],
  overrides: Partial<ClientPolicyResponseData> = {}
): ClientPolicyResponseData =>
  ({
    user: {
      id: "u1",
      name: "Rina",
      email: "rina@example.test",
      isActive: true,
      homeBranchId: "b1",
    },
    role: {
      id: "r1",
      key: null,
      name: "Admin Cabang",
      isSystem: false,
      archived: false,
    },
    grants,
    policyVersion: 3,
    mustResetPassword: false,
    ...overrides,
  }) as ClientPolicyResponseData;

// =========================================================
// derivePolicyState — the client policy state machine
// =========================================================
describe("derivePolicyState", () => {
  it("resolves a policy with view grants to ready", () => {
    const result = derivePolicyState({
      ok: true,
      status: 200,
      data: policyData([grant("products", "view", "own_branch")]),
    });
    expect(result.status).toBe("ready");
    expect(result.policy?.role.name).toBe("Admin Cabang");
    expect(result.policy?.policyVersion).toBe(3);
  });

  it("resolves a resolved policy with NO view grants to no-access", () => {
    const result = derivePolicyState({
      ok: true,
      status: 200,
      data: policyData([grant("products", "edit", "all_branches")]),
    });
    expect(result.status).toBe("no-access");
    // The policy itself is still known and rendered by the No-Access state.
    expect(result.policy?.role.name).toBe("Admin Cabang");
  });

  it("treats a 403 policy/me denial (no resolvable policy) as no-access", () => {
    const result = derivePolicyState({ ok: true, status: 403, data: null });
    expect(result.status).toBe("no-access");
    expect(result.policy).toBeNull();
  });

  it("clears stale policy on a network failure (unavailable)", () => {
    const stale = derivePolicyState({
      ok: true,
      status: 200,
      data: policyData([grant("products", "view", "own_branch")]),
    });
    expect(stale.status).toBe("ready");

    const result = derivePolicyState(
      { ok: false, status: 0, data: null },
      stale.policy
    );
    expect(result.status).toBe("unavailable");
    // No stale protected navigation/data survives the failed refresh.
    expect(result.policy).toBeNull();
  });

  it("clears stale policy on a 5xx failure (unavailable)", () => {
    const result = derivePolicyState(
      { ok: true, status: 500, data: null },
      policyData([grant("products", "view", "own_branch")]) as unknown as never
    );
    expect(result.status).toBe("unavailable");
    expect(result.policy).toBeNull();
  });

  it("treats 401 as unavailable (session no longer admitted)", () => {
    const result = derivePolicyState({ ok: true, status: 401, data: null });
    expect(result.status).toBe("unavailable");
    expect(result.policy).toBeNull();
  });
});

// =========================================================
// Client-side authorization against the loaded policy
// =========================================================
describe("policyAuthorizes", () => {
  it("allows a granted own-branch view and denies absent grants", () => {
    const policy = derivePolicyState({
      ok: true,
      status: 200,
      data: policyData([grant("products", "view", "own_branch")]),
    }).policy!;

    expect(policyAuthorizes(policy, "products", "view")).toBe(true);
    expect(policyAuthorizes(policy, "orders", "view")).toBe(false);
  });

  it("gives the System Owner the code-owned full bypass despite no grant rows", () => {
    const policy = derivePolicyState({
      ok: true,
      status: 200,
      data: policyData([], {
        role: {
          id: "r-owner",
          key: "system_owner",
          name: "System Owner",
          isSystem: true,
          archived: false,
        },
        user: {
          id: "u-owner",
          name: "Owner",
          email: "owner@example.test",
          isActive: true,
          homeBranchId: null,
        },
      }),
    }).policy!;

    expect(policyAuthorizes(policy, "users", "delete")).toBe(true);
    expect(policyAuthorizes(policy, "orders", "edit")).toBe(true);
    // Zero grant rows — access is code-owned, not grant-backed.
    expect(policy.grants).toHaveLength(0);
  });
});

// =========================================================
// 403-aware fetch wrapper: revalidate after a 403, never logout
// =========================================================
describe("createPolicyAwareFetch", () => {
  it("dispatches the revalidate trigger after a 403 response", async () => {
    const dispatch = vi.fn();
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ status: 403, json: async () => ({}) });

    const fetcher = createPolicyAwareFetch(
      fetchMock as unknown as typeof fetch,
      dispatch
    );
    await fetcher("/api/admin/roles");

    expect(dispatch).toHaveBeenCalledWith(POLICY_REVALIDATE_EVENT);
  });

  it("does not dispatch after a 200 response", async () => {
    const dispatch = vi.fn();
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ status: 200, json: async () => ({}) });

    const fetcher = createPolicyAwareFetch(
      fetchMock as unknown as typeof fetch,
      dispatch
    );
    await fetcher("/api/admin/roles");

    expect(dispatch).not.toHaveBeenCalled();
  });
});
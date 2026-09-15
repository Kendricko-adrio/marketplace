/* eslint-disable react-hooks/set-state-in-effect */
"use client";
import {
  createContext,
  useContext,
  ReactNode,
  useEffect,
  useState,
  useCallback,
  useRef,
} from "react";
import { usePathname } from "next/navigation";
import { useSession as useBetterAuthSession } from "@/lib/auth-client";
import {
  derivePolicyState,
  policyAuthorizes,
  createPolicyAwareFetch,
  POLICY_REVALIDATE_EVENT,
  type ClientPolicy,
  type ClientPolicyStatus,
  type ClientPolicyResponseData,
} from "@/lib/rbac/policy-client";
import type { ActionKey, ModuleKey } from "@marketplace/db/src/rbac/catalog";

interface User {
  id: string;
  name: string;
  email: string;
  image?: string | null;
  [key: string]: unknown;
}

interface Session {
  user: User;
}

interface BranchInfo {
  id: string;
  name: string;
  code: string;
  city: string;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  /** Client mirror of the server-resolved Current Policy. */
  policy: ClientPolicy | null;
  policyStatus: ClientPolicyStatus;
  /** Revalidate the policy on demand (retry / 403 recovery). */
  refreshPolicy: () => Promise<void>;
  /** UI affordance check — the server stays authoritative per request. */
  hasPermission: (moduleName: ModuleKey, action: ActionKey) => boolean;
  /** Compatibility alias: true while the policy has not resolved yet. */
  permissionsLoading: boolean;
  branch: BranchInfo | null;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  isLoading: true,
  isAuthenticated: false,
  policy: null,
  policyStatus: "loading",
  refreshPolicy: async () => {},
  hasPermission: () => false,
  permissionsLoading: true,
  branch: null,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const { data: session, isPending } = useBetterAuthSession();
  const user = (session?.user as User | undefined) ?? null;
  const userId = user?.id;
  const pathname = usePathname();

  const [policy, setPolicy] = useState<ClientPolicy | null>(null);
  const [policyStatus, setPolicyStatus] =
    useState<ClientPolicyStatus>("loading");

  // Race guard: only the newest refresh may commit its result.
  const requestIdRef = useRef(0);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refreshPolicy = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    try {
      // The policy-aware fetch triggers a centralized revalidate event after
      // any 403 — a policy change is picked up without logging the user out.
      const policyFetch = createPolicyAwareFetch();
      const res = await policyFetch("/api/admin/policy/me");
      let body: { success: boolean; data?: ClientPolicyResponseData } | null =
        null;
      try {
        body = await res.json();
      } catch {
        body = null;
      }
      if (!mountedRef.current || requestId !== requestIdRef.current) return;
      const next = derivePolicyState(
        {
          ok: res.ok,
          status: res.status,
          data: body?.data ?? null,
        },
        policy
      );
      setPolicy(next.policy);
      setPolicyStatus(next.status);
    } catch {
      // Network failure: stale policy is cleared — nothing stale survives.
      if (!mountedRef.current || requestId !== requestIdRef.current) return;
      setPolicy(null);
      setPolicyStatus("unavailable");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load the policy when the session identity changes; clear it on sign-out.
  useEffect(() => {
    if (!userId) {
      requestIdRef.current += 1;
      setPolicy(null);
      setPolicyStatus("loading");
      return;
    }
    void refreshPolicy();
  }, [userId, refreshPolicy]);

  // Centralized revalidation triggers — the policy is resolved from the
  // database on every server request; this mirror only drives UI affordances:
  // 1. App Router navigation (pathname change)
  // 2. window focus / tab visibility
  // 3. after any 403 (POLICY_REVALIDATE_EVENT via the policy-aware fetch)
  useEffect(() => {
    if (!userId) return;
    void refreshPolicy();
  }, [userId, pathname, refreshPolicy]);

  useEffect(() => {
    if (!userId) return;
    const onFocus = () => void refreshPolicy();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener(POLICY_REVALIDATE_EVENT, onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener(POLICY_REVALIDATE_EVENT, onFocus);
    };
  }, [userId, refreshPolicy]);

  const hasPermission = useCallback(
    (moduleName: ModuleKey, action: ActionKey): boolean =>
      policyAuthorizes(policy, moduleName, action),
    [policy]
  );

  const value: AuthContextType = {
    user: user || null,
    session: session || null,
    isLoading: isPending,
    isAuthenticated: !!user,
    policy,
    policyStatus,
    refreshPolicy,
    hasPermission,
    permissionsLoading: policyStatus === "loading",
    branch: policy?.user.homeBranch ?? null,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
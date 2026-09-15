"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/providers/auth-provider";
import { PolicySafeState } from "./PolicySafeState";

// =========================================================
// PolicyGate — clears stale protected content on unsafe policy states
// =========================================================
// While the policy is `no-access` or `unavailable`, protected children are
// NOT rendered: a failed policy refresh clears stale protected
// navigation/data and shows the distinct Policy-Unavailable state, and a
// resolved policy without view grants shows the No-Access state. The
// `/admin/no-access` route renders the same UI standalone for direct
// redirects from server pages.
//
// Loading and ready states render children untouched. The login page and
// other non-/admin paths are never gated (the middleware and server layout
// remain authoritative for admission).

export function PolicyGate({ children }: { children: ReactNode }) {
  const { policyStatus, isLoading } = useAuth();
  const pathname = usePathname();

  if (pathname.startsWith("/admin")) {
    if (policyStatus === "no-access" || policyStatus === "unavailable") {
      return (
        <main className="flex min-h-screen items-center justify-center p-6">
          <PolicySafeState />
        </main>
      );
    }
    if (isLoading && policyStatus === "loading") {
      // Still resolving on first load — render children (the server layout
      // has already admitted the session); links stay in a loading state.
      return <>{children}</>;
    }
  }

  return <>{children}</>;
}
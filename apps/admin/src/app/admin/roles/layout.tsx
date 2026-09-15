import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { pagePolicyGuard } from "@/lib/rbac/page-guard";

// =========================================================
// RBAC: /admin/roles/* layout — server-authoritative Roles gate
// =========================================================
// The old HQ-only hardcoded gate is replaced by the Current Policy: a page
// requires the `roles:view` grant. Users without it are sent to the shared
// No-Access page; System Owners and any Role with roles:view pass. The
// server layout remains authoritative — client policy only drives
// affordances.

export default async function RolesLayout({
  children,
}: {
  children: ReactNode;
}) {
  const result = await pagePolicyGuard("roles", "view");

  if (!result.ok) {
    if (result.reason === "unauthenticated") {
      redirect("/login?callbackUrl=/admin/roles");
    }
    if (result.reason === "must_reset_password") {
      redirect("/reset-password?force=1");
    }
    redirect("/admin/no-access");
  }

  return <>{children}</>;
}
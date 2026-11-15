import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { pagePolicyGuard } from "@/lib/rbac/page-guard";

// =========================================================
// RBAC: /admin/discounts/* layout — server-authoritative Discounts gate
// =========================================================
// A page requires `discounts:view`; writes are re-authorized per request by the
// API (and re-read inside the write transaction). Client policy only drives
// affordances. Users without the grant go to the shared No-Access page.

export default async function DiscountsLayout({
  children,
}: {
  children: ReactNode;
}) {
  const result = await pagePolicyGuard("discounts", "view");

  if (!result.ok) {
    if (result.reason === "unauthenticated") {
      redirect("/login?callbackUrl=/admin/discounts");
    }
    if (result.reason === "must_reset_password") {
      redirect("/reset-password?force=1");
    }
    redirect("/admin/no-access");
  }

  return <>{children}</>;
}

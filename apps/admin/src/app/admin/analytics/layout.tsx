import { pagePermissionOrRedirect } from "@/lib/rbac/page-guard";

// Policy gate: all /admin/analytics/* routes require the `analytics:view`
// grant from the Current Policy (server-authoritative per navigation).
export default async function AnalyticsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await pagePermissionOrRedirect("analytics", "view", "/admin/analytics");
  return <>{children}</>;
}
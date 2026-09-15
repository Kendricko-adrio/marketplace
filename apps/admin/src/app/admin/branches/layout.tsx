import { pagePermissionOrRedirect } from "@/lib/rbac/page-guard";

// Policy gate: all /admin/branches/* routes require the `branches:view`
// grant from the Current Policy (server-authoritative per navigation).
export default async function BranchesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await pagePermissionOrRedirect("branches", "view", "/admin/branches");
  return <>{children}</>;
}
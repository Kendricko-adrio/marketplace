import { pagePermissionOrRedirect } from "@/lib/rbac/page-guard";

// Policy gate: all /admin/homepage/* routes require the global
// `homepage:view` grant from the Current Policy (server-authoritative
// per navigation).
export default async function HomepageLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await pagePermissionOrRedirect("homepage", "view", "/admin/homepage");
  return <>{children}</>;
}
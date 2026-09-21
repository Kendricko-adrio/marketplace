import { pagePermissionOrRedirect } from "@/lib/rbac/page-guard";

// Policy gate: all /admin/pages/* routes require the `pages:view` grant
// from the Current Policy (server-authoritative per navigation).
export default async function PagesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await pagePermissionOrRedirect("pages", "view", "/admin/pages");
  return <>{children}</>;
}

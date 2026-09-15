import { pagePermissionOrRedirect } from "@/lib/rbac/page-guard";

// Policy gate: all /admin/footer/* routes require the `footer:view` grant
// from the Current Policy (server-authoritative per navigation). Editing is
// gated separately by footer:edit at the API and client affordances.
export default async function FooterLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await pagePermissionOrRedirect("footer", "view", "/admin/footer");
  return <>{children}</>;
}
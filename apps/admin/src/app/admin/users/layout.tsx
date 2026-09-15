import { pagePermissionOrRedirect } from "@/lib/rbac/page-guard";

// Policy gate: all /admin/users/* routes require the `users:view` grant
// from the Current Policy (server-authoritative per navigation).
export default async function UsersLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await pagePermissionOrRedirect("users", "view", "/admin/users");
  return <>{children}</>;
}

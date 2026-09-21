import { pagePermissionOrRedirect } from "@/lib/rbac/page-guard";

// Policy gate: the Customer Directory requires the global `customers:view`
// grant from the Current Policy (server-authoritative per navigation).
export default async function CustomersLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await pagePermissionOrRedirect("customers", "view", "/admin/customers");
  return <>{children}</>;
}
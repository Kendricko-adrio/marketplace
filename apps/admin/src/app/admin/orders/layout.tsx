import { pagePermissionOrRedirect } from "@/lib/rbac/page-guard";

// Policy gate: all /admin/orders/* routes require the `orders:view` grant
// from the Current Policy (server-authoritative per navigation).
export default async function OrdersLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await pagePermissionOrRedirect("orders", "view", "/admin/orders");
  return <>{children}</>;
}
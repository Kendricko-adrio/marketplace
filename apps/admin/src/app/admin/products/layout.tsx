import { pagePermissionOrRedirect } from "@/lib/rbac/page-guard";

// Policy gate: all /admin/products/* routes require the `products:view` grant
// from the Current Policy (server-authoritative per navigation).
export default async function ProductsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await pagePermissionOrRedirect("products", "view", "/admin/products");
  return <>{children}</>;
}

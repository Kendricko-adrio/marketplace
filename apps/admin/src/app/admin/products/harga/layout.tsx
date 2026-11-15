import { pagePermissionOrRedirect } from "@/lib/rbac/page-guard";

// Policy gate: the Markdown price panel requires `prices:view`; every write is
// re-authorized per API request and re-read inside the apply transaction.
export default async function PricesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await pagePermissionOrRedirect("prices", "view", "/admin/products/harga");
  return <>{children}</>;
}

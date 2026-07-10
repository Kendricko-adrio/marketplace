import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { checkPermission, getPermissionsForRole } from "@/lib/permissions";

// Permission gate: all /admin/products/* routes require canView on products module.
export default async function ProductsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    redirect("/login?callbackUrl=/admin/products");
  }

  const permissions = await getPermissionsForRole(session.user.role);
  if (!checkPermission(permissions, "products", "view")) {
    redirect("/admin?error=forbidden");
  }

  return <>{children}</>;
}

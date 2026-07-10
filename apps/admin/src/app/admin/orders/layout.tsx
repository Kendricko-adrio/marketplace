import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { checkPermission, getPermissionsForRole } from "@/lib/permissions";

// Permission gate: all /admin/orders/* routes require canView on orders module.
export default async function OrdersLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    redirect("/login?callbackUrl=/admin/orders");
  }

  const permissions = await getPermissionsForRole(session.user.role);
  if (!checkPermission(permissions, "orders", "view")) {
    redirect("/admin?error=forbidden");
  }

  return <>{children}</>;
}

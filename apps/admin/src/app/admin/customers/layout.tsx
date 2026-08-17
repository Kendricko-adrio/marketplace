import { auth } from "@/lib/auth";
import { checkPermission, getPermissionsForRole } from "@/lib/permissions";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

export default async function CustomersLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login?callbackUrl=/admin/customers");

  const permissions = await getPermissionsForRole(session.user.role);
  if (!checkPermission(permissions, "customers", "view")) {
    redirect("/admin?error=forbidden");
  }

  return <>{children}</>;
}

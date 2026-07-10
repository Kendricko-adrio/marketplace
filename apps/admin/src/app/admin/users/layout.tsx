import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { checkPermission, getPermissionsForRole } from "@/lib/permissions";

// Permission gate: all /admin/users/* routes require canView on users module.
export default async function UsersLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    redirect("/login?callbackUrl=/admin/users");
  }

  const permissions = await getPermissionsForRole(session.user.role);
  if (!checkPermission(permissions, "users", "view")) {
    redirect("/admin?error=forbidden");
  }

  return <>{children}</>;
}

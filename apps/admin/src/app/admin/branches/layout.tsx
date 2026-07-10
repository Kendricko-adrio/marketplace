import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { checkPermission, getPermissionsForRole } from "@/lib/permissions";

// Permission gate: all /admin/branches/* routes require canView on branches module.
export default async function BranchesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    redirect("/login?callbackUrl=/admin/branches");
  }

  const permissions = await getPermissionsForRole(session.user.role);
  if (!checkPermission(permissions, "branches", "view")) {
    redirect("/admin?error=forbidden");
  }

  return <>{children}</>;
}

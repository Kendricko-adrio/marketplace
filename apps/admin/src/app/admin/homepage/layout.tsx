import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { checkPermission, getPermissionsForRole } from "@/lib/permissions";

// Permission gate: all /admin/homepage/* routes require canView on homepage module.
export default async function HomepageLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    redirect("/login?callbackUrl=/admin/homepage");
  }

  const permissions = await getPermissionsForRole(session.user.role);
  if (!checkPermission(permissions, "homepage", "view")) {
    redirect("/admin?error=forbidden");
  }

  return <>{children}</>;
}

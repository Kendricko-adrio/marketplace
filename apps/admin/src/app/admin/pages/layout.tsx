import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { checkPermission, getPermissionsForRole } from "@/lib/permissions";

// Permission gate: all /admin/pages/* routes require canView on pages module.
export default async function PagesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    redirect("/login?callbackUrl=/admin/pages");
  }

  const permissions = await getPermissionsForRole(session.user.role);
  if (!checkPermission(permissions, "pages", "view")) {
    redirect("/admin?error=forbidden");
  }

  return <>{children}</>;
}

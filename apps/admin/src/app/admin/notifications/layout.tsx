import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { checkPermission, getPermissionsForRole } from "@/lib/permissions";

export default async function NotificationsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    redirect("/login?callbackUrl=/admin/notifications");
  }

  const permissions = await getPermissionsForRole(session.user.role);
  if (!checkPermission(permissions, "notifications", "view")) {
    redirect("/admin?error=forbidden");
  }

  return <>{children}</>;
}

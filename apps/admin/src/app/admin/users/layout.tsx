import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

// HQ-only gate: all /admin/users/* routes require the "hq" role.
// Non-HQ admins are redirected to the dashboard.
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

  if (session.user.role !== "hq") {
    redirect("/admin?error=forbidden");
  }

  return <>{children}</>;
}
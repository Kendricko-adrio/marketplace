import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

// HQ-only hardcoded gate for the RBAC management page (anti-lockout).
export default async function RolesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    redirect("/login?callbackUrl=/admin/roles");
  }

  if (session.user.role !== "hq") {
    redirect("/admin?error=forbidden");
  }

  return <>{children}</>;
}

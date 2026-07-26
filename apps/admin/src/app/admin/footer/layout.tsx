import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

// HQ-only hardcoded gate for the footer CMS page.
// Footer content affects every storefront page, so only HQ may edit it.
export default async function FooterLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    redirect("/login?callbackUrl=/admin/footer");
  }

  if (session.user.role !== "hq") {
    redirect("/admin?error=forbidden");
  }

  return <>{children}</>;
}
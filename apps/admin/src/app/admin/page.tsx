import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getFirstViewableModule, getPermissionsForRole } from "@/lib/permissions";

// Force dynamic rendering so the RSC payload (which may contain a redirect to
// /login when unauthenticated) is never cached by the Next.js client-side
// Router Cache. Without this, a cached "/admin -> /login" redirect can be
// replayed right after a successful login, making the login appear to fail
// until the user clicks the button a second time.
export const dynamic = "force-dynamic";

// Redirect to the first module the user is allowed to view.
// If no module is viewable, render a no-access page.
export default async function AdminDashboard() {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) {
    redirect("/login?callbackUrl=/admin");
  }

  const permissions = await getPermissionsForRole(session.user.role);
  const firstModule = getFirstViewableModule(permissions);

  if (firstModule) {
    redirect(`/admin/${firstModule}`);
  }

  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-foreground">Akses Terbatas</h1>
        <p className="mt-2 text-muted-foreground">
          Akun Anda tidak memiliki akses ke modul admin manapun.
          Hubungi HQ untuk mengatur permission.
        </p>
      </div>
    </div>
  );
}

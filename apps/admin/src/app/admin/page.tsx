import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import {
  admissionDecision,
  authorizeLoaded,
  loadPolicy,
} from "@/lib/rbac/resolver";

// Force dynamic rendering so the RSC payload (which may contain a redirect to
// /login when unauthenticated) is never cached by the Next.js client-side
// Router Cache. Without this, a cached "/admin -> /login" redirect can be
// replayed right after a successful login, making the login appear to fail
// until the user clicks the button a second time.
export const dynamic = "force-dynamic";

// Landing module preference order (only modules that have an /admin route;
// audit_log has no dedicated page). The first module the Current Policy
// authorizes for `view` wins.
const LANDING_MODULES = [
  "products",
  "orders",
  "notifications",
  "branches",
  "analytics",
  "customers",
  "homepage",
  "pages",
  "users",
  "roles",
  "footer",
] as const;

// Redirect to the first module the user's Current Policy allows viewing.
// If no module is viewable, render a no-access screen.
export default async function AdminDashboard() {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) {
    redirect("/login?callbackUrl=/admin");
  }

  const policy = await loadPolicy(session.user.id);
  const admitted =
    policy &&
    admissionDecision({
      isActive: policy.user.isActive,
      roleId: policy.role.id,
      roleExists: true,
      roleArchived: policy.role.archived,
    }).admitted;

  if (admitted && policy) {
    for (const moduleName of LANDING_MODULES) {
      if (authorizeLoaded(policy, moduleName, "view").allowed) {
        redirect(`/admin/${moduleName}`);
      }
    }
  }

  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-foreground">Akses Terbatas</h1>
        <p className="mt-2 text-muted-foreground">
          Akun Anda tidak memiliki akses ke modul admin manapun. Hubungi
          pemilik sistem untuk pengaturan Role.
        </p>
      </div>
    </div>
  );
}

import AdminSidebar from "@/components/AdminSidebar";
import NotificationBell from "@/components/NotificationBell";
import { NotificationProvider } from "@/providers/notification-provider";
import { auth } from "@/lib/auth";
import { loadPolicy } from "@/lib/rbac/resolver";
import { createModuleLogger } from "@/lib/logger";
import { SYSTEM_OWNER_KEY } from "@marketplace/db/src/rbac/catalog";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

/**
 * Module-scoped logger for the admin shell: one instance per server runtime,
 * correlation fields read per emission from the active scope (a layout render
 * has no HTTP scope of its own, so `requestId` is legitimately `null` there).
 * The acting ids travel in the `message`; no name, email or session material.
 */
const log = createModuleLogger("admin-layout");

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login?callbackUrl=/admin");
  if (session.user.mustResetPassword) redirect("/reset-password?force=1");

  // Policy-based placement check (no role-name branches): every non-Owner
  // Admin User must have a Home Branch. System Owners are branch-free by
  // design; an unresolvable policy is left to the child module layouts,
  // which deny via the Current Policy.
  const policy = await loadPolicy(session.user.id);
  if (
    policy &&
    policy.role.key !== SYSTEM_OWNER_KEY &&
    !policy.user.homeBranchId
  ) {
    log.warn(
      `admin.layout.missing_home_branch (userId ${policy.user.id}, roleId ${policy.role.id}, outcome denied)`
    );
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <div className="max-w-lg rounded-lg border bg-background p-8 text-center shadow-sm">
          <h1 className="text-xl font-semibold">Akses cabang belum tersedia</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Akun admin ini belum terhubung ke cabang. Hubungi HQ untuk
            menetapkan cabang sebelum melanjutkan.
          </p>
        </div>
      </main>
    );
  }

  return (
    <NotificationProvider>
      {/* App shell: the viewport is the fixed frame (md+) so the sidebar and
          the header stay put and only <main> scrolls. On mobile the shell
          keeps growing with content and the page scrolls as usual. */}
      <div className="flex min-h-dvh flex-col bg-muted/20 md:h-dvh md:min-h-0 md:flex-row md:overflow-hidden">
        <AdminSidebar />
        <div className="min-w-0 flex-1 flex flex-col transition-all duration-300 ease-in-out pl-0 md:min-h-0">
          <header className="z-30 flex h-16 shrink-0 items-center border-b bg-background px-6 shadow-sm">
            <h1 className="text-xl font-bold text-foreground">Admin Dashboard</h1>
            <div className="ml-auto flex items-center gap-4">
              <NotificationBell />
            </div>
          </header>
          {/* `relative` makes <main> the containing block for absolutely
              positioned descendants (e.g. `sr-only` helpers inside checkboxes
              and accessible fallback tables). Without it they fall back to the
              initial containing block, escape this scroll container's clipping
              and grow the document scroll area. */}
          <main className="relative min-w-0 flex-1 p-4 md:min-h-0 md:overflow-y-auto md:p-8">{children}</main>
        </div>
      </div>
    </NotificationProvider>
  );
}
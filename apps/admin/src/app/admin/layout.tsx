import AdminSidebar from "@/components/AdminSidebar";
import NotificationBell from "@/components/NotificationBell";
import { NotificationProvider } from "@/providers/notification-provider";
import { auth } from "@/lib/auth";
import { loadPolicy } from "@/lib/rbac/resolver";
import { createLogger } from "@/lib/logger";
import { SYSTEM_OWNER_KEY } from "@marketplace/db/src/rbac/catalog";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

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
    createLogger({ route: "admin_layout" }).warn("admin.layout.missing_home_branch", {
      outcome: "denied",
      userId: policy.user.id,
      roleId: policy.role.id,
    });
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
      <div className="flex min-h-screen bg-muted/20">
        <AdminSidebar />
        <div className="flex-1 flex flex-col transition-all duration-300 ease-in-out pl-0">
          <header className="sticky top-0 z-30 flex h-16 items-center border-b bg-background px-6 shadow-sm">
            <h1 className="text-xl font-bold text-foreground">Admin Dashboard</h1>
            <div className="ml-auto flex items-center gap-4">
              <NotificationBell />
            </div>
          </header>
          <main className="flex-1 p-6 md:p-8 overflow-y-auto">{children}</main>
        </div>
      </div>
    </NotificationProvider>
  );
}
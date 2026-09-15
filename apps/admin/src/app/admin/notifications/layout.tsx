import { pagePermissionOrRedirect } from "@/lib/rbac/page-guard";

// Policy gate: all /admin/notifications/* routes require the
// `notifications:view` grant from the Current Policy (server-authoritative
// per navigation).
export default async function NotificationsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await pagePermissionOrRedirect("notifications", "view", "/admin/notifications");
  return <>{children}</>;
}
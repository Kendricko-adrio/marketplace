"use client";
import AdminSidebar from "@/components/AdminSidebar";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen bg-muted/20">
      <AdminSidebar />
      <div className="flex-1 flex flex-col transition-all duration-300 ease-in-out pl-0">
        <header className="sticky top-0 z-30 flex h-16 items-center border-b bg-background px-6 shadow-sm">
          <h1 className="text-xl font-bold text-foreground">Admin Dashboard</h1>
          <div className="ml-auto flex items-center gap-4">
            {/* Add Header Actions here (Notifications, User Profile) */}
          </div>
        </header>
        <main className="flex-1 p-6 md:p-8 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}

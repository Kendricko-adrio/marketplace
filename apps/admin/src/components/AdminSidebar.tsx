"use client";
import React, { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import {
  Package,
  ShoppingBag,
  Users,
  Store,
  LayoutTemplate,
  FileText,
  Shield,
  LogOut,
  Loader2,
  ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Avatar,
  AvatarFallback,
} from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/providers/auth-provider";
import { signOut } from "@/lib/auth-client";

// Returns false during SSR and the first client render, then true.
// This is the React-recommended way to detect client-side mounting without
// a hydration mismatch or a set-state-in-effect lint error.
function useIsMounted(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
}

export default function AdminSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, hasPermission, permissionsLoading } = useAuth();
  const [loggingOut, setLoggingOut] = useState(false);
  const mounted = useIsMounted();

  type SidebarLink = {
    href: string;
    label: string;
    icon: React.ComponentType<{ size?: number }>;
    module?: "products" | "orders" | "branches" | "homepage" | "pages" | "users";
    hqOnly?: boolean;
  };

  const links: SidebarLink[] = [
    { href: "/admin/products", label: "Produk", icon: Package, module: "products" },
    { href: "/admin/orders", label: "Pesanan", icon: ShoppingBag, module: "orders" },
    { href: "/admin/branches", label: "Cabang", icon: Store, module: "branches" },
    { href: "/admin/homepage", label: "Homepage", icon: LayoutTemplate, module: "homepage" },
    { href: "/admin/pages", label: "Halaman", icon: FileText, module: "pages" },
    { href: "/admin/users", label: "Pengguna", icon: Users, module: "users" },
    { href: "/admin/roles", label: "Hak Akses", icon: Shield, hqOnly: true },
  ];

  const visibleLinks = links.filter((link) => {
    if (link.hqOnly) return user?.role === "hq";
    if (permissionsLoading) return true; // show skeleton until permissions load
    if (!link.module) return false;
    return hasPermission(link.module, "view");
  });

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await signOut();
      // Clear any must-reset edge cookie so it doesn't leak across sessions
      document.cookie = "admin.must_reset=; path=/; max-age=0";
      router.push("/login");
      router.refresh();
    } catch (err) {
      console.error("Logout error:", err);
      setLoggingOut(false);
    }
  };

  // Until mounted, use stable placeholder values so SSR and the first client
  // render produce identical markup (avoids hydration mismatch).
  const initial = mounted ? (user?.name?.charAt(0) || "A").toUpperCase() : "A";
  const displayName = mounted ? user?.name || "Admin" : "Admin";
  const roleLabel = mounted ? (user?.role === "hq" ? "HQ" : "Admin Cabang") : "Admin Cabang";
  const displayEmail = mounted ? user?.email || displayName : "";

  return (
    <aside className="w-64 h-screen bg-card text-muted-foreground flex flex-col sticky top-0 border-r">
      <div className="p-6 text-xl font-bold text-foreground border-b">
        Admin<span className="text-primary">Panel</span>
      </div>

      <nav className="flex-1 p-4 flex flex-col gap-2">
        {visibleLinks.map((link) => {
          const Icon = link.icon;
          // Exact match for /admin, startsWith for sub-routes
          const isActive =
            link.href === "/admin"
              ? pathname === "/admin"
              : pathname.startsWith(link.href);

          return (
            <Link key={link.href} href={link.href}>
              <Button
                variant="ghost"
                className={cn(
                  "w-full justify-start gap-3",
                  isActive
                    ? "bg-primary text-primary-foreground hover:bg-primary/90"
                    : "hover:bg-accent hover:text-accent-foreground",
                  permissionsLoading && link.module && "opacity-60"
                )}
              >
                <Icon size={20} />
                <span>{link.label}</span>
              </Button>
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t">
        {mounted ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-3 w-full text-left hover:bg-accent rounded-md p-2 transition-colors">
                <Avatar className="h-10 w-10">
                  <AvatarFallback className="bg-primary text-primary-foreground font-bold">
                    {initial}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-foreground truncate">
                    {displayName}
                  </div>
                  <div className="text-xs truncate">{roleLabel}</div>
                </div>
                <ChevronDown className="h-4 w-4 shrink-0" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuLabel className="truncate">
                {displayEmail || displayName}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive cursor-pointer"
                onClick={handleLogout}
                disabled={loggingOut}
              >
                {loggingOut ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <LogOut className="mr-2 h-4 w-4" />
                )}
                <span>Keluar</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <div className="flex items-center gap-3 p-2">
            <Avatar className="h-10 w-10">
              <AvatarFallback className="bg-primary text-primary-foreground font-bold">
                {initial}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-foreground truncate">
                {displayName}
              </div>
              <div className="text-xs truncate">{roleLabel}</div>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
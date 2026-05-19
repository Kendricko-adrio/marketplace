"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Package,
  ShoppingBag,
  Users,
  BarChart3,
  Tag,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export default function AdminSidebar() {
  const pathname = usePathname();

  const links = [
    { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
    { href: "/admin/products", label: "Produk", icon: Package },
    { href: "/admin/orders", label: "Pesanan", icon: ShoppingBag },
    { href: "/admin/marketing", label: "Marketing", icon: Tag },
    { href: "/admin/users", label: "Pengguna", icon: Users },
    { href: "/admin/analytics", label: "Analitik", icon: BarChart3 },
  ];

  return (
    <aside className="w-64 h-screen bg-slate-900 text-slate-400 flex flex-col sticky top-0">
      <div className="p-6 text-xl font-bold text-white border-b border-slate-800">
        Admin<span className="text-primary">Panel</span>
      </div>

      <nav className="flex-1 p-4 flex flex-col gap-2">
        {links.map((link) => {
          const Icon = link.icon;
          const isActive = pathname === link.href;

          return (
            <Link key={link.href} href={link.href}>
              <Button
                variant="ghost"
                className={cn(
                  "w-full justify-start gap-3",
                  isActive
                    ? "bg-primary text-primary-foreground hover:bg-primary/90"
                    : "hover:bg-slate-800 hover:text-white"
                )}
              >
                <Icon size={20} />
                <span>{link.label}</span>
              </Button>
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t border-slate-800">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-primary flex items-center justify-center text-primary-foreground font-bold">
            A
          </div>
          <div>
            <div className="text-sm font-semibold text-white">Admin Toko</div>
            <div className="text-xs">Super Admin</div>
          </div>
        </div>
      </div>
    </aside>
  );
}

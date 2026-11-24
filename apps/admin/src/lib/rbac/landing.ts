import type { ModuleKey } from "@marketplace/db/src/rbac/catalog";

export interface AdminLandingRoute {
  module: ModuleKey;
  href: string;
}

/**
 * Urutan prioritas route landing admin mengikuti urutan sidebar AdminSidebar.
 * Hanya modul yang memiliki halaman `/admin/...` tersendiri yang masuk di sini
 * (`audit_log` dan `discount_capacity` tidak punya halaman landing terpisah).
 */
export const ADMIN_LANDING_ROUTES: ReadonlyArray<AdminLandingRoute> = [
  { module: "products", href: "/admin/products" },
  { module: "prices", href: "/admin/products/harga" },
  { module: "orders", href: "/admin/orders" },
  { module: "customers", href: "/admin/customers" },
  { module: "notifications", href: "/admin/notifications" },
  { module: "discounts", href: "/admin/discounts" },
  { module: "branches", href: "/admin/branches" },
  { module: "analytics", href: "/admin/analytics" },
  { module: "homepage", href: "/admin/homepage" },
  { module: "pages", href: "/admin/pages" },
  { module: "users", href: "/admin/users" },
  { module: "footer", href: "/admin/footer" },
  { module: "roles", href: "/admin/roles" },
];

/**
 * Mengembalikan `href` landing pertama yang diizinkan oleh policy user,
 * atau `null` bila user tidak memiliki izin `view` pada modul mana pun.
 */
export function resolveAdminLandingRoute(
  canView: (module: ModuleKey) => boolean
): string | null {
  for (const entry of ADMIN_LANDING_ROUTES) {
    if (canView(entry.module)) {
      return entry.href;
    }
  }
  return null;
}

import { describe, expect, it } from "vitest";
import type { ModuleKey } from "@marketplace/db/src/rbac/catalog";
import {
  ADMIN_LANDING_ROUTES,
  resolveAdminLandingRoute,
} from "@/lib/rbac/landing";

describe("resolveAdminLandingRoute", () => {
  it("mengarahkan operator yang hanya punya izin discounts ke /admin/discounts", () => {
    const target = resolveAdminLandingRoute((mod) => mod === "discounts");
    expect(target).toBe("/admin/discounts");
  });

  it("mengarahkan operator yang hanya punya izin prices ke /admin/products/harga", () => {
    const target = resolveAdminLandingRoute((mod) => mod === "prices");
    expect(target).toBe("/admin/products/harga");
  });

  it("mengembalikan null jika operator tidak punya izin view pada modul mana pun", () => {
    const target = resolveAdminLandingRoute(() => false);
    expect(target).toBeNull();
  });

  it("mengikuti urutan prioritas sidebar saat operator punya beberapa izin modul", () => {
    const allowed = new Set<ModuleKey>(["discounts", "prices", "footer"]);
    expect(resolveAdminLandingRoute((mod) => allowed.has(mod))).toBe(
      "/admin/products/harga"
    );

    const allowedLater = new Set<ModuleKey>(["roles", "discounts"]);
    expect(resolveAdminLandingRoute((mod) => allowedLater.has(mod))).toBe(
      "/admin/discounts"
    );
  });

  it("mencakup seluruh modul yang tampil di sidebar admin", () => {
    const modules = ADMIN_LANDING_ROUTES.map((entry) => entry.module);
    expect(modules).toContain("products");
    expect(modules).toContain("prices");
    expect(modules).toContain("orders");
    expect(modules).toContain("customers");
    expect(modules).toContain("notifications");
    expect(modules).toContain("discounts");
    expect(modules).toContain("branches");
    expect(modules).toContain("analytics");
    expect(modules).toContain("homepage");
    expect(modules).toContain("pages");
    expect(modules).toContain("users");
    expect(modules).toContain("footer");
    expect(modules).toContain("roles");
  });
});

import { describe, it, expect } from "vitest";
import { checkPermission, getFirstViewableModule } from "./permissions";
import { HQ_PERMISSIONS } from "./permissions-shared";
import type { PermissionMap } from "@marketplace/db/src/schema/permissions";

// Backs the admin catalog/orders/users route guards (withPermission) and the
// sidebar's first-viewable-module landing logic.

const adminMap: PermissionMap = {
  products: { canView: true, canEdit: true, canDelete: false },
  orders: { canView: true, canEdit: false, canDelete: false },
  branches: { canView: false, canEdit: false, canDelete: false },
  homepage: { canView: false, canEdit: false, canDelete: false },
  pages: { canView: false, canEdit: false, canDelete: false },
  users: { canView: false, canEdit: false, canDelete: false },
  notifications: { canView: true, canEdit: true, canDelete: true },
};

describe("checkPermission", () => {
  it("grants view/edit/delete per the map", () => {
    expect(checkPermission(adminMap, "products", "view")).toBe(true);
    expect(checkPermission(adminMap, "products", "edit")).toBe(true);
    expect(checkPermission(adminMap, "products", "delete")).toBe(false);
  });

  it("denies modules without a row (deny by default)", () => {
    expect(checkPermission(adminMap, "branches", "view")).toBe(false);
    expect(checkPermission(adminMap, "users", "edit")).toBe(false);
  });

  it("denies unknown actions", () => {
    // @ts-expect-error — unknown action is a type error, but the runtime
    // should still return false defensively.
    expect(checkPermission(adminMap, "products", "publish")).toBe(false);
  });

  it("denies when the module is missing from the map entirely", () => {
    const partial = { products: { canView: true, canEdit: false, canDelete: false } } as PermissionMap;
    expect(checkPermission(partial, "orders", "view")).toBe(false);
  });
});

describe("getFirstViewableModule", () => {
  it("returns the first module with canView", () => {
    expect(getFirstViewableModule(adminMap)).toBe("products");
  });

  it("returns null when nothing is viewable", () => {
    const none = {
      products: { canView: false, canEdit: false, canDelete: false },
      orders: { canView: false, canEdit: false, canDelete: false },
      branches: { canView: false, canEdit: false, canDelete: false },
      homepage: { canView: false, canEdit: false, canDelete: false },
      pages: { canView: false, canEdit: false, canDelete: false },
      users: { canView: false, canEdit: false, canDelete: false },
      notifications: { canView: false, canEdit: false, canDelete: false },
    } as PermissionMap;
    expect(getFirstViewableModule(none)).toBeNull();
  });
});

describe("HQ_PERMISSIONS", () => {
  it("grants HQ full access to every module", () => {
    for (const perms of Object.values(HQ_PERMISSIONS)) {
      expect(perms.canView).toBe(true);
      expect(perms.canEdit).toBe(true);
      expect(perms.canDelete).toBe(true);
    }
  });
});

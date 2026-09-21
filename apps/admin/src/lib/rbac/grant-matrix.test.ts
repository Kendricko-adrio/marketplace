import { describe, expect, it } from "vitest";
import {
  grantsToMatrix,
  matrixToGrants,
  cellScopeOptions,
  isCellSelectable,
  matrixGrantCount,
  matrixHasCoverageError,
  RBAC_MODULE_LABELS,
} from "./grant-matrix";
import type { Grant, ModuleKey } from "@marketplace/db/src/rbac/catalog";

const grant = (module: string, action: string, scope: string): Grant =>
  ({ module, action, scope } as Grant);

// =========================================================
// Catalog-driven matrix model
// =========================================================
describe("grant matrix", () => {
  it("round-trips grants through the matrix without dropping scopes", () => {
    const grants: Grant[] = [
      grant("products", "view", "own_branch"),
      grant("orders", "view", "all_branches"),
      grant("orders", "edit", "all_branches"),
      grant("customers", "view", "global"),
    ];
    const matrix = grantsToMatrix(grants);
    expect(matrix.products.view).toBe("own_branch");
    expect(matrix.orders.view).toBe("all_branches");
    expect(matrix.orders.edit).toBe("all_branches");
    expect(matrix.customers.view).toBe("global");

    expect([...matrixToGrants(matrix)].sort((a, b) => a.module.localeCompare(b.module))).toEqual(
      [...grants].sort((a, b) => a.module.localeCompare(b.module))
    );
  });

  it("maps a deny-all empty matrix to an empty grant set", () => {
    expect(matrixToGrants(grantsToMatrix([]))).toEqual([]);
  });

  it("exposes only catalog-supported scopes per cell", () => {
    // Product edit is the global Jubelio re-sync: all-branch only.
    expect(cellScopeOptions("products", "edit")).toEqual(["all_branches"]);
    expect(cellScopeOptions("products", "view")).toEqual([
      "own_branch",
      "all_branches",
    ]);
    // Branch delete is an all-branch operation.
    expect(cellScopeOptions("branches", "delete")).toEqual(["all_branches"]);
    // Global actions carry no scope choice.
    expect(cellScopeOptions("customers", "view")).toEqual(["global"]);
    expect(cellScopeOptions("footer", "edit")).toEqual(["global"]);
  });

  it("marks unsupported module/action combinations unselectable", () => {
    // Product edit-own, Customer edit, Branch delete-own do not exist.
    expect(isCellSelectable("products", "delete")).toBe(false);
    expect(isCellSelectable("customers", "edit")).toBe(false);
    expect(isCellSelectable("customers", "delete")).toBe(false);
    expect(isCellSelectable("analytics", "edit")).toBe(false);
    expect(isCellSelectable("orders", "view")).toBe(true);
  });

  it("counts selected grants across the matrix", () => {
    const matrix = grantsToMatrix([
      grant("products", "view", "own_branch"),
      grant("homepage", "view", "global"),
      grant("homepage", "edit", "global"),
    ]);
    expect(matrixGrantCount(matrix)).toBe(3);
  });

  it("detects a coverage error client-side (edit without covering view)", () => {
    const bad = grantsToMatrix([grant("orders", "edit", "own_branch")]);
    expect(matrixHasCoverageError(bad)).toBe(true);

    const good = grantsToMatrix([
      grant("orders", "view", "own_branch"),
      grant("orders", "edit", "own_branch"),
    ]);
    expect(matrixHasCoverageError(good)).toBe(false);
  });
});

// =========================================================
// Display labels for every catalog module
// =========================================================
describe("RBAC_MODULE_LABELS", () => {
  it("labels every catalog module", () => {
    const modules: ModuleKey[] = [
      "products",
      "orders",
      "notifications",
      "branches",
      "analytics",
      "audit_log",
      "customers",
      "homepage",
      "pages",
      "users",
      "roles",
      "footer",
    ];
    for (const moduleKey of modules) {
      expect(RBAC_MODULE_LABELS[moduleKey]).toBeTruthy();
    }
  });
});
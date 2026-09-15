import {
  ALL_MODULES,
  CATALOG,
  isBranchModule,
  type ActionKey,
  type Grant,
  type GrantScope,
  type ModuleKey,
} from "@marketplace/db/src/rbac/catalog";
import { checkGrantCoverage } from "@marketplace/db/src/rbac/catalog";

// =========================================================
// RBAC: grant matrix model (pure, client-safe)
// =========================================================
// The Role editor renders the code-owned catalog as a matrix:
// one row per module, one column per action, and a scope selector in each
// selectable cell. Unsupported module/action combinations cannot be
// selected at all; global actions have no scope choice. The matrix is the
// only client-side draft representation — final validation still happens
// server-side on save.

/** A matrix cell is the granted scope, or `false` when not granted. */
export type MatrixCell = GrantScope | false;

export type GrantMatrix = Record<ModuleKey, Partial<Record<ActionKey, MatrixCell>>>;

/** Indonesian display labels for every catalog module. */
export const RBAC_MODULE_LABELS: Record<ModuleKey, string> = {
  products: "Produk",
  orders: "Pesanan",
  notifications: "Notifikasi",
  branches: "Cabang",
  analytics: "Analitik",
  audit_log: "Log Audit",
  customers: "Customer",
  homepage: "Homepage",
  pages: "Halaman",
  users: "Pengguna",
  roles: "Hak Akses (Role)",
  footer: "Footer",
};

export const RBAC_ACTION_LABELS: Record<ActionKey, string> = {
  view: "Lihat",
  edit: "Ubah",
  delete: "Hapus",
};

export const RBAC_SCOPE_LABELS: Record<GrantScope, string> = {
  own_branch: "Cabang sendiri",
  all_branches: "Semua cabang",
  global: "Global",
};

function emptyMatrix(): GrantMatrix {
  const matrix = {} as GrantMatrix;
  for (const moduleKey of ALL_MODULES) {
    matrix[moduleKey] = {};
  }
  return matrix;
}

/** Build the editable matrix representation of a grant set. */
export function grantsToMatrix(grants: readonly Grant[]): GrantMatrix {
  const matrix = emptyMatrix();
  for (const grant of grants) {
    const row = matrix[grant.module];
    if (!row) continue;
    row[grant.action] = grant.scope;
  }
  return matrix;
}

/** Convert a matrix back into the normalized grant set (false cells skipped). */
export function matrixToGrants(matrix: GrantMatrix): Grant[] {
  const grants: Grant[] = [];
  for (const moduleKey of ALL_MODULES) {
    const row = matrix[moduleKey];
    if (!row) continue;
    for (const action of ["view", "edit", "delete"] as ActionKey[]) {
      const cell = row[action];
      if (cell === undefined || cell === false) continue;
      grants.push({
        module: moduleKey,
        action,
        // Branch modules keep the chosen scope; global actions are global.
        scope: isBranchModule(moduleKey) ? cell : "global",
      });
    }
  }
  return grants;
}

/**
 * Allowed scopes for one catalog cell. `[]` means the action is global
 * (no scope choice); the cell is selectable whenever the action exists in
 * the catalog for that module.
 */
export function cellScopeOptions(
  module: ModuleKey,
  action: ActionKey
): GrantScope[] {
  const actions = (CATALOG as Record<string, Record<string, readonly string[] | undefined>>)[
    module
  ];
  const scopes = actions?.[action];
  if (scopes === undefined) return [];
  if (scopes.length === 0) return ["global"];
  return [...scopes] as GrantScope[];
}

/** A cell is selectable when the catalog supports the module/action pair. */
export function isCellSelectable(module: ModuleKey, action: ActionKey): boolean {
  return cellScopeOptions(module, action).length > 0;
}

/** Number of granted cells across the matrix. */
export function matrixGrantCount(matrix: GrantMatrix): number {
  return matrixToGrants(matrix).length;
}

/** Client-side coverage preview; authoritative validation stays server-side. */
export function matrixHasCoverageError(matrix: GrantMatrix): boolean {
  return checkGrantCoverage(matrixToGrants(matrix)).length > 0;
}
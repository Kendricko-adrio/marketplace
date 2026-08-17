// Pure helper for the admin product-detail "Stok" tab. The product-detail API
// fetches the raw branch_stock rows (scoped by the caller's branch access)
// and hands them here; this filters by scope, groups by branch, and computes
// `available` = max(0, stock - pendingRemoteStock). Confirmed reservations are
// already reflected in Jubelio on-hand (`stock`).
// unit-tested with deterministic fixtures. See branch-stock.test.ts.
//
// Scope rules mirror getBranchScope (../lib/auth-guard):
//   - mode "all"  → HQ / branchless admin: every branch present in the rows.
//   - mode "own"  → branch admin: only their branchId.
// The route still applies the same filter in SQL (defence in depth) — this
// helper is the tested guarantee and keeps the route handler thin.

export type BranchStockScope = { mode: "all" } | { mode: "own"; branchId: string };

export type BranchStockInputRow = {
  branchId: string;
  branchName: string;
  branchCode: string;
  branchCity: string;
  branchStatus: string;
  variantId: string;
  sku: string;
  size: string | null;
  color: string | null;
  stock: number;
  reservedStock: number;
  pendingRemoteStock: number;
};

export type BranchStockRow = {
  variantId: string;
  sku: string;
  size: string | null;
  color: string | null;
  stock: number;
  reservedStock: number;
  pendingRemoteStock: number;
  available: number;
};

// One row per branch × variant, but only the branch-scoping fields are needed to
// compute the per-product totals shown on the products list. The list API fetches
// the raw branch_stock rows for a product's variants (scoped in SQL by branch when
// the caller is a branch admin) and hands them here; this filters by scope and sums
// `available` = max(0, stock - pendingRemoteStock). Kept pure (no DB) so it can be unit-
// tested with deterministic fixtures. See branch-stock.test.ts.
//
// Scope rules mirror getBranchScope (../lib/auth-guard):
//   - mode "all"  → HQ / branchless admin: every row passed in.
//   - mode "own"  → branch admin: only their branchId's rows.
// The route still applies the same filter in SQL (defence in depth) — this helper
// is the tested guarantee and keeps the route handler thin.
export type ScopedTotalsInputRow = {
  branchId: string;
  stock: number;
  reservedStock: number;
  pendingRemoteStock: number;
};

export type ScopedTotals = {
  totalStock: number;
  totalReserved: number;
  totalAvailable: number;
};

export function computeScopedTotals(
  scope: BranchStockScope,
  rows: ScopedTotalsInputRow[]
): ScopedTotals {
  const visible = rows.filter(
    (r) => scope.mode === "all" || r.branchId === scope.branchId
  );

  let totalStock = 0;
  let totalReserved = 0;
  let totalPendingRemote = 0;
  for (const r of visible) {
    totalStock += r.stock;
    totalReserved += r.reservedStock;
    totalPendingRemote += r.pendingRemoteStock;
  }

  return {
    totalStock,
    totalReserved,
    totalAvailable: Math.max(0, totalStock - totalPendingRemote),
  };
}

export type BranchStockGroup = {
  id: string;
  name: string;
  code: string;
  city: string;
  status: string;
  rows: BranchStockRow[];
};

// Size sort: numeric sizes ascend numerically; non-numeric ("S"/"M"/"XL",
// null) fall back to string order with nulls last. Keeps "40" before "41" and
// "S" before "M" without a fragile plain string compare ("41" < "9" lexically).
function sizeCompare(a: string | null, b: string | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
  return a.localeCompare(b, undefined, { numeric: true });
}

export function groupBranchStock(
  scope: BranchStockScope,
  rows: BranchStockInputRow[]
): BranchStockGroup[] {
  const visible = rows.filter(
    (r) => scope.mode === "all" || r.branchId === scope.branchId
  );

  const byBranch = new Map<string, BranchStockGroup>();
  for (const r of visible) {
    let group = byBranch.get(r.branchId);
    if (!group) {
      group = {
        id: r.branchId,
        name: r.branchName,
        code: r.branchCode,
        city: r.branchCity,
        status: r.branchStatus,
        rows: [],
      };
      byBranch.set(r.branchId, group);
    }
    group.rows.push({
      variantId: r.variantId,
      sku: r.sku,
      size: r.size,
      color: r.color,
      stock: r.stock,
      reservedStock: r.reservedStock,
      pendingRemoteStock: r.pendingRemoteStock,
      available: Math.max(0, r.stock - r.pendingRemoteStock),
    });
  }

  return Array.from(byBranch.values())
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    .map((g) => ({
      ...g,
      rows: g.rows.sort((a, b) => {
        const bySize = sizeCompare(a.size, b.size);
        if (bySize !== 0) return bySize;
        return (a.color ?? "").localeCompare(b.color ?? "");
      }),
    }));
}

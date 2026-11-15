import { and, desc, eq, ilike, or, sql } from "drizzle-orm";

import { db } from "@/db";
import { branches } from "@/db";
import type { BranchPredicateScope } from "@/lib/rbac/branch-scope";

// =========================================================
// Branches list query (DAL) — scope + search + pagination
// =========================================================
// Data-access module for the Branch admin list, called directly from
// `GET /api/admin/branches` (route.ts owns HTTP, this owns the SQL).
//
// The search term is applied in SQL, not in the browser: searching a page the
// client does not have in memory (page 2, 3, …) still matches, and the count
// query carries the SAME predicate so pagination totals stay consistent with
// the rows actually returned.
//
// Fields searched mirror the input hint ("Cari nama/kode/kota..."): name,
// code, city — case-insensitive partial match.

export interface ListBranchesInput {
  /** Branch predicate from the Current Policy (`own` = Home Branch only). */
  scope: BranchPredicateScope;
  /** Raw, already-trimmed search term; empty string means "no filter". */
  search: string;
  page: number;
  limit: number;
}

export interface ListBranchesResult {
  rows: (typeof branches.$inferSelect)[];
  total: number;
}

/** Row-level visibility: own-branch scope reaches only the Home Branch. */
function visibilityCondition(scope: BranchPredicateScope) {
  return scope.mode === "own" ? eq(branches.id, scope.branchId) : undefined;
}

/** Case-insensitive partial match over the searchable columns. */
function searchCondition(search: string) {
  if (search === "") return undefined;
  const pattern = `%${search}%`;
  return or(
    ilike(branches.name, pattern),
    ilike(branches.code, pattern),
    ilike(branches.city, pattern)
  );
}

export async function listBranches({
  scope,
  search,
  page,
  limit,
}: ListBranchesInput): Promise<ListBranchesResult> {
  const whereCondition =
    and(searchCondition(search), visibilityCondition(scope)) ?? undefined;

  const rows = await db
    .select()
    .from(branches)
    .where(whereCondition)
    .orderBy(desc(branches.createdAt))
    .limit(limit)
    .offset((page - 1) * limit);

  // Same predicate as the rows query — otherwise the "page X of Y" footer
  // would count rows the list never returns.
  const countResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(branches)
    .where(whereCondition);

  return { rows, total: Number(countResult[0]?.count || 0) };
}

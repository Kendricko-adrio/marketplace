import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

import { adminRoles } from "./rbac";
import {
  normalizeRoleName,
  roleNameNormalizedSql,
} from "../rbac/catalog";

// =========================================================
// Schema: the admin_role_name_normalized_unique expression index must use
// the SAME canonical Role-Name normalization as the application
// (normalizeRoleName): trim + whitespace collapse + lowercase.
// 0017 shipped an untrimmed expression (lower + whitespace collapse only);
// the correction is implemented inside 0018 (drop/recreate after the
// collision preflight), so both the schema and the rendered SQL here are
// the single source of truth for the canonical form.
// =========================================================

const dialect = new PgDialect();

describe("role-name normalization SQL (canonical expression)", () => {
  it("renders trim + whitespace collapse + lowercase over the Role Name column", () => {
    const rendered = dialect.sqlToQuery(
      roleNameNormalizedSql(adminRoles.name)
    );
    expect(rendered.params).toEqual([]);
    expect(rendered.sql).toBe(
      `lower(btrim(regexp_replace("admin_role"."name", '\\s+', ' ', 'g')))`
    );
  });

  it("collapses whitespace runs before trimming (matches normalizeRoleName order)", () => {
    // Regression pin for the ORDER of operations: normalizeRoleName is
    // collapse → trim → lower, so the SQL must collapse INSIDE the trim.
    // btrim(regexp_replace(...)) — not regexp_replace(btrim(...)) — matches.
    const rendered = dialect.sqlToQuery(
      roleNameNormalizedSql(adminRoles.name)
    ).sql;
    expect(rendered.indexOf("btrim(")).toBeLessThan(
      rendered.indexOf("regexp_replace(")
    );
  });
});

// Pure pins of the canonical TS normalization (must stay in lockstep with
// the SQL expression above — the DB-backed behavioral equivalence test
// admin_role normalization enforces the actual equivalence).
describe("normalizeRoleName (canonical TS normalization)", () => {
  const cases: Array<[string, string]> = [
    ["  Marketing   Team  ", "marketing team"],
    ["Sales\tOps", "sales ops"],
    ["HQ\n", "hq"],
    ["\tAdmin ", "admin"],
    ["  Admin", "admin"],
    ["Admin  \n ", "admin"],
    ["Århus-Ops_2", "århus-ops_2"],
    ["a  b", "a b"],
  ];

  it.each(cases)("%j normalizes to %j", (input, expected) => {
    expect(normalizeRoleName(input)).toBe(expected);
  });

  it("is idempotent", () => {
    for (const [input] of cases) {
      expect(normalizeRoleName(normalizeRoleName(input))).toBe(
        normalizeRoleName(input)
      );
    }
  });
});
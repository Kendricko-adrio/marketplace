import { describe, it, expect } from "vitest";

import { mapConstraintError, RoleServiceError } from "./roles-service";

// =========================================================
// Slice 4 — stable mapping of Postgres unique/check constraint races.
// Concurrent duplicate-name or duplicate-grant inserts can lose the race
// against the DB constraints; they must surface as stable 409/400 codes,
// never as 500.
// =========================================================

function pgError(fields: Record<string, unknown>): unknown {
  const error = new Error("duplicate key value violates unique constraint");
  Object.assign(error, fields);
  return error;
}

describe("mapConstraintError", () => {
  it("maps the normalized-name unique race to 409 DUPLICATE_NAME", () => {
    const mapped = mapConstraintError(
      pgError({ code: "23505", constraint: "admin_role_name_normalized_unique" })
    );
    expect(mapped).toBeInstanceOf(RoleServiceError);
    expect(mapped?.status).toBe(409);
    expect(mapped?.code).toBe("DUPLICATE_NAME");
  });

  it("maps the grant-tuple unique race to 400 INVALID_GRANTS", () => {
    const mapped = mapConstraintError(
      pgError({ code: "23505", constraint: "admin_role_grant_tuple_unique" })
    );
    expect(mapped?.status).toBe(400);
    expect(mapped?.code).toBe("INVALID_GRANTS");
  });

  it("maps check-constraint violations to 400 INVALID_GRANTS", () => {
    const mapped = mapConstraintError(
      pgError({
        code: "23514",
        constraint: "admin_role_grant_module_scope_shape_check",
      })
    );
    expect(mapped?.status).toBe(400);
    expect(mapped?.code).toBe("INVALID_GRANTS");
  });

  it("maps an unknown unique violation to a stable 409 conflict", () => {
    const mapped = mapConstraintError(pgError({ code: "23505" }));
    expect(mapped?.status).toBe(409);
    expect(mapped?.code).toBe("CONFLICT");
  });

  it("returns null for unrelated errors", () => {
    expect(mapConstraintError(new Error("boom"))).toBeNull();
    expect(mapConstraintError(pgError({ code: "42703" }))).toBeNull();
    expect(mapConstraintError(null)).toBeNull();
  });
});
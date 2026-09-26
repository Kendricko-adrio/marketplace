import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { getTableName } from "drizzle-orm";
import { jubelioSalesOperations } from "./jubelio-sales";

// Schema-convention guard for the durable Jubelio sales-order operation
// ledger (plan: jubelio-sales-api-switching, Gate C.1). Every datetime column
// MUST be timestamptz (docs/architecture/database.md), the ledger must be tied
// to the local order with a cascade FK, and the at-most-once invariants
// (one operation per (order, type); cancel and confirmed operations always
// carry a known SO id) must be enforced by the schema itself, not only by
// app code.
const config = getTableConfig(jubelioSalesOperations);
const checkNames = config.checks.map((c) => c.name);
const uniqueIndexNames = config.indexes
  .filter((index) => index.config.unique)
  .map((index) => index.config.name);

describe("jubelio_sales_operation schema conventions", () => {
  it("stores every datetime column as timestamptz", () => {
    const timestampColumns = config.columns.filter((column) =>
      column.getSQLType().startsWith("timestamp")
    );
    expect(timestampColumns.length).toBeGreaterThan(0);
    for (const column of timestampColumns) {
      expect(column.getSQLType()).toBe("timestamp with time zone");
    }
  });

  it("is tied to the local order with an ON DELETE CASCADE FK", () => {
    expect(config.foreignKeys.length).toBe(1);
    const reference = config.foreignKeys[0].reference();
    expect(getTableName(reference.foreignTable)).toBe("orders");
    expect(config.foreignKeys[0].onDelete).toBe("cascade");
  });

  it("allows exactly one create and one cancel operation per order", () => {
    expect(uniqueIndexNames).toContain("jubelio_sales_operation_order_type_unique");
  });

  it("keeps the provider-facing request reference unique", () => {
    expect(uniqueIndexNames).toContain("jubelio_sales_operation_reference_unique");
  });

  it("enforces the state machine invariants with check constraints", () => {
    expect(checkNames).toContain("jubelio_sales_operation_type_valid");
    expect(checkNames).toContain("jubelio_sales_operation_status_valid");
    expect(checkNames).toContain(
      "jubelio_sales_operation_attempt_nonnegative"
    );
    expect(checkNames).toContain(
      "jubelio_sales_operation_cancel_requires_sales_order"
    );
    expect(checkNames).toContain(
      "jubelio_sales_operation_confirmed_requires_sales_order"
    );
  });
});
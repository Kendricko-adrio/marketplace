import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { getTableName } from "drizzle-orm";
import { jubelioSalesOperations } from "./jubelio-sales";

// Schema-convention guard for the durable Jubelio sales-order operation
// ledger (plan: jubelio-sales-api-switching, Gate C.1). Every datetime column
// MUST be timestamptz (docs/architecture/database.md), the ledger must be tied
// to the local order with a RESTRICT retention FK (plan/discounts-spec.md
// §8.4: provider operations are transactional evidence and must never cascade
// away when the order row is hard-deleted), and the at-most-once invariants
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

  it("is tied to the local order with an ON DELETE RESTRICT retention FK", () => {
    const orderKey = config.foreignKeys.find((key) => getTableName(key.reference().foreignTable) === "orders");
    expect(orderKey).toBeDefined();
    // RESTRICT (never cascade): the ledger is provider/transactional evidence
    // retained by spec §8.4, so a hard order delete must fail 23503 instead of
    // silently destroying the operation history.
    expect(orderKey?.onDelete).toBe("restrict");
    const attemptKeys = config.foreignKeys.filter((key) => getTableName(key.reference().foreignTable) === "checkout_attempt");
    expect(attemptKeys).toHaveLength(2);
    for (const key of attemptKeys) expect(key.onDelete).toBe("restrict");
    expect(jubelioSalesOperations.orderId.notNull).toBe(false);
    expect(checkNames).toContain("jubelio_sales_operation_owner_required");
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
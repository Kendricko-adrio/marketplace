import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { checkoutAttempts } from "./checkout";

// Schema is a public persistence contract: an attempt must not require an order.
describe("checkout attempt schema", () => {
  it("can retain a checkout attempt without creating an order", () => {
    expect(checkoutAttempts.orderId.notNull).toBe(false);
    expect(checkoutAttempts.reservedOrderId.notNull).toBe(true);
    expect(getTableConfig(checkoutAttempts).name).toBe("checkout_attempt");
  });

  it("retains owner and provider evidence with restrictive foreign keys", () => {
    const config = getTableConfig(checkoutAttempts);
    expect(config.foreignKeys.length).toBeGreaterThanOrEqual(2);
    for (const key of config.foreignKeys) expect(key.onDelete).toBe("restrict");
  });

  it("uses timestamptz for every deadline and timestamp", () => {
    const columns = getTableConfig(checkoutAttempts).columns.filter((column) => column.getSQLType().startsWith("timestamp"));
    expect(columns.length).toBeGreaterThanOrEqual(4);
    for (const column of columns) expect(column.getSQLType()).toBe("timestamp with time zone");
  });

  it("guards one unresolved attempt per client, key idempotency, and order promotion", () => {
    const config = getTableConfig(checkoutAttempts);
    expect(config.indexes.filter((index) => index.config.unique).map((index) => index.config.name)).toEqual(
      expect.arrayContaining(["checkout_attempt_owner_key_unique", "checkout_attempt_active_owner_unique", "checkout_attempt_reserved_order_unique", "checkout_attempt_order_unique"]),
    );
    expect(config.checks.map((constraint) => constraint.name)).toEqual(expect.arrayContaining([
      "checkout_attempt_state_valid", "checkout_attempt_promotion_valid", "checkout_attempt_rejection_valid",
      "checkout_attempt_payment_valid", "checkout_attempt_snapshot_valid", "checkout_attempt_deadline_valid",
    ]));
  });
});

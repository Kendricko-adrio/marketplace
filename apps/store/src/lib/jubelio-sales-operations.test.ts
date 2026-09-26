import { describe, expect, it } from "vitest";
import type { SQL } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { PgDialect } from "drizzle-orm/pg-core";
import { jubelioSalesOperations } from "@marketplace/db/src/schema";
import {
  abortJubelioSalesOperation,
  claimJubelioSalesOperationForDispatch,
  getJubelioSalesOperation,
  markJubelioSalesOperationConfirmed,
  markJubelioSalesOperationManualReview,
  markJubelioSalesOperationRejected,
  recordJubelioSalesIntent,
} from "./jubelio-sales-operations";

// =========================================================
// Unit seam for the durable Jubelio sales-order operation ledger
// (plan: jubelio-sales-api-switching, Gate C.1). The at-most-once guarantee
// itself lives in ONE atomic conditional UPDATE ... WHERE status = 'intent'
// ... RETURNING (the parent-verified Drizzle primitive); the real concurrency
// semantics are covered by jubelio-sales-operations.db.test.ts, which requires
// PostgreSQL. These tests verify the orchestration logic around that single
// SQL claim with an injected fake db (house pattern from jubelio-sync.test.ts).
// =========================================================

type OperationRow = typeof jubelioSalesOperations.$inferSelect;

type FakeConfig = {
  insertReturningRows?: Array<Record<string, unknown>>;
  updateReturningRows?: OperationRow[];
  selectRows?: OperationRow[];
  onConflictValues?: Array<Record<string, unknown>>;
};

const dialect = new PgDialect();

function makeOperationRow(overrides: Partial<OperationRow>): OperationRow {
  return {
    id: "op-1",
    orderId: "order-1",
    type: "create",
    status: "intent",
    reference: "OKCIR_SO_CREATE:order-1:op-1",
    payload: {
      type: "create",
      create: {
        contactId: -1,
        customerName: "John Doe",
        locationId: 61,
        note: "OKCIR_SO_CREATE:order-1:op-1",
        items: [
          {
            itemId: 101187,
            quantity: 1,
            price: 150000,
            discAmount: 0,
            taxAmount: 0,
            unit: "Buah",
            taxId: 0,
          },
        ],
      },
    },
    salesOrderId: null,
    attemptCount: 0,
    dispatchedAt: null,
    confirmedAt: null,
    lastError: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  } as OperationRow;
}

function fakeDb(config: FakeConfig) {
  const captured: {
    insertedValues?: Record<string, unknown>;
    setValues?: Record<string, unknown>;
    whereCount: number;
    updateCount: number;
    updateWhere?: SQL;
    conflictTarget?: unknown;
  } = { whereCount: 0, updateCount: 0 };

  const db = {
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        captured.insertedValues = values;
        return {
          onConflictDoNothing: (options?: { target: unknown }) => {
            captured.conflictTarget = options?.target;
            return {
              returning: async () => config.insertReturningRows ?? [],
            };
          },
        };
      },
    }),
    select: () => ({
      from: () => ({
        where: () => {
          captured.whereCount += 1;
          return {
            limit: async () => config.selectRows ?? [],
          };
        },
      }),
    }),
    update: () => ({
      set: (setValues: Record<string, unknown>) => {
        captured.updateCount += 1;
        captured.setValues = setValues;
        return {
          where: (condition: SQL) => {
            captured.whereCount += 1;
            captured.updateWhere = condition;
            return {
              returning: async () => config.updateReturningRows ?? [],
            };
          },
        };
      },
    }),
  } as unknown as NodePgDatabase<never>;

  return { db, captured };
}

describe("recordJubelioSalesIntent", () => {
  const createPayload = {
    type: "create" as const,
    create: {
      contactId: -1,
      customerName: "John Doe",
      locationId: 61,
      note: "OKCIR_SO_CREATE:order-1:op-1",
      items: [
        {
          itemId: 101187,
          quantity: 1,
          price: 150000,
          discAmount: 0,
          taxAmount: 0,
          unit: "Buah",
          taxId: 0,
        },
      ],
    },
  };

  it("persists a create intent with status intent, null SO id and the unique reference", async () => {
    const row = makeOperationRow({ id: "op-1" });
    const { db, captured } = fakeDb({ insertReturningRows: [row] });

    const result = await recordJubelioSalesIntent(db, {
      orderId: "order-1",
      type: "create",
      reference: row.reference,
      payload: createPayload,
    });

    expect(result.created).toBe(true);
    expect(result.operation.status).toBe("intent");
    expect(captured.insertedValues?.status).toBe("intent");
    expect(captured.insertedValues?.salesOrderId).toBeNull();
    expect(captured.insertedValues?.reference).toBe(row.reference);
    expect(captured.conflictTarget).toEqual([
      jubelioSalesOperations.orderId,
      jubelioSalesOperations.type,
    ]);
  });

  it("persists a cancel intent that carries the known sales order id", async () => {
    const row = makeOperationRow({
      id: "op-2",
      type: "cancel",
      salesOrderId: 68378,
      payload: { type: "cancel", cancel: { salesOrderId: 68378 } },
    });
    const { db, captured } = fakeDb({ insertReturningRows: [row] });

    const result = await recordJubelioSalesIntent(db, {
      orderId: "order-1",
      type: "cancel",
      reference: row.reference,
      payload: { type: "cancel", cancel: { salesOrderId: 68378 } },
      salesOrderId: 68378,
    });

    expect(result.created).toBe(true);
    expect(captured.insertedValues?.type).toBe("cancel");
    expect(captured.insertedValues?.salesOrderId).toBe(68378);
  });

  it("refuses a cancel intent without a known sales order id before any insert", async () => {
    const { db, captured } = fakeDb({});

    await expect(
      recordJubelioSalesIntent(db, {
        orderId: "order-1",
        type: "cancel",
        reference: "OKCIR_SO_CANCEL:order-1:op-3",
        payload: { type: "cancel", cancel: { salesOrderId: 68378 } },
      })
    ).rejects.toThrow(/sales order id/i);
    expect(captured.insertedValues).toBeUndefined();
  });

  it("refuses a create intent that already claims a sales order id", async () => {
    const { db, captured } = fakeDb({});

    await expect(
      recordJubelioSalesIntent(db, {
        orderId: "order-1",
        type: "create",
        reference: "OKCIR_SO_CREATE:order-1:op-1",
        payload: createPayload,
        salesOrderId: 68378,
      })
    ).rejects.toThrow(/create intent/i);
    expect(captured.insertedValues).toBeUndefined();
  });

  it("rejects a payload whose kind does not match the operation type", async () => {
    const { db, captured } = fakeDb({});

    await expect(
      recordJubelioSalesIntent(db, {
        orderId: "order-1",
        type: "cancel",
        reference: "OKCIR_SO_CANCEL:order-1:op-4",
        payload: createPayload,
        salesOrderId: 68378,
      })
    ).rejects.toThrow(/payload/i);
    expect(captured.insertedValues).toBeUndefined();
  });

  it("refuses a replay whose reference or payload differs from the persisted intent", async () => {
    const existing = makeOperationRow({ id: "op-1", status: "dispatched_unknown" });
    const { db } = fakeDb({ insertReturningRows: [], selectRows: [existing] });

    await expect(recordJubelioSalesIntent(db, {
      orderId: "order-1", type: "create",
      reference: "OKCIR_SO_CREATE:order-1:other",
      payload: createPayload,
    })).rejects.toThrow(/does not match/i);

    await expect(recordJubelioSalesIntent(db, {
      orderId: "order-1", type: "create", reference: existing.reference,
      payload: { ...createPayload, create: { ...createPayload.create, locationId: 62 } },
    })).rejects.toThrow(/does not match/i);
  });

  it("replay after a (order, type) conflict returns the existing intent without a second insert", async () => {
    const existing = makeOperationRow({ id: "op-1", status: "dispatched_unknown" });
    const { db } = fakeDb({
      insertReturningRows: [],
      selectRows: [existing],
    });

    const result = await recordJubelioSalesIntent(db, {
      orderId: "order-1",
      type: "create",
      reference: existing.reference,
      payload: createPayload,
    });

    expect(result.created).toBe(false);
    expect(result.operation.status).toBe("dispatched_unknown");
    // No second intent row may be created for the same (order, type).
    expect(result.operation.id).toBe(existing.id);
  });
});

describe("claimJubelioSalesOperationForDispatch", () => {
  it("claims an intent atomically: transitions to dispatched_unknown with a dispatch timestamp", async () => {
    const claimed = makeOperationRow({
      status: "dispatched_unknown",
      attemptCount: 1,
      dispatchedAt: new Date("2026-01-02T00:00:00Z"),
    });
    const { db, captured } = fakeDb({ updateReturningRows: [claimed] });

    const result = await claimJubelioSalesOperationForDispatch(db, "op-1");

    expect(result.claimed).toBe(true);
    expect(result.claimed && result.operation.status).toBe("dispatched_unknown");
    expect(captured.setValues?.status).toBe("dispatched_unknown");
    expect(captured.setValues?.dispatchedAt).toBeInstanceOf(Date);
    expect(captured.setValues?.lastError).toBeNull();
    // The attempt counter is incremented in SQL, not read-modify-written.
    expect(captured.setValues?.attemptCount).toBeDefined();
  });

  it("refuses to re-dispatch a possibly-sent write (replay protection)", async () => {
    const possiblySent = makeOperationRow({
      status: "dispatched_unknown",
      attemptCount: 1,
    });
    const { db, captured } = fakeDb({
      updateReturningRows: [],
      selectRows: [possiblySent],
    });

    const result = await claimJubelioSalesOperationForDispatch(db, "op-1");

    expect(result.claimed).toBe(false);
    expect(
      result.claimed === false && result.reason === "not_dispatchable"
    ).toBe(true);
    // Only the ONE conditional claim update was issued — never a second,
    // unconditional dispatch write.
    expect(captured.updateCount).toBe(1);
  });

  it("refuses terminal operations (confirmed) with the same not_dispatchable reason", async () => {
    const confirmed = makeOperationRow({
      status: "confirmed",
      salesOrderId: 68378,
      attemptCount: 1,
    });
    const { db } = fakeDb({
      updateReturningRows: [],
      selectRows: [confirmed],
    });

    const result = await claimJubelioSalesOperationForDispatch(db, "op-1");
    expect(result.claimed).toBe(false);
    expect(
      result.claimed === false && result.reason === "not_dispatchable"
    ).toBe(true);
  });

  it("reports not_found when the operation row does not exist", async () => {
    const { db } = fakeDb({
      updateReturningRows: [],
      selectRows: [],
    });

    const result = await claimJubelioSalesOperationForDispatch(db, "missing");
    expect(result.claimed).toBe(false);
    expect(result.claimed === false && result.reason === "not_found").toBe(true);
  });
});

describe("outcome transitions", () => {
  it("markJubelioSalesOperationConfirmed persists the known SO id guarded to dispatched_unknown", async () => {
    const confirmed = makeOperationRow({
      status: "confirmed",
      salesOrderId: 68378,
    });
    const { db, captured } = fakeDb({
      selectRows: [makeOperationRow({ type: "create", status: "dispatched_unknown" })],
      updateReturningRows: [confirmed],
    });

    const operation = await markJubelioSalesOperationConfirmed(db, "op-1", {
      salesOrderId: 68378,
    });

    expect(operation?.status).toBe("confirmed");
    expect(captured.setValues?.salesOrderId).toBe(68378);
    expect(captured.setValues?.confirmedAt).toBeInstanceOf(Date);
    expect(captured.setValues?.lastError).toBeNull();
  });

  it("markJubelioSalesOperationConfirmed requires an invoice id for invoice operations", async () => {
    const { db } = fakeDb({
      selectRows: [makeOperationRow({ type: "invoice", status: "dispatched_unknown" })],
    });

    await expect(
      markJubelioSalesOperationConfirmed(db, "op-1", {})
    ).rejects.toThrow("invoice confirmation requires a positive invoice id");
  });

  it("markJubelioSalesOperationConfirmed requires a payment id for payment operations", async () => {
    const { db } = fakeDb({
      selectRows: [makeOperationRow({ type: "payment", status: "dispatched_unknown" })],
    });

    await expect(
      markJubelioSalesOperationConfirmed(db, "op-1", {})
    ).rejects.toThrow("payment confirmation requires a positive payment id");
  });

  it("markJubelioSalesOperationConfirmed returns null when the operation row is missing", async () => {
    const { db } = fakeDb({ selectRows: [] });
    const operation = await markJubelioSalesOperationConfirmed(db, "op-1", {
      salesOrderId: 68378,
    });
    expect(operation).toBeNull();
  });

  it("markJubelioSalesOperationConfirmed returns null when the dispatch claim was lost", async () => {
    const { db } = fakeDb({ updateReturningRows: [] });

    const operation = await markJubelioSalesOperationConfirmed(db, "op-1", {
      salesOrderId: 68378,
    });
    expect(operation).toBeNull();
  });

  it("markJubelioSalesOperationRejected records the failure message", async () => {
    const rejected = makeOperationRow({ status: "rejected", lastError: "bad" });
    const { db, captured } = fakeDb({ updateReturningRows: [rejected] });

    const operation = await markJubelioSalesOperationRejected(db, "op-1", {
      message: "provider rejected the order",
    });

    expect(operation?.status).toBe("rejected");
    expect(captured.setValues?.lastError).toBe("provider rejected the order");
    // Once claimed, a different caller must not assert a definitive rejection
    // while the remote POST could have succeeded.
    const where = dialect.sqlToQuery(captured.updateWhere!);
    expect(where.sql).toContain('"jubelio_sales_operation"."status" =');
    expect(where.params).toContain("intent");
    expect(where.params).not.toContain("dispatched_unknown");
  });

  it("markJubelioSalesOperationManualReview keeps the operation for operator reconciliation", async () => {
    const reviewed = makeOperationRow({
      status: "manual_review",
      lastError: "unknown outcome",
    });
    const { db, captured } = fakeDb({ updateReturningRows: [reviewed] });

    const operation = await markJubelioSalesOperationManualReview(db, "op-1", {
      message: "unknown outcome",
    });

    expect(operation?.status).toBe("manual_review");
    expect(captured.setValues?.status).toBe("manual_review");
    const where = dialect.sqlToQuery(captured.updateWhere!);
    expect(where.params).toContain("dispatched_unknown");
    expect(where.params).not.toContain("intent");
  });

  it("abortJubelioSalesOperation only abandons a never-dispatched intent", async () => {
    const aborted = makeOperationRow({ status: "aborted", lastError: "checkout aborted" });
    const { db, captured } = fakeDb({ updateReturningRows: [aborted] });

    const operation = await abortJubelioSalesOperation(db, "op-1", {
      message: "checkout aborted",
    });

    expect(operation?.status).toBe("aborted");
    expect(captured.setValues?.status).toBe("aborted");
  });
});

describe("getJubelioSalesOperation", () => {
  it("returns the (order, type) operation row when present", async () => {
    const row = makeOperationRow({});
    const { db } = fakeDb({ selectRows: [row] });

    const operation = await getJubelioSalesOperation(db, {
      orderId: "order-1",
      type: "create",
    });
    expect(operation?.id).toBe("op-1");
  });

  it("returns null when the order has no such operation", async () => {
    const { db } = fakeDb({ selectRows: [] });

    const operation = await getJubelioSalesOperation(db, {
      orderId: "order-1",
      type: "cancel",
    });
    expect(operation).toBeNull();
  });
});
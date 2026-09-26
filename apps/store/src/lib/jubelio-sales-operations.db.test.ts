import dotenv from "dotenv";
import path from "node:path";
dotenv.config({ path: path.resolve(import.meta.dirname, "../../../../.env") });
import { describe, expect, it, afterAll } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, inArray } from "drizzle-orm";
import { Pool } from "pg";
import {
  jubelioSalesOperations,
  clients,
  orders,
} from "@marketplace/db/src/schema";
import {
  claimJubelioSalesOperationForDispatch,
  getJubelioSalesOperation,
  markJubelioSalesOperationConfirmed,
  listStaleJubelioSalesOperations,
  markStaleJubelioSalesOperationForManualReview,
  recordJubelioSalesIntent,
} from "./jubelio-sales-operations";

// =========================================================
// DB concurrency seam for the durable Jubelio sales-order operation ledger
// (plan: jubelio-sales-api-switching, Gate C.1). The at-most-once dispatch
// guarantee is a DATABASE property of one conditional UPDATE ... WHERE
// status = 'intent' ... RETURNING; it can only be proven against PostgreSQL.
//
// These tests require the dev database with the jubelio_sales_operation table
// applied (db:push). They are SKIPPED when PostgreSQL is unreachable or the
// schema has not been pushed — a skip is NOT a pass: durable semantics remain
// unverified until these tests actually run. The exact blocker is logged.
//
// The dev database is SHARED. These tests only create rows keyed by the
// unique "jso-dbtest" prefix and delete them in afterAll (orders cascade to
// the operation ledger rows).
// =========================================================

const TEST_ID_PREFIX = "jso-dbtest-";
const TEST_SO_ID = 683_790_001; // never a real remote id

const url = process.env.DATABASE_URL;

async function dbReachable(): Promise<boolean> {
  if (!url) return false;
  try {
    const pool = new Pool({ connectionString: url, max: 1 });
    await pool.query("select 1");
    await pool.end();
    return true;
  } catch (error) {
    console.warn(
      `[jubelio-sales-operations.db] DB race tests NOT run — PostgreSQL unreachable at ${maskUrl(
        url
      )}: ${error instanceof Error ? error.message : String(error)}`
    );
    return false;
  }
}

async function salesOperationSchemaReady(): Promise<{
  ready: boolean;
  blocker?: string;
}> {
  if (!url) return { ready: false, blocker: "DATABASE_URL is not configured" };
  try {
    const pool = new Pool({ connectionString: url, max: 1 });
    const result = await pool.query(
      "select to_regclass('public.jubelio_sales_operation') is not null as ok"
    );
    await pool.end();
    if (result.rows[0]?.ok !== true) {
      return {
        ready: false,
        blocker:
          "jubelio_sales_operation table not found — run `npm run db:generate` + `npm run db:push` on the dev database first (db:push was not authorized in this stage)",
      };
    }
    return { ready: true };
  } catch (error) {
    return {
      ready: false,
      blocker: error instanceof Error ? error.message : String(error),
    };
  }
}

function maskUrl(raw: string): string {
  try {
    const parsed = new URL(raw);
    return `${parsed.protocol}//${parsed.host}/...`;
  } catch {
    return "configured DATABASE_URL";
  }
}

const reachable = await dbReachable();
const schemaState = reachable
  ? await salesOperationSchemaReady()
  : { ready: false, blocker: `PostgreSQL unreachable (DATABASE_URL=${url ? "set" : "not set"}; localhost:5432 refused in this environment)` };

if (!schemaState.ready) {
  console.warn(
    `[jubelio-sales-operations.db] DB race tests NOT run (skipped, not green) — exact blocker: ${schemaState.blocker}`
  );
}

// The environment blocker must be VISIBLE, not silently swallowed: vitest
// discards top-level console output for fully-skipped files. This reporter
// test stays red whenever PostgreSQL/the pushed schema is unavailable, so a
// skip can never be mistaken for a pass. It is skipped when the DB seam IS
// ready and the real race tests below run.
it.skipIf(schemaState.ready)(
  "environment blocker: durable claim semantics NOT verified (requires PostgreSQL)",
  () => {
    throw new Error(
      `DB race tests NOT run — durable Jubelio sales-operation semantics remain UNVERIFIED. Exact blocker: ${schemaState.blocker}`
    );
  }
);

const d = url
  ? drizzle(url, { schema: { jubelioSalesOperations, clients, orders } })
  : null;

const testClientIds: string[] = [];

async function seedOrderAndIntent(input: {
  suffix: string;
  type: "create" | "cancel";
  status?: string;
  salesOrderId?: number | null;
}): Promise<{ orderId: string; operationId: string }> {
  const clientId = `${TEST_ID_PREFIX}client-${input.suffix}`;
  const orderId = `${TEST_ID_PREFIX}order-${input.suffix}`;
  const operationId = `${TEST_ID_PREFIX}op-${input.suffix}`;
  testClientIds.push(clientId);
  await d!.insert(clients).values({
    id: clientId,
    name: "Ledger DB Test",
    email: `${clientId}@example.com`,
    emailVerified: true,
  });
  await d!.insert(orders).values({
    id: orderId,
    userId: clientId,
    contactPhone: "081234567890",
    contactEmail: `${clientId}@example.com`,
    subtotal: "150000",
    total: "166500",
  });
  await d!.insert(jubelioSalesOperations).values({
    id: operationId,
    orderId,
    type: input.type,
    ...(input.status ? { status: input.status } : {}),
    reference: `OKCIR_SO_${input.type.toUpperCase()}:${orderId}:${operationId}`,
    payload:
      input.type === "cancel"
        ? { type: "cancel", cancel: { salesOrderId: TEST_SO_ID } }
        : {
            type: "create",
            create: {
              contactId: -1,
              customerName: "Ledger DB Test",
              locationId: 61,
              note: `OKCIR_SO_CREATE:${orderId}:${operationId}`,
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
    ...(input.salesOrderId != null ? { salesOrderId: input.salesOrderId } : {}),
  });
  return { orderId, operationId };
}

afterAll(async () => {
  if (!d || testClientIds.length === 0) return;
  // Only remove fixture IDs created by THIS test run. Never delete unrelated
  // clients merely because they share the display name "Ledger DB Test".
  await d.delete(clients).where(inArray(clients.id, testClientIds));
});

describe.skipIf(!schemaState.ready)(
  "jubelio_sales_operation atomic dispatch claim (requires PostgreSQL)",
  () => {
    it("retains a confirmed create's marker-only mismatch by order and SO for investigation", async () => {
      const { orderId, operationId } = await seedOrderAndIntent({
        suffix: `marker-${Date.now()}`, type: "create",
      });
      expect((await claimJubelioSalesOperationForDispatch(d!, operationId)).claimed).toBe(true);
      const confirmed = await markJubelioSalesOperationConfirmed(d!, operationId, {
        salesOrderId: TEST_SO_ID, channelStatusMatches: false,
      });
      expect(confirmed?.status).toBe("confirmed");
      const found = await getJubelioSalesOperation(d!, { orderId, type: "create" });
      expect(found).toMatchObject({
        salesOrderId: TEST_SO_ID,
        channelStatusMismatchReason: "CREATE_MARKER_MISMATCH",
      });
      expect(found?.channelStatusMismatchAt).toBeInstanceOf(Date);
    });

    it("lets exactly one concurrent caller win the dispatch claim", async () => {
      const { operationId } = await seedOrderAndIntent({
        suffix: `race-${Date.now()}`,
        type: "create",
      });
      const results = await Promise.all(
        Array.from({ length: 8 }, () =>
          claimJubelioSalesOperationForDispatch(d!, operationId)
        )
      );
      const wins = results.filter((result) => result.claimed);
      expect(wins.length).toBe(1);
      const refusals = results.filter((result) => !result.claimed);
      for (const refusal of refusals) {
        expect(refusal.reason).toBe("not_dispatchable");
      }
    });

    it("routes only an aged, still-unknown dispatch to manual review without re-POST permission", async () => {
      const { operationId } = await seedOrderAndIntent({
        suffix: `stale-${Date.now()}`,
        type: "create",
      });
      expect((await claimJubelioSalesOperationForDispatch(d!, operationId)).claimed).toBe(true);
      await d!.update(jubelioSalesOperations)
        .set({
          dispatchedAt: new Date("2024-01-01T00:00:00Z"),
          lastError: "provider response body could not be read",
        })
        .where(eq(jubelioSalesOperations.id, operationId));
      const cutoff = new Date("2025-01-01T00:00:00Z");
      const reviewed = await markStaleJubelioSalesOperationForManualReview(d!, operationId, cutoff);
      expect(reviewed?.status).toBe("manual_review");
      expect(reviewed?.salesOrderId).toBeNull();
      expect(reviewed?.lastError).toBe("provider response body could not be read");
      expect(await markStaleJubelioSalesOperationForManualReview(d!, operationId, cutoff)).toBeNull();
      expect((await claimJubelioSalesOperationForDispatch(d!, operationId)).claimed).toBe(false);
    });

    it("lists only aged possibly-sent operations for bounded recovery", async () => {
      const old = await seedOrderAndIntent({suffix: `scan-old-${Date.now()}`, type: "create"});
      const fresh = await seedOrderAndIntent({suffix: `scan-fresh-${Date.now()}`, type: "cancel", salesOrderId: TEST_SO_ID});
      await claimJubelioSalesOperationForDispatch(d!, old.operationId);
      await claimJubelioSalesOperationForDispatch(d!, fresh.operationId);
      await d!.update(jubelioSalesOperations)
        .set({dispatchedAt: new Date("2024-01-01T00:00:00Z")})
        .where(eq(jubelioSalesOperations.id, old.operationId));
      const result = await listStaleJubelioSalesOperations(d!, new Date("2025-01-01T00:00:00Z"), 50);
      expect(result.map((row) => row.id)).toContain(old.operationId);
      expect(result.map((row) => row.id)).not.toContain(fresh.operationId);
      expect(result.every((row) => row.status === "dispatched_unknown")).toBe(true);
    });

    it("does not prematurely mark a fresh dispatch as manual review", async () => {
      const { operationId } = await seedOrderAndIntent({
        suffix: `fresh-${Date.now()}`,
        type: "cancel",
        salesOrderId: TEST_SO_ID,
      });
      expect((await claimJubelioSalesOperationForDispatch(d!, operationId)).claimed).toBe(true);
      const reviewed = await markStaleJubelioSalesOperationForManualReview(
        d!, operationId, new Date("2025-01-01T00:00:00Z")
      );
      expect(reviewed).toBeNull();
      const existing = await d!.select().from(jubelioSalesOperations)
        .where(eq(jubelioSalesOperations.id, operationId));
      expect(existing[0].status).toBe("dispatched_unknown");
    });

    it("never grants a second dispatch after the write is possibly sent", async () => {
      const { operationId } = await seedOrderAndIntent({
        suffix: `replay-${Date.now()}`,
        type: "cancel",
        salesOrderId: TEST_SO_ID,
      });
      const first = await claimJubelioSalesOperationForDispatch(d!, operationId);
      expect(first.claimed).toBe(true);
      // Replay (crash after claim, retry, duplicate cron) must be refused:
      // the post-send state is unknown, so the write must never be re-POSTed.
      const replay = await claimJubelioSalesOperationForDispatch(d!, operationId);
      expect(replay.claimed).toBe(false);
      expect(replay.claimed === false && replay.reason).toBe("not_dispatchable");
    });

    it("enforces schema invariants: cancel requires a known SO id", async () => {
      const clientId = `${TEST_ID_PREFIX}client-check-${Date.now()}`;
      const orderId = `${TEST_ID_PREFIX}order-check-${Date.now()}`;
      testClientIds.push(clientId);
      await d!.insert(clients).values({
        id: clientId,
        name: "Ledger DB Test",
        email: `${clientId}@example.com`,
        emailVerified: true,
      });
      await d!.insert(orders).values({
        id: orderId,
        userId: clientId,
        contactPhone: "081234567890",
        contactEmail: `${clientId}@example.com`,
        subtotal: "150000",
        total: "166500",
      });
      await expect(
        d!
          .insert(jubelioSalesOperations)
          .values({
            id: `${TEST_ID_PREFIX}op-check-${Date.now()}`,
            orderId,
            type: "cancel",
            reference: `OKCIR_SO_CANCEL:${orderId}:check`,
            payload: { type: "cancel", cancel: { salesOrderId: TEST_SO_ID } },
          })
      ).rejects.toMatchObject({
        cause: {
          code: "23514", // PostgreSQL CHECK violation
          constraint: "jubelio_sales_operation_cancel_requires_sales_order",
        },
      });
    });

    it("enforces one operation per (order, type)", async () => {
      const { orderId } = await seedOrderAndIntent({
        suffix: `unique-${Date.now()}`,
        type: "create",
      });
      await expect(
        d!
          .insert(jubelioSalesOperations)
          .values({
            id: `${TEST_ID_PREFIX}op-unique-2-${Date.now()}`,
            orderId,
            type: "create",
            reference: `OKCIR_SO_CREATE:${orderId}:second-${Date.now()}`,
            payload: {
              type: "create",
              create: {
                contactId: -1,
                customerName: "Ledger DB Test",
                locationId: 61,
                note: `OKCIR_SO_CREATE:${orderId}:second`,
                items: [],
              },
            },
          })
      ).rejects.toMatchObject({
        cause: {
          code: "23505", // PostgreSQL unique violation
          constraint: "jubelio_sales_operation_order_type_unique",
        },
      });
    });

    it("is idempotent on intent replay: recordJubelioSalesIntent returns the existing row", async () => {
      const suffix = `intent-${Date.now()}`;
      const { orderId, operationId } = await seedOrderAndIntent({
        suffix,
        type: "create",
      });
      const second = await recordJubelioSalesIntent(d!, {
        orderId,
        type: "create",
        reference: `OKCIR_SO_CREATE:${orderId}:${operationId}`,
        payload: {
          type: "create",
          create: {
            contactId: -1,
            customerName: "Ledger DB Test",
            locationId: 61,
            note: `OKCIR_SO_CREATE:${orderId}:${operationId}`,
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
      });
      expect(second.created).toBe(false);
      expect(second.operation.id).toBe(operationId);
    });
  }
);
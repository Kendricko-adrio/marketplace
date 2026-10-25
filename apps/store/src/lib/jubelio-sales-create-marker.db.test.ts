import { deleteRetainedOrderFixtures } from "@marketplace/db/src/testing/retained-order-fixtures";
import dotenv from "dotenv";
import path from "node:path";
dotenv.config({ path: path.resolve(import.meta.dirname, "../../../../.env") });
import { afterAll, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { Pool } from "pg";
import type { JubelioSalesGateway } from "./jubelio-sales-client";
// The app DB module reads DATABASE_URL at import time; load .env first.
const { db, branchStocks, branches, clients, orderItems, orders, products, productVariants } = await import("@/db");
const { dispatchJubelioSalesCreate } = await import("./jubelio-sales-lifecycle");
const { getJubelioSalesOperation } = await import("./jubelio-sales-operations");
// The app logging facade (not the core, not a mock): the request scope and the
// canonical request id are observed exactly where the runtime produces them.
const { getRequestId, withRequestContext } = await import("./logger");

type DispatchCreateResult = Awaited<ReturnType<typeof dispatchJubelioSalesCreate>>;
type LogRecord = Record<string, unknown>;

/** Fixed envelope of one application log line (maintainable-code §7.2). */
const FIXED_LOG_FIELDS = [
  "app",
  "level",
  "message",
  "module",
  "requestId",
  "timestamp",
] as const;

/** Field opsional yang diizinkan pada envelope yang sama (§7.2). */
const OPTIONAL_LOG_FIELDS = ["error"] as const;

/** Canonical server-generated UUID — an incoming header is never canonical. */
const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * External sink under test: the process stdout. Logger internals (module
 * logger, core, root instance) are never imported or mocked here, so a line is
 * observed exactly where production writes it.
 */
function captureStdout(): { captured: string[]; restore: () => void } {
  const captured: string[] = [];
  const spy = vi.spyOn(process.stdout, "write").mockImplementation(
    (chunk: string | Uint8Array): boolean => {
      captured.push(
        typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8")
      );
      return true;
    }
  );
  return { captured, restore: () => spy.mockRestore() };
}

/** Every JSON application line of this run; non-JSON output is not a log line. */
function jsonLogRecords(captured: string[]): LogRecord[] {
  const records: LogRecord[] = [];
  for (const line of captured.join("").split("\n")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof parsed !== "object" || parsed === null) continue;
    records.push(parsed as LogRecord);
  }
  return records;
}

function messageOf(record: LogRecord): string {
  return typeof record.message === "string" ? record.message : "";
}

// The provider boundary is deliberately a stub: no login or real Jubelio POST.
// This is the approved per-order DB seam, not a fake in-memory claim.
const prefix = `create-marker-${crypto.randomUUID()}`;
const clientId = `${prefix}-client`;
const branchId = `${prefix}-branch`;
const productId = `${prefix}-product`;
const variantId = `${prefix}-variant`;
const orderId = `${prefix}-order`;
const remoteId = 9_880_301; // local stub id, never fetched from Jubelio
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

it("records marker-only divergence on a confirmed create without stopping the local pending order or repeating POST", async () => {
  await db.insert(clients).values({ id: clientId, name: "Marker Test", email: `${clientId}@example.test`, emailVerified: true });
  await db.insert(branches).values({ id: branchId, code: prefix, name: "Marker Test", city: "Test", address: "Test" });
  await db.insert(products).values({ id: productId, slug: prefix, name: "Marker Test", basePrice: "1000" });
  await db.insert(productVariants).values({ id: variantId, productId, sku: prefix, price: "1000" });
  await db.insert(branchStocks).values({ branchId, productVariantId: variantId, availableStock: 5, pendingRemoteStock: 1 });
  await db.insert(orders).values({
    id: orderId, userId: clientId, branchId, status: "pending_payment", paymentStatus: "pending",
    contactEmail: `${clientId}@example.test`, contactPhone: "00000000", subtotal: "1000", total: "1000",
  });
  await db.insert(orderItems).values({
    id: `${prefix}-line`, orderId, variantId, productName: "Marker Test", quantity: 1, price: "1000",
  });

  const create = {
    contactId: -1, customerName: "Marker Test", locationId: 7,
    note: `OKCIR_SO_CREATE:${orderId}`, refNo: orderId, channelStatus: "Belum Bayar" as const,
    items: [{ itemId: 43842, quantity: 1, price: 1000, discAmount: 0, taxAmount: 0, unit: "Buah", taxId: 1 }],
  };
  let posts = 0;
  const gateway = {
    createSalesOrder: async () => {
      posts++;
      const intent = await getJubelioSalesOperation(db, { orderId, type: "create" });
      expect(intent?.status).toBe("dispatched_unknown");
      expect(intent?.payload).toMatchObject({ type: "create", create: { channelStatus: "Belum Bayar" } });
      return { salesOrderId: remoteId, order: { channelStatus: "Operator changed marker" } };
    },
  } as unknown as JubelioSalesGateway;

  // Both the first dispatch and its replay run through the real app HTTP scope
  // wrapper: no logger is injected, and the correlation observed below comes
  // from the AsyncLocalStorage scope, not from a parameter.
  let firstOutcome: DispatchCreateResult | null = null;
  let replayOutcome: DispatchCreateResult | null = null;
  let firstScopeRequestId: string | null = null;
  let replayScopeRequestId: string | null = null;
  let firstHeaderRequestId: string | null = null;
  let replayHeaderRequestId: string | null = null;
  const { captured, restore } = captureStdout();
  try {
    const firstHandler = withRequestContext(async () => {
      firstScopeRequestId = getRequestId();
      firstOutcome = await dispatchJubelioSalesCreate({ orderId, create, gateway });
      return Response.json({ ok: true });
    });
    const firstResponse = await firstHandler();
    firstHeaderRequestId = firstResponse.headers.get("x-request-id");
    const replayHandler = withRequestContext(async () => {
      replayScopeRequestId = getRequestId();
      replayOutcome = await dispatchJubelioSalesCreate({ orderId, create, gateway });
      return Response.json({ ok: true });
    });
    const replayResponse = await replayHandler();
    replayHeaderRequestId = replayResponse.headers.get("x-request-id");
  } finally {
    restore();
  }

  // ---- Business behaviour: unchanged by the logging migration. ----
  expect(firstOutcome).toEqual({ status: "confirmed", salesOrderId: remoteId });
  expect(replayOutcome).toEqual(firstOutcome);
  expect(posts).toBe(1);
  const record = await getJubelioSalesOperation(db, { orderId, type: "create" });
  expect(record).toMatchObject({
    status: "confirmed", salesOrderId: remoteId,
    channelStatusMismatchReason: "CREATE_MARKER_MISMATCH",
  });
  expect(record?.channelStatusMismatchAt).toBeInstanceOf(Date);
  const [local] = await db.select({ status: orders.status, paymentStatus: orders.paymentStatus, salesOrderId: orders.jubelioSalesOrderId })
    .from(orders).where(eq(orders.id, orderId));
  expect(local).toEqual({ status: "pending_payment", paymentStatus: "pending", salesOrderId: remoteId });
  if (!record) throw new Error("create operation hilang setelah dispatch");
  const operationId = record.id;

  // ---- Log evidence (only meaningful once the business assertions passed). ----
  // Correlation: the scope id and the response header are the same canonical
  // server-generated UUID, and the two invocations never share it.
  expect(firstScopeRequestId).toBe(firstHeaderRequestId);
  expect(replayScopeRequestId).toBe(replayHeaderRequestId);
  expect(firstHeaderRequestId).toMatch(CANONICAL_UUID);
  expect(replayHeaderRequestId).toMatch(CANONICAL_UUID);
  expect(firstHeaderRequestId).not.toBe(replayHeaderRequestId);

  const records = jsonLogRecords(captured);
  expect(records.length).toBeGreaterThan(0);
  const allowedFields: readonly string[] = [...FIXED_LOG_FIELDS, ...OPTIONAL_LOG_FIELDS];
  for (const logged of records) {
    // No legacy line survives: the envelope is the fixed six fields (plus the
    // optional `error`), owned by the store runtime.
    expect(Object.keys(logged).filter((key) => !allowedFields.includes(key))).toEqual([]);
    for (const field of FIXED_LOG_FIELDS) {
      expect(logged).toHaveProperty(field);
    }
    expect(logged.app).toBe("store");
    expect(logged.requestId).toMatch(CANONICAL_UUID);
  }

  const lifecycleRecords = records.filter((logged) => logged.module === "jubelio-sales-lifecycle");
  const scopeRequestIds = [String(firstHeaderRequestId), String(replayHeaderRequestId)];
  expect(lifecycleRecords.every((logged) => scopeRequestIds.includes(String(logged.requestId)))).toBe(true);

  const createScopeRecords = lifecycleRecords.filter(
    (logged) => logged.requestId === firstHeaderRequestId
  );
  expect(createScopeRecords.map((logged) => logged.level)).toEqual(["info", "error", "info", "info"]);

  const [dispatched, mismatch, holdAccounted, created] = createScopeRecords;
  // Business references belong in the message: order, operation and remote ids
  // stay greppable without binding arbitrary metadata fields.
  expect(messageOf(dispatched)).toContain(orderId);
  expect(messageOf(dispatched)).toContain(operationId);
  expect(messageOf(mismatch)).toContain(orderId);
  expect(messageOf(mismatch)).toContain(String(remoteId));
  expect(messageOf(mismatch)).toContain("CREATE_MARKER_MISMATCH");
  expect(messageOf(holdAccounted)).toContain(orderId);
  expect(messageOf(created)).toContain(orderId);
  expect(messageOf(created)).toContain(String(remoteId));
  expect(messageOf(created)).toContain(operationId);

  // Privacy: the raw provider marker, the customer name, the create note and
  // any request payload never reach a log line.
  const rawLog = captured.join("");
  expect(rawLog).not.toContain("Operator changed marker");
  expect(rawLog).not.toContain("Marker Test");
  expect(rawLog).not.toContain("OKCIR_SO_CREATE:");
  expect(rawLog).not.toContain("channelStatus");
  expect(rawLog).not.toContain("customerName");
  expect(rawLog).not.toContain("itemId");
  expect(rawLog).not.toContain("payload");
});

afterAll(async () => {
  await deleteRetainedOrderFixtures(pool, [orderId]);
  await pool.query('DELETE FROM "client" WHERE id = $1', [clientId]);
  await pool.query('DELETE FROM product WHERE id = $1', [productId]);
  await pool.query('DELETE FROM branch WHERE id = $1', [branchId]);
  await pool.end();
});

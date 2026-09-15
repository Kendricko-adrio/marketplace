// =========================================================
// Fake Drizzle executor (node-postgres shape) for route/service seam tests
// =========================================================
// Mimics the subset of the Drizzle query-builder API used by the admin app's
// routes and services: select chains, insert/update/delete chains (awaitable
// with or without `.returning()`), `.for("update")` row locks, and
// `transaction(fn)` which hands the callback a DISTINCT tx executor so tests
// can assert which executor each statement ran on (the whole point of the
// "mutation + audit in one transaction" seams).
//
// Statement results come from the config: `selectQueue` rows are consumed in
// order by awaited selects; `mutationRows` are returned by every
// `.returning()` / awaited insert, update or delete; empty results are
// returned once the queue is exhausted (the natural "no rows" case).

export interface FakeDbConfig {
  /** Rows returned by awaited select chains, consumed in call order. */
  selectQueue?: Record<string, unknown>[][];
  /** Rows returned by awaited insert/update/delete chains. */
  mutationRows?: Record<string, unknown>[];
  /** Reject an insert when this predicate returns true (audit-write failure etc). */
  failInsert?: (values: Record<string, unknown>) => boolean;
  /** Reject an update when this predicate returns true. */
  failUpdate?: (set: Record<string, unknown>) => boolean;
}

export interface RecordedOp {
  kind: "select" | "insert" | "update" | "delete";
  isTx: boolean;
  values?: unknown;
  set?: unknown;
  /** Row-lock mode, e.g. "update" for `.for("update")`. */
  lock?: string;
}

export interface FakeDb {
  /** The injectable executor (what tests assign to the mocked `@/db` export). */
  db: {
    select: (...args: unknown[]) => unknown;
    insert: (table: unknown) => { values: (values: Record<string, unknown>) => unknown };
    update: (table: unknown) => { set: (set: Record<string, unknown>) => unknown };
    delete: (table: unknown) => unknown;
    transaction: (fn: (tx: unknown) => Promise<unknown>) => Promise<unknown>;
  };
  ops: RecordedOp[];
  committed: boolean;
  rolledBack: boolean;
  rollbackError: unknown;
  /** The tx executor handed to the last transaction callback (identity check). */
  lastTx: unknown;
}

export function createFakeDb(config: FakeDbConfig = {}): FakeDb {
  const ops: RecordedOp[] = [];
  const selectQueue = (config.selectQueue ?? []).map((rows) => [...rows]);
  const mutationRows = config.mutationRows ?? [];
  let committed = false;
  let rolledBack = false;
  let rollbackError: unknown;
  let lastTx: unknown = null;

  function nextSelectRows(): Record<string, unknown>[] {
    if (selectQueue.length === 0) return [];
    return selectQueue.shift()!;
  }

  function chain(promise: Promise<Record<string, unknown>[]>, op: RecordedOp) {
    const q: Record<string, unknown> = {};
    for (const method of ["from", "where", "limit", "offset", "orderBy"]) {
      q[method] = () => q;
    }
    q.set = (value: unknown) => {
      op.set = value;
      return q;
    };
    q.values = (value: unknown) => {
      op.values = value;
      return q;
    };
    q.for = (mode: string) => {
      op.lock = mode;
      return q;
    };
    q.returning = () => promise;
    // Awaitable even without `.returning()`.
    q.then = (
      onFulfilled?: (value: Record<string, unknown>[]) => unknown,
      onRejected?: (error: unknown) => unknown
    ) => promise.then(onFulfilled, onRejected);
    q.catch = (onRejected: (error: unknown) => unknown) => promise.catch(onRejected);
    q.finally = (onFinally: () => void) => promise.finally(onFinally);
    return q;
  }

  function makeExecutor(isTx: boolean) {
    const executor: Record<string, unknown> = {};

    executor.select = (..._args: unknown[]) => {
      const op: RecordedOp = { kind: "select", isTx };
      ops.push(op);
      return chain(Promise.resolve(nextSelectRows()), op);
    };

    executor.insert = (_table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        const op: RecordedOp = { kind: "insert", isTx, values };
        ops.push(op);
        const promise = config.failInsert?.(values)
          ? Promise.reject(new Error("fake insert failure"))
          : Promise.resolve(mutationRows);
        return chain(promise, op);
      },
    });

    executor.update = (_table: unknown) => ({
      set: (set: Record<string, unknown>) => {
        const op: RecordedOp = { kind: "update", isTx, set };
        ops.push(op);
        const promise = config.failUpdate?.(set)
          ? Promise.reject(new Error("fake update failure"))
          : Promise.resolve(mutationRows);
        return chain(promise, op);
      },
    });

    executor.delete = (_table: unknown) => {
      const op: RecordedOp = { kind: "delete", isTx };
      ops.push(op);
      return chain(Promise.resolve(mutationRows), op);
    };

    executor.transaction = async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = makeExecutor(true);
      lastTx = tx;
      try {
        const result = await fn(tx);
        committed = true;
        return result;
      } catch (error) {
        rolledBack = true;
        rollbackError = error;
        throw error;
      }
    };

    return executor;
  }

  const db = makeExecutor(false) as FakeDb["db"];

  return {
    db,
    ops,
    get committed() {
      return committed;
    },
    get rolledBack() {
      return rolledBack;
    },
    get rollbackError() {
      return rollbackError;
    },
    get lastTx() {
      return lastTx;
    },
  } as unknown as FakeDb;
}
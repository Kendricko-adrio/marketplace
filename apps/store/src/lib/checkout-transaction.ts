import { performance } from "node:perf_hooks";
import { sql } from "drizzle-orm";
import { db } from "@/db";

type CheckoutTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Step = <T>(query: () => PromiseLike<T>) => Promise<T>;

function rollbackRetryable(error: unknown): boolean {
  for (let depth = 0; depth < 4 && error && typeof error === "object"; depth++) {
    const value = error as { code?: unknown; cause?: unknown };
    if (value.code === "40001" || value.code === "40P01") return true;
    error = value.cause;
  }
  return false;
}

/** Batas khusus placement; callback ini tidak boleh berisi external HTTP. */
export async function runCheckoutTransaction<T>(bounded: boolean,
  work: (tx: CheckoutTx, step: Step) => Promise<T>, database = db): Promise<T> {
  const delays = [25, 75];
  for (let attempt = 0; ; attempt++) {
    try {
      return await database.transaction(async (tx) => {
        if (!bounded) return work(tx, async (query) => query());
        const deadline = performance.now() + 10_000;
        await tx.execute(sql`SET LOCAL lock_timeout = '2s'`);
        await tx.execute(sql`SET LOCAL statement_timeout = '5s'`);
        await tx.execute(sql`SET LOCAL idle_in_transaction_session_timeout = '10s'`);
        const step: Step = async (query) => {
          const remaining = deadline - performance.now();
          if (remaining <= 0) throw new Error("Checkout transaction budget exhausted.");
          // Bukan hanya timeout per statement: sisa wall budget ikut mengecil.
          await tx.execute(sql`SELECT set_config('statement_timeout', ${`${Math.max(1, Math.floor(Math.min(5000, remaining)))}ms`}, true)`);
          const result = await query();
          if (performance.now() >= deadline) throw new Error("Checkout transaction budget exhausted.");
          return result;
        };
        const result = await work(tx, step);
        await step(() => tx.execute(sql`SELECT 1`));
        return result;
      });
    } catch (error) {
      // PostgreSQL memastikan seluruh transaksi sudah rollback untuk dua kode
      // ini. Timeout/unknown/commit ambiguity tidak pernah diulang di sini.
      if (!bounded || attempt >= 2 || !rollbackRetryable(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
    }
  }
}

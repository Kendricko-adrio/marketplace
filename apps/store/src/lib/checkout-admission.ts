import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { sql } from "drizzle-orm";
import { db, discountRequestWindows } from "@/db";
import { runCheckoutTransaction } from "./checkout-transaction";

export class CheckoutAdmissionError extends Error {
  constructor(readonly status: 429 | 503, readonly code: "RATE_LIMITED" | "POLICY_UNAVAILABLE",
    readonly retryAfter?: number) {
    super(status === 429 ? "Terlalu banyak permintaan checkout. Coba beberapa saat lagi." : "Checkout belum tersedia. Coba beberapa saat lagi.");
  }
}

function trustedIp(headers: Headers, environment: Record<string, string | undefined>): string {
  // Dev/mock tidak menerima forwarded identity dari browser, walau valid IP.
  if (environment.NODE_ENV !== "production") return "127.0.0.1";
  if (environment.CHECKOUT_TRUST_PROXY !== "true") throw new CheckoutAdmissionError(503, "POLICY_UNAVAILABLE");
  const ip = (headers.get("x-real-ip") ?? "").trim();
  if (!isIP(ip)) throw new CheckoutAdmissionError(503, "POLICY_UNAVAILABLE");
  if (isIP(ip) === 6) return new URL(`http://[${ip}]/`).hostname.toLowerCase();
  return ip;
}

/** Counter ephemeral PG; tidak membaca/menghapus retained checkout result. */
export async function admitCheckoutRequest(input: {
  clientId: string; kind: "preview" | "place"; headers: Headers;
  /** Clock boundary server untuk test deterministik; tidak berasal dari payload HTTP. */
  now?: Date; environment?: Record<string, string | undefined>;
}, database = db): Promise<void> {
  const environment = input.environment ?? process.env;
  const secret = environment.BETTER_AUTH_SECRET?.trim();
  if (!secret) throw new CheckoutAdmissionError(503, "POLICY_UNAVAILABLE");
  const ip = trustedIp(input.headers, environment);
  const frozen = environment.E2E_CHECKOUT_ADMISSION_NOW;
  const mockClockAllowed = environment.NODE_ENV !== "production" && environment.E2E_PROVIDER_MOCKS === "true" &&
    /\/marketplace_discounts_test_[A-Za-z0-9_]+(?:\?|$)/.test(environment.DATABASE_URL ?? "");
  const now = input.now ?? (mockClockAllowed && frozen ? new Date(frozen) : new Date());
  if (!Number.isFinite(now.getTime())) throw new CheckoutAdmissionError(503, "POLICY_UNAVAILABLE");
  const windowStart = new Date(Math.floor(now.getTime() / 60_000) * 60_000);
  const expiresAt = new Date(windowStart.getTime() + 60_000);
  const subjectHash = (kind: string, value: string) => createHmac("sha256", secret)
    .update(`okcir:checkout-admission:v1:${kind}:${value}`).digest("hex");
  const buckets = [
    { kind: `${input.kind}:account`, subjectHash: subjectHash("account", input.clientId), limit: input.kind === "place" ? 10 : 60 },
    { kind: `${input.kind}:ip`, subjectHash: subjectHash("ip", ip), limit: input.kind === "place" ? 60 : 300 },
  ].sort((a, b) => a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : a.subjectHash.localeCompare(b.subjectHash));
  let allowed: boolean;
  try {
    allowed = await runCheckoutTransaction(true, async (tx, step) => {
      let withinLimits = true;
      for (const bucket of buckets) {
        const [row] = await step(() => tx.insert(discountRequestWindows).values({
          kind: bucket.kind, subjectHash: bucket.subjectHash, windowStart, expiresAt, count: 1,
        }).onConflictDoUpdate({
          target: [discountRequestWindows.kind, discountRequestWindows.subjectHash, discountRequestWindows.windowStart],
          set: { count: sql`LEAST(${discountRequestWindows.count}::bigint + 1, ${bucket.limit + 1})::integer` },
        }).returning({ count: discountRequestWindows.count }));
        if (!row || row.count > bucket.limit) withinLimits = false;
      }
      // Maksimal 100 row/request, umur window 10 menit. Tidak ada cron baru.
      await step(() => tx.execute(sql`DELETE FROM discount_request_window WHERE ctid IN (
        SELECT ctid FROM discount_request_window WHERE expires_at <= ${new Date(now.getTime() - 540_000)}
        ORDER BY expires_at LIMIT 100 FOR UPDATE SKIP LOCKED
      )`));
      return withinLimits;
    }, database);
  } catch { throw new CheckoutAdmissionError(503, "POLICY_UNAVAILABLE"); }
  if (!allowed) throw new CheckoutAdmissionError(429, "RATE_LIMITED", Math.max(1, Math.ceil((expiresAt.getTime() - now.getTime()) / 1000)));
}

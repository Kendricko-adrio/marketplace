import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { Pool } from "pg";
import { createHmac } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@marketplace/db/src/schema";
import { admitCheckoutRequest } from "./checkout-admission";

const url = process.env.DATABASE_URL ?? "";
const enabled = !!url && /^marketplace_discounts_test_[A-Za-z0-9_]+$/.test(new URL(url).pathname.slice(1));
if (url && !enabled) throw new Error("Admission SQL tests menolak database non-disposable.");
const poolA = new Pool({ connectionString: url });
const poolB = new Pool({ connectionString: url });
const dbA = drizzle(poolA, { schema });
const dbB = drizzle(poolB, { schema });
const now = new Date("2040-01-01T00:00:10Z");
const environment = { NODE_ENV: "test", BETTER_AUTH_SECRET: "checkout02-admission-fixture-secret-only" };

describe.skipIf(!enabled)("checkout admission lintas koneksi PostgreSQL", () => {
  beforeAll(async () => {
    const subjects = ["checkout02-admission-client", "checkout02-ip-overflow", "checkout02-proxy-policy",
      ...Array.from({ length: 60 }, (_, i) => `checkout02-shared-ip-${i}`)];
    const hash = (kind: string, value: string) => createHmac("sha256", environment.BETTER_AUTH_SECRET)
      .update(`okcir:checkout-admission:v1:${kind}:${value}`).digest("hex");
    await poolA.query("DELETE FROM discount_request_window WHERE subject_hash=ANY($1::text[])",
      [[...subjects.map((id) => hash("account", id)), hash("ip", "127.0.0.1")]]);
  });
  afterAll(async () => { await poolA.end(); await poolB.end(); });
  it("membatasi 10 placement baru per account, berbagi counter antar koneksi, reset sesudah window", async () => {
    const input = { clientId: "checkout02-admission-client", kind: "place" as const,
      headers: new Headers({ "x-forwarded-for": "203.0.113.8" }), now, environment };
    for (let i = 0; i < 10; i++) {
      await expect(admitCheckoutRequest(input, i % 2 ? dbA : dbB)).resolves.toBeUndefined();
    }
    await expect(admitCheckoutRequest(input, dbB)).rejects.toMatchObject({
      code: "RATE_LIMITED", status: 429, retryAfter: 50,
    });
    await expect(admitCheckoutRequest({ ...input, now: new Date("2040-01-01T00:01:00Z") }, dbA)).resolves.toBeUndefined();
  });
  it("dev mengabaikan forged forwarded headers dan memberlakukan batas IP60 meskipun account berbeda", async () => {
    for (let i = 0; i < 60; i++) {
      await expect(admitCheckoutRequest({ clientId: `checkout02-shared-ip-${i}`, kind: "place",
        headers: new Headers({ "x-real-ip": `203.0.113.${i + 1}`, "x-forwarded-for": `203.0.113.${i + 1}` }),
        now: new Date("2040-01-01T00:02:10Z"), environment,
      }, i % 2 ? dbA : dbB)).resolves.toBeUndefined();
    }
    await expect(admitCheckoutRequest({ clientId: "checkout02-ip-overflow", kind: "place",
      headers: new Headers({ "x-real-ip": "198.51.100.99" }), now: new Date("2040-01-01T00:02:10Z"), environment,
    }, dbB)).rejects.toMatchObject({ code: "RATE_LIMITED", status: 429, retryAfter: 50 });
  });
  it("production fail-closed tanpa trusted policy atau dengan IP header malformed", async () => {
    const input = { clientId: "checkout02-proxy-policy", kind: "preview" as const, now,
      headers: new Headers({ "x-real-ip": "203.0.113.1" }) };
    await expect(admitCheckoutRequest({ ...input, environment: { ...environment, NODE_ENV: "production" } }, dbA))
      .rejects.toMatchObject({ code: "POLICY_UNAVAILABLE", status: 503 });
    await expect(admitCheckoutRequest({ ...input, headers: new Headers({ "x-real-ip": "203.0.113.1, 127.0.0.1" }),
      environment: { ...environment, NODE_ENV: "production", CHECKOUT_TRUST_PROXY: "true" },
    }, dbB)).rejects.toMatchObject({ code: "POLICY_UNAVAILABLE", status: 503 });
  });
});

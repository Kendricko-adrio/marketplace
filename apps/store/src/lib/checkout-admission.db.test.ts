import dotenv from "dotenv";
import path from "node:path";
dotenv.config({ path: path.resolve(import.meta.dirname, "../../../../.env"), quiet: true });
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { Pool } from "pg";
import { createHmac } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@marketplace/db/src/schema";
import { admitCheckoutRequest } from "./checkout-admission";
import { carriesManualPromoCode } from "./checkout-admission";

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
    const subjects = [
      "checkout02-admission-client",
      "checkout02-ip-overflow",
      "checkout02-proxy-policy",
      ...Array.from({ length: 60 }, (_, i) => `checkout02-shared-ip-${i}`),
      "checkout02-code-client",
      "checkout02-code-overflow",
      ...Array.from({ length: 121 }, (_, i) => `checkout02-code-ip-${i}`),
    ];
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
  it("manual code: 20 per account per 60 detik dengan Retry-After, lintas koneksi", async () => {
    const input = {
      clientId: "checkout02-code-client",
      kind: "preview" as const,
      carriesManualCode: true,
      headers: new Headers({ "x-real-ip": "203.0.113.30" }),
      now: new Date("2040-01-01T00:03:10Z"),
      environment,
    };
    for (let i = 0; i < 20; i++) {
      await expect(admitCheckoutRequest(input, i % 2 ? dbA : dbB)).resolves.toBeUndefined();
    }
    await expect(admitCheckoutRequest(input, dbB)).rejects.toMatchObject({
      code: "RATE_LIMITED",
      status: 429,
      retryAfter: 50,
    });
    // Window baru kembali memberi jatah penuh (fixed window server clock).
    await expect(
      admitCheckoutRequest({ ...input, now: new Date("2040-01-01T00:04:10Z") }, dbA)
    ).resolves.toBeUndefined();
  });

  it("manual code: batas IP 120 dipakai bersama banyak akun; shared IP bukan entitlement", async () => {
    // Satu IP, 120 akun berbeda, semuanya membawa manual code.
    for (let i = 0; i < 120; i++) {
      await admitCheckoutRequest(
          {
            clientId: `checkout02-code-ip-${i}`,
            kind: "preview",
            carriesManualCode: true,
            headers: new Headers({ "x-real-ip": "203.0.113.40" }),
            now: new Date("2040-01-01T00:05:10Z"),
            environment,
          },
          i % 2 ? dbA : dbB
        ).catch((error) => { throw new Error(`i=${i}: ${error.message}`); });
    }
    // Akun ke-121 dari IP yang sama tidak mendapat jatah baru karena akunnya baru.
    await expect(
      admitCheckoutRequest(
        {
          clientId: "checkout02-code-ip-120",
          kind: "preview",
          carriesManualCode: true,
          headers: new Headers({ "x-real-ip": "203.0.113.40" }),
          now: new Date("2040-01-01T00:05:10Z"),
          environment,
        },
        dbB
      )
    ).rejects.toMatchObject({ code: "RATE_LIMITED", status: 429, retryAfter: 50 });
    // Di dev/test header IP diabaikan (trustedIp = loopback), jadi header lain
    // TIDAK memberi bucket baru. Window berikutnya tetap mendapat jatah penuh.
    await expect(
      admitCheckoutRequest(
        {
          clientId: "checkout02-code-overflow",
          kind: "preview",
          carriesManualCode: true,
          headers: new Headers({ "x-real-ip": "203.0.113.41", "x-forwarded-for": "198.51.100.7" }),
          now: new Date("2040-01-01T00:05:10Z"),
          environment,
        },
        dbB
      )
    ).rejects.toMatchObject({ code: "RATE_LIMITED", status: 429 });
    await expect(
      admitCheckoutRequest(
        {
          clientId: "checkout02-code-overflow",
          kind: "preview",
          carriesManualCode: true,
          headers: new Headers({ "x-real-ip": "203.0.113.41" }),
          now: new Date("2040-01-01T00:06:10Z"),
          environment,
        },
        dbB
      )
    ).resolves.toBeUndefined();
  });

  it("deteksi manual code mencakup shape invalid tanpa membaca literal ke log", () => {
    expect(carriesManualPromoCode({ promoSelection: { kind: "manual", code: "X" } })).toBe(true);
    expect(carriesManualPromoCode({ promoSelection: { code: "X" } })).toBe(true);
    expect(carriesManualPromoCode({ previous: { promoSelection: { kind: "manual" } } })).toBe(true);
    expect(carriesManualPromoCode({ promoSelection: { kind: "public", offerId: "o" } })).toBe(false);
    expect(carriesManualPromoCode({ promoSelection: { kind: "none" } })).toBe(false);
    expect(carriesManualPromoCode(null)).toBe(false);
    // Kedalaman ekstrem tidak boleh menjadi jalur crash.
    let deep: Record<string, unknown> = {};
    for (let i = 0; i < 40; i++) deep = { nested: deep };
    expect(carriesManualPromoCode(deep)).toBe(false);
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

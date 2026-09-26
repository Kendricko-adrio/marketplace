import { describe, expect, it } from "vitest";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { getTableName } from "drizzle-orm";
import {
  CHANNEL_STATUS_MARKERS,
  jubelioChannelStatusIntents,
} from "./jubelio-channel";

// Schema-convention guard for the durable per-order channel-status mirror
// projection (ticket #03 — Siap Proses edit, crash-tolerant). Every datetime
// column MUST be timestamptz (docs/architecture/database.md), the projection
// must be tied to the local order with a cascade FK, and the at-most-once
// mirror invariants (one intent per (order, target version); monotonic
// targets; possibly-sent always carries a dispatch timestamp; an investigated
// or confirmed intent always carries its durable evidence) must be enforced
// by the schema itself, not only by app code.
const config = getTableConfig(jubelioChannelStatusIntents);
const checkNames = config.checks.map((c) => c.name);
const uniqueIndexNames = config.indexes
  .filter((index) => index.config.unique)
  .map((index) => index.config.name);

describe("jubelio_channel_status_intent schema conventions", () => {
  it("stores every datetime column as timestamptz", () => {
    const timestampColumns = config.columns.filter((column) =>
      column.getSQLType().startsWith("timestamp")
    );
    expect(timestampColumns.length).toBeGreaterThan(0);
    for (const column of timestampColumns) {
      expect(column.getSQLType()).toBe("timestamp with time zone");
    }
  });

  it("is tied to the local order with an ON DELETE CASCADE FK", () => {
    expect(config.foreignKeys.length).toBe(1);
    const reference = config.foreignKeys[0].reference();
    expect(getTableName(reference.foreignTable)).toBe("orders");
    expect(config.foreignKeys[0].onDelete).toBe("cascade");
  });

  it("allows exactly one intent per (order, monotonic target version)", () => {
    expect(uniqueIndexNames).toContain(
      "jubelio_channel_status_intent_order_version_unique"
    );
  });

  it("exposes a bounded scan index over the dispatch status", () => {
    const indexNames = config.indexes.map((index) => index.config.name);
    expect(indexNames).toContain("idx_jubelio_channel_status_intent_status");
  });

  it("serializes the ACTIVE dispatch per SALES ORDER in the database (partial unique index)", () => {
    // Spec serialization is per SO, not per local order: two different local
    // orders that reference the same sales_order_id must never both hold a
    // `possibly_sent` (active) dispatch. The DB enforces it with a PARTIAL
    // unique index; the app claim treats the violation as fail-closed.
    const activeIndex = config.indexes.find(
      (index) =>
        index.config.name === "jubelio_channel_status_intent_active_per_so_unique"
    );
    expect(activeIndex).toBeDefined();
    expect(activeIndex!.config.unique).toBe(true);
    const whereSql = activeIndex!.config.where
      ? new PgDialect().sqlToQuery(activeIndex!.config.where).sql
      : "";
    expect(whereSql).toContain("possibly_sent");
    expect(activeIndex!.config.columns.map((column) => String(column.name))).toEqual([
      "sales_order_id",
    ]);
  });

  it("restricts targets to the approved channel-status marker allowlist", () => {
    expect(checkNames).toContain(
      "jubelio_channel_status_intent_target_valid"
    );
    expect([...CHANNEL_STATUS_MARKERS]).toEqual([
      "Belum Bayar",
      "Menunggu Verifikasi",
      "Siap Proses",
      "Gagal Bayar",
      "Dibatalkan",
      "Selesai",
    ]);
  });

  it("enforces the dispatch state machine invariants with check constraints", () => {
    expect(checkNames).toContain("jubelio_channel_status_intent_status_valid");
    expect(checkNames).toContain(
      "jubelio_channel_status_intent_attempt_nonnegative"
    );
    expect(checkNames).toContain(
      "jubelio_channel_status_intent_sales_order_positive"
    );
    expect(checkNames).toContain(
      "jubelio_channel_status_intent_version_positive"
    );
    // A claimed (possibly sent) intent always carries its dispatch timestamp,
    // so GET-only recovery has a bounded cutoff.
    expect(checkNames).toContain(
      "jubelio_channel_status_intent_possibly_sent_requires_dispatched_at"
    );
    // An investigation case is only ever recorded WITH a durable, PII-safe
    // reason — never as an unlabeled failure.
    expect(checkNames).toContain(
      "jubelio_channel_status_intent_needs_investigation_requires_reason"
    );
    // A confirmed intent always carries the marker observed by the
    // independent post-edit GET.
    expect(checkNames).toContain(
      "jubelio_channel_status_intent_confirmed_requires_observed_status"
    );
  });
});
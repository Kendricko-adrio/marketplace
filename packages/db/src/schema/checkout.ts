import { sql } from "drizzle-orm";
import { pgTable, text, timestamp, jsonb, check, uniqueIndex, index, integer, primaryKey } from "drizzle-orm/pg-core";
import { clients } from "./auth";
import { orders } from "./orders";

/**
 * Counter admission rate-limit yang ephemeral (spec §5.5). Terpisah dari
 * accepted checkout result: baris di sini boleh kedaluwarsa dan dibersihkan
 * opportunistic, sedangkan `checkout_request` retained bersama order.
 */
export const discountRequestWindows = pgTable("discount_request_window", {
  kind: text("kind").notNull(),
  subjectHash: text("subject_hash").notNull(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
  count: integer("count").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (t) => [
  primaryKey({ columns: [t.kind, t.subjectHash, t.windowStart] }),
  index("discount_request_window_expiry_idx").on(t.expiresAt),
  check("discount_request_window_count_valid", sql`${t.count} >= 0`),
  check("discount_request_window_subject_valid", sql`${t.subjectHash} ~ '^[a-f0-9]{64}$'`),
  check("discount_request_window_kind_valid", sql`${t.kind} IN ('preview:account','preview:ip','place:account','place:ip','code:account','code:ip')`),
  check("discount_request_window_expiry_valid", sql`${t.expiresAt} = ${t.windowStart} + interval '60 seconds'`),
]);

/** Hasil placement yang retained; bukan counter rate atau reservation sementara. */
export const checkoutRequests = pgTable("checkout_request", {
  id: text("id").primaryKey(),
  clientId: text("client_id").notNull().references(() => clients.id, { onDelete: "restrict" }),
  requestKey: text("request_key").notNull(),
  fingerprint: text("fingerprint").notNull(),
  status: text("status").notNull().default("accepted"),
  orderId: text("order_id").notNull().references(() => orders.id, { onDelete: "restrict" }),
  result: jsonb("result").$type<{ version: 1; orderId: string }>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("checkout_request_owner_key_unique").on(t.clientId, t.requestKey),
  uniqueIndex("checkout_request_order_unique").on(t.orderId),
  index("checkout_request_key_idx").on(t.requestKey),
  check("checkout_request_key_valid", sql`${t.requestKey} ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'`),
  check("checkout_request_fingerprint_valid", sql`${t.fingerprint} ~ '^[0-9a-f]{64}$'`),
  check("checkout_request_accepted_result_valid", sql`(${t.status} = 'accepted' AND jsonb_typeof(${t.result}) = 'object' AND ${t.result}->'version' = '1'::jsonb AND ${t.result}->>'orderId' = ${t.orderId} AND octet_length(${t.result}::text) <= 262144) IS TRUE`),
]);

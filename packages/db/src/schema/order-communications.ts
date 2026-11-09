import {
  pgTable,
  text,
  integer,
  timestamp,
  uniqueIndex,
  index,
  check,
  pgEnum,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { orders } from "./orders";

// =========================================================
// ORDER COMMUNICATIONS (spec: penyelarasan status, notifikasi, dan email)
//
// Dua tabel durable:
//   1. `order_communication_event` — FAKTA unik (order_id, kind) yang ditulis
//      oleh app pemilik transaksi bisnis (store settlement, shared shipment
//      tracking, admin delivery follow-up) pada tx/db milik pemanggil.
//   2. `order_email_job`         — TUGAS komunikasi unik (order_id, kind)
//      yang diproduksi worker store dari event committed, dengan claim/lease
//      atomik, batas 4 attempt, dan hasil yang aman dicatat.
//
// Batas penting: event bagian fakta TIDAK ditimpa oleh checkpoint produksi
// efek (`email_job_created_at`, `notification_created_at`), sehingga replay
// pemicu tidak pernah membuat pekerjaan atau notifikasi kedua, dan
// penghapusan baris notifikasi oleh admin tidak menghilangkan jejak produksi.
// =========================================================

export const ORDER_COMMUNICATION_KINDS = [
  "delivery_ready",
  "delivery_in_transit",
  "delivery_delivered",
  "delivery_closed_manually",
  "pickup_ready",
  "pickup_completed",
  "payment_failed",
] as const;

export type OrderCommunicationKindDb = (typeof ORDER_COMMUNICATION_KINDS)[number];

export const ORDER_EMAIL_JOB_STATUSES = [
  "pending",
  "sending",
  "retry",
  "sent",
  "failed",
  "superseded",
] as const;

export type OrderEmailJobStatusDb = (typeof ORDER_EMAIL_JOB_STATUSES)[number];

export const orderCommunicationKindEnum = pgEnum(
  "order_communication_kind",
  ORDER_COMMUNICATION_KINDS
);

export const orderEmailJobStatusEnum = pgEnum(
  "order_email_job_status",
  ORDER_EMAIL_JOB_STATUSES
);

export const orderCommunicationEvents = pgTable(
  "order_communication_event",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    // Fakta immutable: jenis kejadian dan sumber buktinya.
    kind: orderCommunicationKindEnum("kind").notNull(),
    source: text("source").notNull(),
    // Waktu kejadian menurut sumber bukti (nullable bila sumber tidak
    // memberi waktu). `received_at` selalu waktu pencatatan lokal.
    occurredAt: timestamp("occurred_at", { withTimezone: true }),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    // CHECKPOINT produksi efek (bukan bagian fakta).
    emailJobCreatedAt: timestamp("email_job_created_at", { withTimezone: true }),
    notificationCreatedAt: timestamp("notification_created_at", {
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("order_communication_event_order_kind_unique").on(
      t.orderId,
      t.kind
    ),
    index("idx_order_communication_event_pending_effects").on(
      t.emailJobCreatedAt,
      t.notificationCreatedAt
    ),
    check(
      "order_communication_event_source_nonempty",
      sql`length(btrim(${t.source})) > 0`
    ),
  ]
);

export const orderEmailJobs = pgTable(
  "order_email_job",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    kind: orderCommunicationKindEnum("kind").notNull(),
    eventId: text("event_id")
      .notNull()
      .references(() => orderCommunicationEvents.id, { onDelete: "cascade" }),
    status: orderEmailJobStatusEnum("status").notNull().default("pending"),
    // Jumlah attempt yang SUDAH tercatat (dinaikkan sebelum dispatch, jadi
    // crash setelah dispatch tidak pernah mereset hitungan).
    attemptCount: integer("attempt_count").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    claimToken: text("claim_token"),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    // Kode error PII-safe milik aplikasi; raw SMTP error/credential/body
    // provider tidak pernah disimpan di sini.
    errorCode: text("error_code"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("order_email_job_order_kind_unique").on(t.orderId, t.kind),
    index("idx_order_email_job_due").on(t.status, t.nextAttemptAt),
    index("idx_order_email_job_lease").on(t.status, t.leaseUntil),
    check(
      "order_email_job_attempt_count_valid",
      sql`${t.attemptCount} >= 0 and ${t.attemptCount} <= 4`
    ),
    check(
      "order_email_job_lease_complete",
      sql`(${t.status} <> 'sending' or (${t.claimToken} is not null and ${t.leaseUntil} is not null))`
    ),
  ]
);

export type OrderCommunicationEvent = typeof orderCommunicationEvents.$inferSelect;
export type NewOrderCommunicationEvent =
  typeof orderCommunicationEvents.$inferInsert;
export type OrderEmailJob = typeof orderEmailJobs.$inferSelect;
export type NewOrderEmailJob = typeof orderEmailJobs.$inferInsert;

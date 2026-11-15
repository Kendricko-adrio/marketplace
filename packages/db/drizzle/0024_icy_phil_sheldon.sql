CREATE TABLE "jubelio_channel_status_intent" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"sales_order_id" integer NOT NULL,
	"target_version" integer NOT NULL,
	"target_status" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"payload" jsonb,
	"last_observed_status" text,
	"last_observed_at" timestamp with time zone,
	"mismatch_reason" text,
	"mismatch_at" timestamp with time zone,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"dispatched_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jubelio_channel_status_intent_target_valid" CHECK ("jubelio_channel_status_intent"."target_status" in ('Belum Bayar', 'Menunggu Verifikasi', 'Siap Proses', 'Gagal Bayar', 'Dibatalkan', 'Selesai')),
	CONSTRAINT "jubelio_channel_status_intent_status_valid" CHECK ("jubelio_channel_status_intent"."status" in ('pending', 'possibly_sent', 'confirmed', 'needs_investigation', 'rejected', 'aborted')),
	CONSTRAINT "jubelio_channel_status_intent_attempt_nonnegative" CHECK ("jubelio_channel_status_intent"."attempt_count" >= 0),
	CONSTRAINT "jubelio_channel_status_intent_sales_order_positive" CHECK ("jubelio_channel_status_intent"."sales_order_id" > 0),
	CONSTRAINT "jubelio_channel_status_intent_version_positive" CHECK ("jubelio_channel_status_intent"."target_version" >= 1),
	CONSTRAINT "jubelio_channel_status_intent_possibly_sent_requires_dispatched_at" CHECK ("jubelio_channel_status_intent"."status" <> 'possibly_sent' or "jubelio_channel_status_intent"."dispatched_at" is not null),
	CONSTRAINT "jubelio_channel_status_intent_needs_investigation_requires_reason" CHECK ("jubelio_channel_status_intent"."status" <> 'needs_investigation' or "jubelio_channel_status_intent"."mismatch_reason" is not null),
	CONSTRAINT "jubelio_channel_status_intent_confirmed_requires_observed_status" CHECK ("jubelio_channel_status_intent"."status" <> 'confirmed' or "jubelio_channel_status_intent"."last_observed_status" is not null)
);
--> statement-breakpoint
ALTER TABLE "jubelio_channel_status_intent" ADD CONSTRAINT "jubelio_channel_status_intent_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "jubelio_channel_status_intent_order_version_unique" ON "jubelio_channel_status_intent" USING btree ("order_id","target_version");--> statement-breakpoint
CREATE INDEX "idx_jubelio_channel_status_intent_status" ON "jubelio_channel_status_intent" USING btree ("status");
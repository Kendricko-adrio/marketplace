CREATE TYPE "public"."order_communication_kind" AS ENUM('delivery_ready', 'delivery_in_transit', 'delivery_delivered', 'delivery_closed_manually', 'pickup_ready', 'pickup_completed', 'payment_failed');--> statement-breakpoint
CREATE TYPE "public"."order_email_job_status" AS ENUM('pending', 'sending', 'retry', 'sent', 'failed', 'superseded');--> statement-breakpoint
CREATE TABLE "order_communication_event" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"kind" "order_communication_kind" NOT NULL,
	"source" text NOT NULL,
	"occurred_at" timestamp with time zone,
	"received_at" timestamp with time zone NOT NULL,
	"email_job_created_at" timestamp with time zone,
	"notification_created_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_communication_event_source_nonempty" CHECK (length(btrim("order_communication_event"."source")) > 0)
);
--> statement-breakpoint
CREATE TABLE "order_email_job" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"kind" "order_communication_kind" NOT NULL,
	"event_id" text NOT NULL,
	"status" "order_email_job_status" DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claim_token" text,
	"lease_until" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_email_job_attempt_count_valid" CHECK ("order_email_job"."attempt_count" >= 0 and "order_email_job"."attempt_count" <= 4),
	CONSTRAINT "order_email_job_lease_complete" CHECK (("order_email_job"."status" <> 'sending' or ("order_email_job"."claim_token" is not null and "order_email_job"."lease_until" is not null)))
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "order_communication_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "discount_offer_revision" ADD COLUMN "draft_configuration" jsonb;--> statement-breakpoint
ALTER TABLE "order_communication_event" ADD CONSTRAINT "order_communication_event_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_email_job" ADD CONSTRAINT "order_email_job_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_email_job" ADD CONSTRAINT "order_email_job_event_id_order_communication_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."order_communication_event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "order_communication_event_order_kind_unique" ON "order_communication_event" USING btree ("order_id","kind");--> statement-breakpoint
CREATE INDEX "idx_order_communication_event_pending_effects" ON "order_communication_event" USING btree ("email_job_created_at","notification_created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "order_email_job_order_kind_unique" ON "order_email_job" USING btree ("order_id","kind");--> statement-breakpoint
CREATE INDEX "idx_order_email_job_due" ON "order_email_job" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "idx_order_email_job_lease" ON "order_email_job" USING btree ("status","lease_until");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_order_communication_version_valid" CHECK ("orders"."order_communication_version" >= 0);--> statement-breakpoint
ALTER TABLE "discount_offer_revision" ADD CONSTRAINT "discount_offer_revision_draft_configuration_shape" CHECK ("discount_offer_revision"."draft_configuration" is null or (jsonb_typeof("discount_offer_revision"."draft_configuration") = 'object' and "discount_offer_revision"."draft_configuration"->'draftSchemaVersion' = '1'::jsonb and octet_length("discount_offer_revision"."draft_configuration"::text) <= 262144) is true);
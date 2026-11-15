CREATE TABLE "checkout_attempt" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"branch_id" text NOT NULL,
	"request_key" text NOT NULL,
	"fingerprint" text NOT NULL,
	"lifecycle_version" integer DEFAULT 2 NOT NULL,
	"reserved_order_id" text NOT NULL,
	"order_id" text,
	"state" text DEFAULT 'preparing' NOT NULL,
	"failure_code" text,
	"snapshot" jsonb NOT NULL,
	"stock_hold_state" text DEFAULT 'held' NOT NULL,
	"payment_state" text DEFAULT 'none' NOT NULL,
	"payment_token" text,
	"payment_redirect_url" text,
	"payment_transaction_id" text,
	"payment_dispatched_at" timestamp with time zone,
	"payment_event" jsonb,
	"payment_started_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checkout_attempt_owner_identity_unique" UNIQUE("id","client_id"),
	CONSTRAINT "checkout_attempt_order_identity_unique" UNIQUE("id","order_id"),
	CONSTRAINT "checkout_attempt_key_valid" CHECK ("checkout_attempt"."request_key" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
	CONSTRAINT "checkout_attempt_fingerprint_valid" CHECK ("checkout_attempt"."fingerprint" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "checkout_attempt_version_valid" CHECK ("checkout_attempt"."lifecycle_version" = 2),
	CONSTRAINT "checkout_attempt_state_valid" CHECK ("checkout_attempt"."state" IN ('preparing','compensating','processing','manual_review','rejected','promoted')),
	CONSTRAINT "checkout_attempt_promotion_valid" CHECK ((
    ("checkout_attempt"."state" = 'promoted' AND "checkout_attempt"."order_id" IS NOT NULL AND "checkout_attempt"."order_id" = "checkout_attempt"."reserved_order_id" AND "checkout_attempt"."payment_state" = 'ready')
    OR ("checkout_attempt"."state" <> 'promoted' AND "checkout_attempt"."order_id" IS NULL)) IS TRUE),
	CONSTRAINT "checkout_attempt_rejection_valid" CHECK ((
    ("checkout_attempt"."state" = 'rejected' AND "checkout_attempt"."failure_code" IN ('SALES_ORDER_REJECTED','PAYMENT_INITIALIZATION_REJECTED')
      AND "checkout_attempt"."stock_hold_state" = 'released' AND "checkout_attempt"."payment_state" IN ('none','rejected'))
    OR ("checkout_attempt"."state" <> 'rejected' AND "checkout_attempt"."failure_code" IS NULL)) IS TRUE),
	CONSTRAINT "checkout_attempt_stock_hold_valid" CHECK ("checkout_attempt"."stock_hold_state" IN ('held','mirrored','released')),
	CONSTRAINT "checkout_attempt_payment_valid" CHECK ((
    "checkout_attempt"."payment_state" IN ('none','intent','dispatched_unknown','ready','rejected','manual_review')
    AND ("checkout_attempt"."payment_state" <> 'ready' OR (length(btrim("checkout_attempt"."payment_token")) > 0 AND length(btrim("checkout_attempt"."payment_redirect_url")) > 0))
    AND ("checkout_attempt"."payment_state" NOT IN ('dispatched_unknown','ready','manual_review') OR "checkout_attempt"."payment_dispatched_at" IS NOT NULL)) IS TRUE),
	CONSTRAINT "checkout_attempt_snapshot_valid" CHECK ((jsonb_typeof("checkout_attempt"."snapshot") = 'object'
    AND "checkout_attempt"."snapshot"->'version' = '1'::jsonb AND jsonb_typeof("checkout_attempt"."snapshot"->'order') = 'object'
    AND jsonb_typeof("checkout_attempt"."snapshot"->'items') = 'array' AND jsonb_array_length("checkout_attempt"."snapshot"->'items') > 0
    AND jsonb_typeof("checkout_attempt"."snapshot"->'cart') = 'array' AND jsonb_array_length("checkout_attempt"."snapshot"->'cart') > 0
    AND jsonb_typeof("checkout_attempt"."snapshot"->'createRequest') = 'object'
    AND octet_length("checkout_attempt"."snapshot"::text) <= 262144) IS TRUE),
	CONSTRAINT "checkout_attempt_deadline_valid" CHECK ("checkout_attempt"."expires_at" > "checkout_attempt"."payment_started_at")
);
--> statement-breakpoint
ALTER TABLE "checkout_attempt" ADD CONSTRAINT "checkout_attempt_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkout_attempt" ADD CONSTRAINT "checkout_attempt_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkout_attempt" ADD CONSTRAINT "checkout_attempt_promoted_owner_fk" FOREIGN KEY ("order_id","client_id") REFERENCES "public"."orders"("id","user_id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE UNIQUE INDEX "checkout_attempt_owner_key_unique" ON "checkout_attempt" USING btree ("client_id","request_key");--> statement-breakpoint
CREATE UNIQUE INDEX "checkout_attempt_active_owner_unique" ON "checkout_attempt" USING btree ("client_id") WHERE "checkout_attempt"."state" NOT IN ('rejected', 'promoted');--> statement-breakpoint
CREATE UNIQUE INDEX "checkout_attempt_reserved_order_unique" ON "checkout_attempt" USING btree ("reserved_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "checkout_attempt_order_unique" ON "checkout_attempt" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "checkout_attempt_recovery_idx" ON "checkout_attempt" USING btree ("state","updated_at");
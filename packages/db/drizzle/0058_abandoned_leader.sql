CREATE TABLE "order_payment_session" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"provider_reference" text NOT NULL,
	"provenance" text NOT NULL,
	"state" text DEFAULT 'intent' NOT NULL,
	"expected_amount" numeric(15, 2) NOT NULL,
	"currency" text DEFAULT 'IDR' NOT NULL,
	"payment_started_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"dispatch_claim_id" text,
	"dispatched_at" timestamp with time zone,
	"token" text,
	"redirect_url" text,
	"transaction_id" text,
	"last_verified_status" text,
	"last_verified_at" timestamp with time zone,
	"last_error_code" text,
	"cart_snapshot" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_payment_session_state_valid" CHECK ("order_payment_session"."state" in ('intent', 'dispatched_unknown', 'ready', 'rejected', 'manual_review', 'paid', 'expired')),
	CONSTRAINT "order_payment_session_provenance_valid" CHECK ("order_payment_session"."provenance" in ('runtime', 'adopted_redirect', 'legacy_unknown')),
	CONSTRAINT "order_payment_session_currency_valid" CHECK ("order_payment_session"."currency" = 'IDR'),
	CONSTRAINT "order_payment_session_amount_valid" CHECK ("order_payment_session"."expected_amount" >= 0
          and "order_payment_session"."expected_amount" = trunc("order_payment_session"."expected_amount")
          and "order_payment_session"."expected_amount" <= 9999999999999),
	CONSTRAINT "order_payment_session_ready_requires_redirect" CHECK ("order_payment_session"."state" <> 'ready' or ("order_payment_session"."redirect_url" is not null and length(btrim("order_payment_session"."redirect_url")) > 0)),
	CONSTRAINT "order_payment_session_dispatched_requires_claim" CHECK ("order_payment_session"."state" <> 'dispatched_unknown' or (
        "order_payment_session"."dispatch_claim_id" is not null
        and "order_payment_session"."dispatched_at" is not null
        and "order_payment_session"."payment_started_at" is not null
        and "order_payment_session"."expires_at" is not null)),
	CONSTRAINT "order_payment_session_verified_states" CHECK ("order_payment_session"."state" not in ('paid', 'expired') or (
        "order_payment_session"."last_verified_status" is not null and "order_payment_session"."last_verified_at" is not null)),
	CONSTRAINT "order_payment_session_unclaimed_has_no_handle" CHECK ("order_payment_session"."state" not in ('intent', 'rejected') or (
        "order_payment_session"."token" is null and "order_payment_session"."redirect_url" is null)),
	CONSTRAINT "order_payment_session_intent_unclaimed" CHECK ("order_payment_session"."state" <> 'intent' or "order_payment_session"."dispatch_claim_id" is null),
	CONSTRAINT "order_payment_session_error_code_valid" CHECK ("order_payment_session"."last_error_code" is null or (
        length("order_payment_session"."last_error_code") <= 64 and "order_payment_session"."last_error_code" ~ '^[a-z_]+$')),
	CONSTRAINT "order_payment_session_cart_snapshot_size" CHECK ("order_payment_session"."cart_snapshot" is null or octet_length("order_payment_session"."cart_snapshot"::text) <= 262144)
);
--> statement-breakpoint
ALTER TABLE "order_payment_session" ADD CONSTRAINT "order_payment_session_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "order_payment_session_order_unique" ON "order_payment_session" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "order_payment_session_reference_unique" ON "order_payment_session" USING btree ("provider_reference");--> statement-breakpoint
CREATE INDEX "idx_order_payment_session_state" ON "order_payment_session" USING btree ("state","expires_at");
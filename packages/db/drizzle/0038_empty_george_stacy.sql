CREATE TABLE "checkout_request" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"request_key" text NOT NULL,
	"fingerprint" text NOT NULL,
	"status" text DEFAULT 'accepted' NOT NULL,
	"order_id" text NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checkout_request_key_valid" CHECK ("checkout_request"."request_key" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
	CONSTRAINT "checkout_request_fingerprint_valid" CHECK ("checkout_request"."fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "checkout_request_accepted_result_valid" CHECK ("checkout_request"."status" = 'accepted' AND jsonb_typeof("checkout_request"."result") = 'object' AND "checkout_request"."result"->>'version' = '1' AND "checkout_request"."result"->>'orderId' = "checkout_request"."order_id" AND octet_length("checkout_request"."result"::text) <= 262144)
);
--> statement-breakpoint
CREATE TABLE "discount_benefit" (
	"id" text PRIMARY KEY NOT NULL,
	"revision_id" text NOT NULL,
	"kind" text NOT NULL,
	"scope" text NOT NULL,
	"fixed_amount" numeric(15, 2) NOT NULL,
	"params_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discount_benefit_revision_id_unique" UNIQUE("revision_id","id"),
	CONSTRAINT "discount_benefit_kind_supported" CHECK ("discount_benefit"."kind" = 'fixed_goods'),
	CONSTRAINT "discount_benefit_scope_supported" CHECK ("discount_benefit"."scope" = 'goods'),
	CONSTRAINT "discount_benefit_fixed_amount_positive" CHECK ("discount_benefit"."fixed_amount" > 0 and "discount_benefit"."fixed_amount" <= 9999999999999 and "discount_benefit"."fixed_amount" = trunc("discount_benefit"."fixed_amount")),
	CONSTRAINT "discount_benefit_params_version_supported" CHECK ("discount_benefit"."params_version" = 1)
);
--> statement-breakpoint
ALTER TABLE "checkout_request" ADD CONSTRAINT "checkout_request_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkout_request" ADD CONSTRAINT "checkout_request_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_benefit" ADD CONSTRAINT "discount_benefit_revision_id_discount_offer_revision_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."discount_offer_revision"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "checkout_request_owner_key_unique" ON "checkout_request" USING btree ("client_id","request_key");--> statement-breakpoint
CREATE UNIQUE INDEX "checkout_request_order_unique" ON "checkout_request" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "checkout_request_key_idx" ON "checkout_request" USING btree ("request_key");--> statement-breakpoint
CREATE UNIQUE INDEX "discount_benefit_revision_unique" ON "discount_benefit" USING btree ("revision_id");
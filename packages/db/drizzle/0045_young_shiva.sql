CREATE TABLE "price_change_apply_request" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_identity" text NOT NULL,
	"request_key" text NOT NULL,
	"batch_id" text NOT NULL,
	"preview_digest" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_change_apply_request_actor_identity_shape" CHECK (char_length("price_change_apply_request"."actor_identity") between 1 and 128),
	CONSTRAINT "price_change_apply_request_request_key_uuid" CHECK ("price_change_apply_request"."request_key" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'),
	CONSTRAINT "price_change_apply_request_digest_shape" CHECK ("price_change_apply_request"."preview_digest" is null or char_length("price_change_apply_request"."preview_digest") between 1 and 128)
);
--> statement-breakpoint
ALTER TABLE "price_change_apply_request" ADD CONSTRAINT "price_change_apply_request_batch_id_price_change_batch_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."price_change_batch"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "price_change_apply_request_actor_key_unique" ON "price_change_apply_request" USING btree ("actor_identity","request_key");--> statement-breakpoint
CREATE INDEX "idx_price_change_apply_request_batch" ON "price_change_apply_request" USING btree ("batch_id");
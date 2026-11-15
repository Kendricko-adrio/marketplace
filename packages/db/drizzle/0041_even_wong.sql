CREATE TABLE "price_change_batch_row" (
	"id" text PRIMARY KEY NOT NULL,
	"batch_id" text NOT NULL,
	"row_number" integer NOT NULL,
	"input_sku" text NOT NULL,
	"variant_id" text,
	"action" text NOT NULL,
	"target_unit_price" numeric(15, 2),
	"preview_json" jsonb NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"result_code" text,
	"previous_target_unit_price" numeric(15, 2),
	"previous_effective_unit_price" numeric(15, 2),
	"previous_markdown_active" boolean,
	"source_unit_price" numeric(15, 2),
	"target_unit_price_after" numeric(15, 2),
	"effective_unit_price" numeric(15, 2),
	"markdown_active" boolean,
	"applied_revision_id" text,
	"origin_retry_row_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_change_batch_row_number_positive" CHECK ("price_change_batch_row"."row_number" >= 1),
	CONSTRAINT "price_change_batch_row_input_sku_shape" CHECK (char_length("price_change_batch_row"."input_sku") between 1 and 128),
	CONSTRAINT "price_change_batch_row_action_supported" CHECK ("price_change_batch_row"."action" in ('set_price', 'restore_base')),
	CONSTRAINT "price_change_batch_row_target_shape" CHECK (("price_change_batch_row"."action" = 'set_price' and "price_change_batch_row"."target_unit_price" is not null and "price_change_batch_row"."target_unit_price" > 0) or ("price_change_batch_row"."action" = 'restore_base' and "price_change_batch_row"."target_unit_price" is null)),
	CONSTRAINT "price_change_batch_row_preview_bounded" CHECK (octet_length("price_change_batch_row"."preview_json"::text) <= 16384),
	CONSTRAINT "price_change_batch_row_state_supported" CHECK ("price_change_batch_row"."state" in ('pending', 'applied', 'unchanged', 'failed')),
	CONSTRAINT "price_change_batch_row_result_code_shape" CHECK ("price_change_batch_row"."result_code" is null or "price_change_batch_row"."result_code" ~ '^[A-Z][A-Z0-9_]{0,63}$'),
	CONSTRAINT "price_change_batch_row_applied_revision_matches_state" CHECK (("price_change_batch_row"."state" = 'applied') = ("price_change_batch_row"."applied_revision_id" is not null)),
	CONSTRAINT "price_change_batch_row_retry_not_self" CHECK ("price_change_batch_row"."origin_retry_row_id" is null or "price_change_batch_row"."origin_retry_row_id" <> "price_change_batch_row"."id"),
	CONSTRAINT "price_change_batch_row_target_bounded" CHECK ("price_change_batch_row"."target_unit_price" is null or ("price_change_batch_row"."target_unit_price" >= 0 and "price_change_batch_row"."target_unit_price" <= 9999999999999 and "price_change_batch_row"."target_unit_price" = trunc("price_change_batch_row"."target_unit_price"))),
	CONSTRAINT "price_change_batch_row_previous_target_bounded" CHECK ("price_change_batch_row"."previous_target_unit_price" is null or ("price_change_batch_row"."previous_target_unit_price" >= 0 and "price_change_batch_row"."previous_target_unit_price" <= 9999999999999 and "price_change_batch_row"."previous_target_unit_price" = trunc("price_change_batch_row"."previous_target_unit_price"))),
	CONSTRAINT "price_change_batch_row_previous_effective_bounded" CHECK ("price_change_batch_row"."previous_effective_unit_price" is null or ("price_change_batch_row"."previous_effective_unit_price" >= 0 and "price_change_batch_row"."previous_effective_unit_price" <= 9999999999999 and "price_change_batch_row"."previous_effective_unit_price" = trunc("price_change_batch_row"."previous_effective_unit_price"))),
	CONSTRAINT "price_change_batch_row_source_bounded" CHECK ("price_change_batch_row"."source_unit_price" is null or ("price_change_batch_row"."source_unit_price" >= 0 and "price_change_batch_row"."source_unit_price" <= 9999999999999 and "price_change_batch_row"."source_unit_price" = trunc("price_change_batch_row"."source_unit_price"))),
	CONSTRAINT "price_change_batch_row_target_after_bounded" CHECK ("price_change_batch_row"."target_unit_price_after" is null or ("price_change_batch_row"."target_unit_price_after" >= 0 and "price_change_batch_row"."target_unit_price_after" <= 9999999999999 and "price_change_batch_row"."target_unit_price_after" = trunc("price_change_batch_row"."target_unit_price_after"))),
	CONSTRAINT "price_change_batch_row_effective_bounded" CHECK ("price_change_batch_row"."effective_unit_price" is null or ("price_change_batch_row"."effective_unit_price" >= 0 and "price_change_batch_row"."effective_unit_price" <= 9999999999999 and "price_change_batch_row"."effective_unit_price" = trunc("price_change_batch_row"."effective_unit_price")))
);
--> statement-breakpoint
CREATE TABLE "price_change_batch" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_identity" text NOT NULL,
	"request_key" text NOT NULL,
	"fingerprint" text NOT NULL,
	"source" text NOT NULL,
	"template_version" text,
	"parent_batch_id" text,
	"reason" text,
	"state" text DEFAULT 'staged' NOT NULL,
	"row_count" integer NOT NULL,
	"applied_count" integer DEFAULT 0 NOT NULL,
	"unchanged_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"pending_count" integer DEFAULT 0 NOT NULL,
	"halt_reason" text,
	"actor_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_change_batch_actor_identity_shape" CHECK (char_length("price_change_batch"."actor_identity") between 1 and 128),
	CONSTRAINT "price_change_batch_request_key_uuid" CHECK ("price_change_batch"."request_key" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'),
	CONSTRAINT "price_change_batch_fingerprint_sha256" CHECK ("price_change_batch"."fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "price_change_batch_source_supported" CHECK ("price_change_batch"."source" in ('manual', 'bulk', 'xlsx')),
	CONSTRAINT "price_change_batch_template_version_shape" CHECK ("price_change_batch"."template_version" is null or ("price_change_batch"."template_version" = 'OKCIR_MARKDOWN_V1')),
	CONSTRAINT "price_change_batch_reason_shape" CHECK ("price_change_batch"."reason" is null or char_length(btrim("price_change_batch"."reason")) between 1 and 500),
	CONSTRAINT "price_change_batch_state_supported" CHECK ("price_change_batch"."state" in ('staged', 'in_progress', 'applied', 'partially_applied', 'failed')),
	CONSTRAINT "price_change_batch_row_count_bounded" CHECK ("price_change_batch"."row_count" >= 1 and "price_change_batch"."row_count" <= 2147483647),
	CONSTRAINT "price_change_batch_counts_bounded" CHECK ("price_change_batch"."applied_count" >= 0 and "price_change_batch"."applied_count" <= 2147483647 and "price_change_batch"."unchanged_count" >= 0 and "price_change_batch"."unchanged_count" <= 2147483647 and "price_change_batch"."failed_count" >= 0 and "price_change_batch"."failed_count" <= 2147483647 and "price_change_batch"."pending_count" >= 0 and "price_change_batch"."pending_count" <= 2147483647),
	CONSTRAINT "price_change_batch_counts_sum" CHECK ("price_change_batch"."applied_count" + "price_change_batch"."unchanged_count" + "price_change_batch"."failed_count" + "price_change_batch"."pending_count" = "price_change_batch"."row_count"),
	CONSTRAINT "price_change_batch_halt_reason_shape" CHECK ("price_change_batch"."halt_reason" is null or char_length("price_change_batch"."halt_reason") between 1 and 500)
);
--> statement-breakpoint
CREATE TABLE "variant_price_current" (
	"variant_id" text PRIMARY KEY NOT NULL,
	"revision_id" text NOT NULL,
	"version" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "variant_price_current_version_positive" CHECK ("variant_price_current"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "variant_price_revision" (
	"id" text PRIMARY KEY NOT NULL,
	"variant_id" text NOT NULL,
	"revision_no" integer NOT NULL,
	"action" text NOT NULL,
	"target_unit_price" numeric(15, 2),
	"source_unit_price" numeric(15, 2) NOT NULL,
	"effective_unit_price" numeric(15, 2) NOT NULL,
	"previous_target_unit_price" numeric(15, 2),
	"previous_effective_unit_price" numeric(15, 2) NOT NULL,
	"markdown_active" boolean NOT NULL,
	"previous_markdown_active" boolean NOT NULL,
	"batch_id" text NOT NULL,
	"batch_row_id" text NOT NULL,
	"actor_id" text,
	"actor_identity" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "variant_price_revision_variant_id_unique" UNIQUE("variant_id","id"),
	CONSTRAINT "variant_price_revision_no_positive" CHECK ("variant_price_revision"."revision_no" >= 1),
	CONSTRAINT "variant_price_revision_action_supported" CHECK ("variant_price_revision"."action" in ('set_price', 'restore_base')),
	CONSTRAINT "variant_price_revision_target_shape" CHECK (("variant_price_revision"."action" = 'set_price' and "variant_price_revision"."target_unit_price" > 0 and "variant_price_revision"."target_unit_price" < "variant_price_revision"."source_unit_price") or ("variant_price_revision"."action" = 'restore_base' and "variant_price_revision"."target_unit_price" is null)),
	CONSTRAINT "variant_price_revision_markdown_consistency" CHECK ("variant_price_revision"."markdown_active" = ("variant_price_revision"."target_unit_price" is not null)),
	CONSTRAINT "variant_price_revision_effective_consistency" CHECK ("variant_price_revision"."effective_unit_price" = case when "variant_price_revision"."target_unit_price" is not null then "variant_price_revision"."target_unit_price" else "variant_price_revision"."source_unit_price" end),
	CONSTRAINT "variant_price_revision_previous_markdown_consistency" CHECK ("variant_price_revision"."previous_markdown_active" = ("variant_price_revision"."previous_target_unit_price" is not null and "variant_price_revision"."previous_target_unit_price" < "variant_price_revision"."source_unit_price")),
	CONSTRAINT "variant_price_revision_previous_effective_consistency" CHECK ("variant_price_revision"."previous_effective_unit_price" = case when "variant_price_revision"."previous_markdown_active" then "variant_price_revision"."previous_target_unit_price" else "variant_price_revision"."source_unit_price" end),
	CONSTRAINT "variant_price_revision_actor_identity_shape" CHECK (char_length("variant_price_revision"."actor_identity") between 1 and 128),
	CONSTRAINT "variant_price_revision_target_bounded" CHECK ("variant_price_revision"."target_unit_price" is null or ("variant_price_revision"."target_unit_price" >= 0 and "variant_price_revision"."target_unit_price" <= 9999999999999 and "variant_price_revision"."target_unit_price" = trunc("variant_price_revision"."target_unit_price"))),
	CONSTRAINT "variant_price_revision_source_bounded" CHECK ("variant_price_revision"."source_unit_price" >= 0 and "variant_price_revision"."source_unit_price" <= 9999999999999 and "variant_price_revision"."source_unit_price" = trunc("variant_price_revision"."source_unit_price")),
	CONSTRAINT "variant_price_revision_effective_bounded" CHECK ("variant_price_revision"."effective_unit_price" >= 0 and "variant_price_revision"."effective_unit_price" <= 9999999999999 and "variant_price_revision"."effective_unit_price" = trunc("variant_price_revision"."effective_unit_price")),
	CONSTRAINT "variant_price_revision_previous_target_bounded" CHECK ("variant_price_revision"."previous_target_unit_price" is null or ("variant_price_revision"."previous_target_unit_price" >= 0 and "variant_price_revision"."previous_target_unit_price" <= 9999999999999 and "variant_price_revision"."previous_target_unit_price" = trunc("variant_price_revision"."previous_target_unit_price"))),
	CONSTRAINT "variant_price_revision_previous_effective_bounded" CHECK ("variant_price_revision"."previous_effective_unit_price" >= 0 and "variant_price_revision"."previous_effective_unit_price" <= 9999999999999 and "variant_price_revision"."previous_effective_unit_price" = trunc("variant_price_revision"."previous_effective_unit_price"))
);
--> statement-breakpoint
ALTER TABLE "price_change_batch_row" ADD CONSTRAINT "price_change_batch_row_batch_id_price_change_batch_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."price_change_batch"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_change_batch_row" ADD CONSTRAINT "price_change_batch_row_variant_id_product_variant_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variant"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_change_batch_row" ADD CONSTRAINT "price_change_batch_row_applied_revision_fk" FOREIGN KEY ("applied_revision_id") REFERENCES "public"."variant_price_revision"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_change_batch_row" ADD CONSTRAINT "price_change_batch_row_origin_retry_fk" FOREIGN KEY ("origin_retry_row_id") REFERENCES "public"."price_change_batch_row"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_change_batch" ADD CONSTRAINT "price_change_batch_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_change_batch" ADD CONSTRAINT "price_change_batch_parent_fk" FOREIGN KEY ("parent_batch_id") REFERENCES "public"."price_change_batch"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variant_price_current" ADD CONSTRAINT "variant_price_current_variant_id_product_variant_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variant"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variant_price_current" ADD CONSTRAINT "variant_price_current_revision_ownership_fk" FOREIGN KEY ("variant_id","revision_id") REFERENCES "public"."variant_price_revision"("variant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variant_price_revision" ADD CONSTRAINT "variant_price_revision_variant_id_product_variant_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variant"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variant_price_revision" ADD CONSTRAINT "variant_price_revision_batch_id_price_change_batch_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."price_change_batch"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variant_price_revision" ADD CONSTRAINT "variant_price_revision_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "price_change_batch_row_number_unique" ON "price_change_batch_row" USING btree ("batch_id","row_number");--> statement-breakpoint
CREATE INDEX "idx_price_change_batch_row_status" ON "price_change_batch_row" USING btree ("batch_id","state","row_number");--> statement-breakpoint
CREATE INDEX "idx_price_change_batch_row_variant" ON "price_change_batch_row" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX "idx_price_change_batch_row_origin_retry" ON "price_change_batch_row" USING btree ("origin_retry_row_id");--> statement-breakpoint
CREATE UNIQUE INDEX "price_change_batch_actor_key_unique" ON "price_change_batch" USING btree ("actor_identity","request_key");--> statement-breakpoint
CREATE INDEX "idx_price_change_batch_parent" ON "price_change_batch" USING btree ("parent_batch_id");--> statement-breakpoint
CREATE INDEX "idx_price_change_batch_state_created" ON "price_change_batch" USING btree ("state","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "variant_price_revision_variant_no_unique" ON "variant_price_revision" USING btree ("variant_id","revision_no");--> statement-breakpoint
CREATE UNIQUE INDEX "variant_price_revision_batch_row_unique" ON "variant_price_revision" USING btree ("batch_row_id");--> statement-breakpoint
CREATE INDEX "idx_variant_price_revision_batch" ON "variant_price_revision" USING btree ("batch_id");
CREATE TABLE "discount_client_usage" (
	"offer_id" text NOT NULL,
	"client_id" text NOT NULL,
	"reserved_count" integer DEFAULT 0 NOT NULL,
	"consumed_count" integer DEFAULT 0 NOT NULL,
	"reserved_amount" numeric(15, 2) DEFAULT '0' NOT NULL,
	"consumed_amount" numeric(15, 2) DEFAULT '0' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discount_client_usage_offer_id_client_id_pk" PRIMARY KEY("offer_id","client_id"),
	CONSTRAINT "discount_client_usage_reserved_count_bounded" CHECK ("discount_client_usage"."reserved_count" >= 0 and "discount_client_usage"."reserved_count" <= 2147483647),
	CONSTRAINT "discount_client_usage_consumed_count_bounded" CHECK ("discount_client_usage"."consumed_count" >= 0 and "discount_client_usage"."consumed_count" <= 2147483647),
	CONSTRAINT "discount_client_usage_reserved_amount_bounded" CHECK ("discount_client_usage"."reserved_amount" >= 0 and "discount_client_usage"."reserved_amount" <= 9999999999999 and "discount_client_usage"."reserved_amount" = trunc("discount_client_usage"."reserved_amount")),
	CONSTRAINT "discount_client_usage_consumed_amount_bounded" CHECK ("discount_client_usage"."consumed_amount" >= 0 and "discount_client_usage"."consumed_amount" <= 9999999999999 and "discount_client_usage"."consumed_amount" = trunc("discount_client_usage"."consumed_amount")),
	CONSTRAINT "discount_client_usage_version_positive" CHECK ("discount_client_usage"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "discount_redemption_event" (
	"id" text PRIMARY KEY NOT NULL,
	"redemption_id" text NOT NULL,
	"event_key" text NOT NULL,
	"kind" text NOT NULL,
	"previous_status" text,
	"next_status" text NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"source" text NOT NULL,
	"correlation" text,
	"reason" text,
	"actor_identity" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discount_redemption_event_transition_valid" CHECK (("discount_redemption_event"."kind" = 'reserved' and "discount_redemption_event"."previous_status" is null and "discount_redemption_event"."next_status" = 'reserved')
        or ("discount_redemption_event"."kind" = 'consumed' and "discount_redemption_event"."previous_status" = 'reserved' and "discount_redemption_event"."next_status" = 'consumed')
        or ("discount_redemption_event"."kind" = 'released' and "discount_redemption_event"."previous_status" = 'reserved' and "discount_redemption_event"."next_status" = 'released')
        or ("discount_redemption_event"."kind" = 'late_paid_review' and "discount_redemption_event"."previous_status" = 'released' and "discount_redemption_event"."next_status" = 'released')),
	CONSTRAINT "discount_redemption_event_amount_positive" CHECK ("discount_redemption_event"."amount" > 0 and "discount_redemption_event"."amount" <= 9999999999999 and "discount_redemption_event"."amount" = trunc("discount_redemption_event"."amount")),
	CONSTRAINT "discount_redemption_event_source_shape" CHECK ("discount_redemption_event"."source" ~ '^[a-z][a-z0-9_-]{0,31}$'),
	CONSTRAINT "discount_redemption_event_key_bounded" CHECK (char_length("discount_redemption_event"."event_key") between 1 and 200),
	CONSTRAINT "discount_redemption_event_correlation_bounded" CHECK ("discount_redemption_event"."correlation" is null or char_length("discount_redemption_event"."correlation") <= 128),
	CONSTRAINT "discount_redemption_event_reason_bounded" CHECK ("discount_redemption_event"."reason" is null or char_length("discount_redemption_event"."reason") <= 500),
	CONSTRAINT "discount_redemption_event_actor_bounded" CHECK ("discount_redemption_event"."actor_identity" is null or char_length("discount_redemption_event"."actor_identity") between 1 and 128)
);
--> statement-breakpoint
CREATE TABLE "discount_redemption" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"client_id" text NOT NULL,
	"offer_id" text NOT NULL,
	"revision_id" text NOT NULL,
	"benefit_id" text NOT NULL,
	"activation_kind" text DEFAULT 'public' NOT NULL,
	"status" text DEFAULT 'reserved' NOT NULL,
	"benefit_amount" numeric(15, 2) NOT NULL,
	"deadline" timestamp with time zone NOT NULL,
	"policy_version" integer NOT NULL,
	"contract_version" integer DEFAULT 1 NOT NULL,
	"engine_version" integer DEFAULT 1 NOT NULL,
	"terms_snapshot" jsonb NOT NULL,
	"result_snapshot" jsonb NOT NULL,
	"reserved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"consumed_at" timestamp with time zone,
	"released_at" timestamp with time zone,
	"terminal_reason" text,
	"release_source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discount_redemption_order_id_unique" UNIQUE("order_id","id"),
	CONSTRAINT "discount_redemption_id_benefit_unique" UNIQUE("id","benefit_id"),
	CONSTRAINT "discount_redemption_activation_public" CHECK ("discount_redemption"."activation_kind" = 'public'),
	CONSTRAINT "discount_redemption_status_valid" CHECK ("discount_redemption"."status" in ('reserved', 'consumed', 'released')),
	CONSTRAINT "discount_redemption_benefit_amount_positive" CHECK ("discount_redemption"."benefit_amount" > 0 and "discount_redemption"."benefit_amount" <= 9999999999999 and "discount_redemption"."benefit_amount" = trunc("discount_redemption"."benefit_amount")),
	CONSTRAINT "discount_redemption_versions_supported" CHECK ("discount_redemption"."policy_version" >= 1 and "discount_redemption"."contract_version" = 1 and "discount_redemption"."engine_version" = 1),
	CONSTRAINT "discount_redemption_terminal_timestamps" CHECK (("discount_redemption"."status" = 'reserved' and "discount_redemption"."consumed_at" is null and "discount_redemption"."released_at" is null)
        or ("discount_redemption"."status" = 'consumed' and "discount_redemption"."consumed_at" is not null and "discount_redemption"."released_at" is null)
        or ("discount_redemption"."status" = 'released' and "discount_redemption"."released_at" is not null and "discount_redemption"."consumed_at" is null)),
	CONSTRAINT "discount_redemption_terms_bounded" CHECK (jsonb_typeof("discount_redemption"."terms_snapshot") = 'object' and octet_length("discount_redemption"."terms_snapshot"::text) <= 4096),
	CONSTRAINT "discount_redemption_result_bounded" CHECK (jsonb_typeof("discount_redemption"."result_snapshot") = 'object' and octet_length("discount_redemption"."result_snapshot"::text) <= 16384),
	CONSTRAINT "discount_redemption_terminal_reason_bounded" CHECK ("discount_redemption"."terminal_reason" is null or char_length("discount_redemption"."terminal_reason") <= 500),
	CONSTRAINT "discount_redemption_release_source_bounded" CHECK ("discount_redemption"."release_source" is null or char_length("discount_redemption"."release_source") <= 64)
);
--> statement-breakpoint
CREATE TABLE "order_discount_allocation" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"order_item_id" text,
	"component" text NOT NULL,
	"markdown_revision_id" text,
	"redemption_id" text,
	"benefit_id" text,
	"amount" numeric(15, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_discount_allocation_component_valid" CHECK ("order_discount_allocation"."component" in ('markdown', 'offer_goods', 'offer_shipping')),
	CONSTRAINT "order_discount_allocation_shape_valid" CHECK (("order_discount_allocation"."component" = 'markdown' and "order_discount_allocation"."order_item_id" is not null and "order_discount_allocation"."markdown_revision_id" is not null and "order_discount_allocation"."redemption_id" is null and "order_discount_allocation"."benefit_id" is null)
        or ("order_discount_allocation"."component" = 'offer_goods' and "order_discount_allocation"."order_item_id" is not null and "order_discount_allocation"."markdown_revision_id" is null and "order_discount_allocation"."redemption_id" is not null and "order_discount_allocation"."benefit_id" is not null)
        or ("order_discount_allocation"."component" = 'offer_shipping' and "order_discount_allocation"."order_item_id" is null and "order_discount_allocation"."markdown_revision_id" is null and "order_discount_allocation"."redemption_id" is not null and "order_discount_allocation"."benefit_id" is not null)),
	CONSTRAINT "order_discount_allocation_amount_positive" CHECK ("order_discount_allocation"."amount" > 0 and "order_discount_allocation"."amount" <= 9999999999999 and "order_discount_allocation"."amount" = trunc("order_discount_allocation"."amount"))
);
--> statement-breakpoint
ALTER TABLE "discount_client_usage" ADD CONSTRAINT "discount_client_usage_offer_id_discount_offer_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."discount_offer"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_client_usage" ADD CONSTRAINT "discount_client_usage_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_redemption_event" ADD CONSTRAINT "discount_redemption_event_redemption_id_discount_redemption_id_fk" FOREIGN KEY ("redemption_id") REFERENCES "public"."discount_redemption"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_redemption" ADD CONSTRAINT "discount_redemption_order_owner_fk" FOREIGN KEY ("order_id","client_id") REFERENCES "public"."orders"("id","user_id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "discount_redemption" ADD CONSTRAINT "discount_redemption_revision_ownership_fk" FOREIGN KEY ("offer_id","revision_id") REFERENCES "public"."discount_offer_revision"("offer_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "discount_redemption" ADD CONSTRAINT "discount_redemption_benefit_ownership_fk" FOREIGN KEY ("revision_id","benefit_id") REFERENCES "public"."discount_benefit"("revision_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "order_discount_allocation" ADD CONSTRAINT "order_discount_allocation_order_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "order_discount_allocation" ADD CONSTRAINT "order_discount_allocation_item_ownership_fk" FOREIGN KEY ("order_id","order_item_id") REFERENCES "public"."order_item"("order_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "order_discount_allocation" ADD CONSTRAINT "order_discount_allocation_redemption_ownership_fk" FOREIGN KEY ("order_id","redemption_id") REFERENCES "public"."discount_redemption"("order_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "order_discount_allocation" ADD CONSTRAINT "order_discount_allocation_benefit_ownership_fk" FOREIGN KEY ("redemption_id","benefit_id") REFERENCES "public"."discount_redemption"("id","benefit_id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE UNIQUE INDEX "discount_redemption_event_key_unique" ON "discount_redemption_event" USING btree ("event_key");--> statement-breakpoint
CREATE INDEX "discount_redemption_event_redemption_idx" ON "discount_redemption_event" USING btree ("redemption_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "discount_redemption_order_unique" ON "discount_redemption" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "discount_redemption_status_deadline_idx" ON "discount_redemption" USING btree ("status","deadline");--> statement-breakpoint
CREATE INDEX "discount_redemption_offer_client_idx" ON "discount_redemption" USING btree ("offer_id","client_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "order_discount_allocation_item_component_unique" ON "order_discount_allocation" USING btree ("order_id","order_item_id","component") WHERE "order_discount_allocation"."component" in ('markdown', 'offer_goods');--> statement-breakpoint
CREATE UNIQUE INDEX "order_discount_allocation_shipping_unique" ON "order_discount_allocation" USING btree ("redemption_id") WHERE "order_discount_allocation"."component" = 'offer_shipping';--> statement-breakpoint
CREATE INDEX "order_discount_allocation_order_idx" ON "order_discount_allocation" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_discount_allocation_redemption_idx" ON "order_discount_allocation" USING btree ("redemption_id");
CREATE TABLE "discount_admin_request" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_identity" text NOT NULL,
	"request_key" text NOT NULL,
	"fingerprint" text NOT NULL,
	"action" text NOT NULL,
	"target_id" text,
	"version" integer NOT NULL,
	"result_json" jsonb NOT NULL,
	"actor_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discount_admin_request_actor_identity_shape" CHECK (char_length("discount_admin_request"."actor_identity") between 1 and 128),
	CONSTRAINT "discount_admin_request_key_uuid" CHECK ("discount_admin_request"."request_key" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'),
	CONSTRAINT "discount_admin_request_fingerprint_sha256" CHECK ("discount_admin_request"."fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "discount_admin_request_action_shape" CHECK ("discount_admin_request"."action" ~ '^[a-z][a-z0-9_]{0,63}$'),
	CONSTRAINT "discount_admin_request_version_positive" CHECK ("discount_admin_request"."version" >= 1),
	CONSTRAINT "discount_admin_request_result_bounded" CHECK (octet_length("discount_admin_request"."result_json"::text) <= 262144)
);
--> statement-breakpoint
CREATE TABLE "discount_offer_revision" (
	"id" text PRIMARY KEY NOT NULL,
	"offer_id" text NOT NULL,
	"revision_no" integer NOT NULL,
	"name" text,
	"currency" text,
	"min_subtotal" numeric(15, 2),
	"start_at" timestamp with time zone,
	"end_at" timestamp with time zone,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"engine_version" integer DEFAULT 1 NOT NULL,
	"draft_version" integer DEFAULT 1 NOT NULL,
	"published_at" timestamp with time zone,
	"actor_id" text,
	"actor_identity" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discount_offer_revision_offer_id_unique" UNIQUE("offer_id","id"),
	CONSTRAINT "discount_offer_revision_no_positive" CHECK ("discount_offer_revision"."revision_no" >= 1),
	CONSTRAINT "discount_offer_revision_draft_version_positive" CHECK ("discount_offer_revision"."draft_version" >= 1),
	CONSTRAINT "discount_offer_revision_versions_supported" CHECK ("discount_offer_revision"."schema_version" = 1 and "discount_offer_revision"."engine_version" = 1),
	CONSTRAINT "discount_offer_revision_name_shape" CHECK ("discount_offer_revision"."name" is null or char_length(btrim("discount_offer_revision"."name")) between 1 and 120),
	CONSTRAINT "discount_offer_revision_currency_shape" CHECK ("discount_offer_revision"."currency" is null or "discount_offer_revision"."currency" = 'IDR'),
	CONSTRAINT "discount_offer_revision_min_subtotal_bounded" CHECK ("discount_offer_revision"."min_subtotal" is null or ("discount_offer_revision"."min_subtotal" >= 0 and "discount_offer_revision"."min_subtotal" <= 9999999999999 and "discount_offer_revision"."min_subtotal" = trunc("discount_offer_revision"."min_subtotal"))),
	CONSTRAINT "discount_offer_revision_window_ordered" CHECK ("discount_offer_revision"."start_at" is null or "discount_offer_revision"."end_at" is null or "discount_offer_revision"."start_at" < "discount_offer_revision"."end_at"),
	CONSTRAINT "discount_offer_revision_published_complete" CHECK ("discount_offer_revision"."published_at" is null or ("discount_offer_revision"."name" is not null and "discount_offer_revision"."currency" is not null and "discount_offer_revision"."currency" = 'IDR' and "discount_offer_revision"."min_subtotal" is not null)),
	CONSTRAINT "discount_offer_revision_actor_identity_shape" CHECK (char_length("discount_offer_revision"."actor_identity") between 1 and 128)
);
--> statement-breakpoint
CREATE TABLE "discount_offer_usage" (
	"offer_id" text PRIMARY KEY NOT NULL,
	"reserved_count" integer DEFAULT 0 NOT NULL,
	"consumed_count" integer DEFAULT 0 NOT NULL,
	"reserved_amount" numeric(15, 2) DEFAULT '0' NOT NULL,
	"consumed_amount" numeric(15, 2) DEFAULT '0' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discount_offer_usage_reserved_count_bounded" CHECK ("discount_offer_usage"."reserved_count" >= 0 and "discount_offer_usage"."reserved_count" <= 2147483647),
	CONSTRAINT "discount_offer_usage_consumed_count_bounded" CHECK ("discount_offer_usage"."consumed_count" >= 0 and "discount_offer_usage"."consumed_count" <= 2147483647),
	CONSTRAINT "discount_offer_usage_reserved_amount_bounded" CHECK ("discount_offer_usage"."reserved_amount" >= 0 and "discount_offer_usage"."reserved_amount" <= 9999999999999 and "discount_offer_usage"."reserved_amount" = trunc("discount_offer_usage"."reserved_amount")),
	CONSTRAINT "discount_offer_usage_consumed_amount_bounded" CHECK ("discount_offer_usage"."consumed_amount" >= 0 and "discount_offer_usage"."consumed_amount" <= 9999999999999 and "discount_offer_usage"."consumed_amount" = trunc("discount_offer_usage"."consumed_amount")),
	CONSTRAINT "discount_offer_usage_version_positive" CHECK ("discount_offer_usage"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "discount_offer" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"activation_kind" text NOT NULL,
	"state" text DEFAULT 'draft' NOT NULL,
	"current_revision_id" text,
	"version" integer DEFAULT 1 NOT NULL,
	"draft_version" integer DEFAULT 1 NOT NULL,
	"quota_count" integer,
	"budget_amount" numeric(15, 2),
	"per_client_limit" integer DEFAULT 1 NOT NULL,
	"policy_version" integer DEFAULT 1 NOT NULL,
	"actor_id" text,
	"actor_identity" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discount_offer_key_shape" CHECK (char_length("discount_offer"."key") between 1 and 128),
	CONSTRAINT "discount_offer_activation_kind_supported" CHECK ("discount_offer"."activation_kind" = 'public'),
	CONSTRAINT "discount_offer_state_valid" CHECK ("discount_offer"."state" in ('draft', 'enabled', 'paused', 'archived')),
	CONSTRAINT "discount_offer_version_positive" CHECK ("discount_offer"."version" >= 1),
	CONSTRAINT "discount_offer_draft_version_positive" CHECK ("discount_offer"."draft_version" >= 1),
	CONSTRAINT "discount_offer_policy_version_positive" CHECK ("discount_offer"."policy_version" >= 1),
	CONSTRAINT "discount_offer_per_client_limit_positive" CHECK ("discount_offer"."per_client_limit" >= 1 and "discount_offer"."per_client_limit" <= 2147483647),
	CONSTRAINT "discount_offer_quota_count_bounded" CHECK ("discount_offer"."quota_count" is null or ("discount_offer"."quota_count" >= 1 and "discount_offer"."quota_count" <= 2147483647)),
	CONSTRAINT "discount_offer_budget_amount_bounded" CHECK ("discount_offer"."budget_amount" is null or ("discount_offer"."budget_amount" >= 0 and "discount_offer"."budget_amount" <= 9999999999999 and "discount_offer"."budget_amount" = trunc("discount_offer"."budget_amount"))),
	CONSTRAINT "discount_offer_live_requirements" CHECK ("discount_offer"."state" = 'draft' or ("discount_offer"."current_revision_id" is not null and ("discount_offer"."quota_count" is not null or "discount_offer"."budget_amount" is not null))),
	CONSTRAINT "discount_offer_actor_identity_shape" CHECK (char_length("discount_offer"."actor_identity") between 1 and 128)
);
--> statement-breakpoint
ALTER TABLE "discount_admin_request" ADD CONSTRAINT "discount_admin_request_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_offer_revision" ADD CONSTRAINT "discount_offer_revision_offer_id_discount_offer_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."discount_offer"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_offer_revision" ADD CONSTRAINT "discount_offer_revision_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_offer_usage" ADD CONSTRAINT "discount_offer_usage_offer_id_discount_offer_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."discount_offer"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_offer" ADD CONSTRAINT "discount_offer_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_offer" ADD CONSTRAINT "discount_offer_current_revision_ownership_fk" FOREIGN KEY ("id","current_revision_id") REFERENCES "public"."discount_offer_revision"("offer_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE UNIQUE INDEX "discount_admin_request_actor_key_unique" ON "discount_admin_request" USING btree ("actor_identity","request_key");--> statement-breakpoint
CREATE UNIQUE INDEX "discount_offer_revision_offer_no_unique" ON "discount_offer_revision" USING btree ("offer_id","revision_no");--> statement-breakpoint
CREATE UNIQUE INDEX "discount_offer_revision_single_draft_unique" ON "discount_offer_revision" USING btree ("offer_id") WHERE "discount_offer_revision"."published_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "discount_offer_key_unique" ON "discount_offer" USING btree ("key");--> statement-breakpoint
CREATE INDEX "idx_discount_offer_state_activation" ON "discount_offer" USING btree ("state","activation_kind");
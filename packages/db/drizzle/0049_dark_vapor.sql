CREATE TABLE "discount_code" (
	"id" text PRIMARY KEY NOT NULL,
	"offer_id" text NOT NULL,
	"activation_kind" text DEFAULT 'manual_only' NOT NULL,
	"canonical_code" text NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_id" text,
	"actor_identity" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discount_code_offer_id_unique" UNIQUE("offer_id","id"),
	CONSTRAINT "discount_code_canonical_shape" CHECK ("discount_code"."canonical_code" ~ '^[A-Z0-9][A-Z0-9_-]{2,63}$'),
	CONSTRAINT "discount_code_activation_manual" CHECK ("discount_code"."activation_kind" = 'manual_only'),
	CONSTRAINT "discount_code_state_valid" CHECK ("discount_code"."state" in ('active', 'inactive', 'archived')),
	CONSTRAINT "discount_code_version_positive" CHECK ("discount_code"."version" >= 1),
	CONSTRAINT "discount_code_actor_identity_shape" CHECK (char_length("discount_code"."actor_identity") between 1 and 128)
);
--> statement-breakpoint
ALTER TABLE "discount_code" ADD CONSTRAINT "discount_code_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_code" ADD CONSTRAINT "discount_code_manual_offer_fk" FOREIGN KEY ("offer_id","activation_kind") REFERENCES "public"."discount_offer"("id","activation_kind") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE UNIQUE INDEX "discount_code_canonical_unique" ON "discount_code" USING btree ("canonical_code");--> statement-breakpoint
CREATE INDEX "discount_code_offer_state_idx" ON "discount_code" USING btree ("offer_id","state");--> statement-breakpoint
ALTER TABLE "discount_redemption" ADD CONSTRAINT "discount_redemption_code_ownership_fk" FOREIGN KEY ("offer_id","code_id") REFERENCES "public"."discount_code"("offer_id","id") ON DELETE restrict ON UPDATE restrict;
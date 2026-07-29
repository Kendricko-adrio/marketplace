CREATE TABLE "system_config" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"type" text DEFAULT 'string' NOT NULL,
	"description" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "branch_stock" ADD COLUMN "reserved_stock" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "expires_at" timestamp;--> statement-breakpoint
CREATE INDEX "idx_orders_status_expires" ON "orders" USING btree ("status","expires_at");
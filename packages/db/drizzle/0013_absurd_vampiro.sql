CREATE TABLE "jubelio_stock_operation" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"note" text NOT NULL,
	"payload" jsonb NOT NULL,
	"remote_adjustment_id" integer,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jubelio_stock_operation_note_unique" UNIQUE("note"),
	CONSTRAINT "jubelio_stock_operation_type_valid" CHECK ("jubelio_stock_operation"."type" in ('reserve', 'release')),
	CONSTRAINT "jubelio_stock_operation_status_valid" CHECK ("jubelio_stock_operation"."status" in ('pending', 'in_flight', 'applied', 'committed', 'reconciling', 'failed', 'manual_review')),
	CONSTRAINT "jubelio_stock_operation_attempt_nonnegative" CHECK ("jubelio_stock_operation"."attempt_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "branch_stock" ADD COLUMN "pending_remote_stock" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE "branch_stock" SET "pending_remote_stock" = "reserved_stock" WHERE "reserved_stock" > 0;--> statement-breakpoint
INSERT INTO "system_config" ("key", "value", "type", "description", "updated_at")
VALUES (
	'reservation.ttlMinutes',
	'15',
	'number',
	'Minutes a customer has to pay before the order expires and Jubelio stock is restored.',
	now()
)
ON CONFLICT ("key") DO UPDATE SET "value" = '15', "updated_at" = now();--> statement-breakpoint
ALTER TABLE "jubelio_stock_operation" ADD CONSTRAINT "jubelio_stock_operation_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "jubelio_stock_operation_order_type_unique" ON "jubelio_stock_operation" USING btree ("order_id","type");--> statement-breakpoint
CREATE INDEX "idx_jubelio_stock_operation_retry" ON "jubelio_stock_operation" USING btree ("status","next_attempt_at");--> statement-breakpoint
ALTER TABLE "branch_stock" ADD CONSTRAINT "branch_pending_remote_stock_nonnegative" CHECK ("branch_stock"."pending_remote_stock" >= 0);

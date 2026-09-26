CREATE TABLE "jubelio_sales_operation" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'intent' NOT NULL,
	"reference" text NOT NULL,
	"payload" jsonb NOT NULL,
	"sales_order_id" integer,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"dispatched_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jubelio_sales_operation_type_valid" CHECK ("jubelio_sales_operation"."type" in ('create', 'cancel')),
	CONSTRAINT "jubelio_sales_operation_status_valid" CHECK ("jubelio_sales_operation"."status" in ('intent', 'dispatched_unknown', 'confirmed', 'rejected', 'manual_review', 'aborted')),
	CONSTRAINT "jubelio_sales_operation_attempt_nonnegative" CHECK ("jubelio_sales_operation"."attempt_count" >= 0),
	CONSTRAINT "jubelio_sales_operation_cancel_requires_sales_order" CHECK ("jubelio_sales_operation"."type" <> 'cancel' or "jubelio_sales_operation"."sales_order_id" is not null),
	CONSTRAINT "jubelio_sales_operation_confirmed_requires_sales_order" CHECK ("jubelio_sales_operation"."status" <> 'confirmed' or "jubelio_sales_operation"."sales_order_id" is not null)
);
--> statement-breakpoint
ALTER TABLE "jubelio_sales_operation" ADD CONSTRAINT "jubelio_sales_operation_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "jubelio_sales_operation_order_type_unique" ON "jubelio_sales_operation" USING btree ("order_id","type");--> statement-breakpoint
CREATE UNIQUE INDEX "jubelio_sales_operation_reference_unique" ON "jubelio_sales_operation" USING btree ("reference");--> statement-breakpoint
CREATE INDEX "idx_jubelio_sales_operation_status" ON "jubelio_sales_operation" USING btree ("status");
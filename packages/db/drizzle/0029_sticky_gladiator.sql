ALTER TABLE "orders" ADD COLUMN "fulfillment_method" text DEFAULT 'pickup' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "delivery_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_fulfillment_method_valid" CHECK ("orders"."fulfillment_method" in ('pickup', 'delivery'));
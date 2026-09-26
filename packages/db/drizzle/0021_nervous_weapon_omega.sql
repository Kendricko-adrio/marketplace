ALTER TABLE "jubelio_sales_operation" DROP CONSTRAINT "jubelio_sales_operation_type_valid";--> statement-breakpoint
ALTER TABLE "branch_stock" ADD COLUMN "on_order_stock" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "branch_stock" ADD COLUMN "provider_reserved_stock" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "branch_stock" ADD COLUMN "available_stock" integer;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "jubelio_sales_order_id" integer;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "jubelio_invoice_id" integer;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "jubelio_payment_id" integer;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "fulfillment_blocked_reason" text;--> statement-breakpoint
ALTER TABLE "jubelio_sales_operation" ADD COLUMN "invoice_id" integer;--> statement-breakpoint
ALTER TABLE "jubelio_sales_operation" ADD COLUMN "payment_id" integer;--> statement-breakpoint
ALTER TABLE "branch_stock" ADD CONSTRAINT "branch_on_order_stock_nonnegative" CHECK ("branch_stock"."on_order_stock" >= 0);--> statement-breakpoint
ALTER TABLE "branch_stock" ADD CONSTRAINT "branch_provider_reserved_stock_nonnegative" CHECK ("branch_stock"."provider_reserved_stock" >= 0);--> statement-breakpoint
ALTER TABLE "branch_stock" ADD CONSTRAINT "branch_available_stock_nonnegative" CHECK ("branch_stock"."available_stock" is null or "branch_stock"."available_stock" >= 0);--> statement-breakpoint
ALTER TABLE "jubelio_sales_operation" ADD CONSTRAINT "jubelio_sales_operation_invoice_requires_sales_order" CHECK ("jubelio_sales_operation"."type" <> 'invoice' or "jubelio_sales_operation"."sales_order_id" is not null);--> statement-breakpoint
ALTER TABLE "jubelio_sales_operation" ADD CONSTRAINT "jubelio_sales_operation_payment_requires_invoice_id" CHECK ("jubelio_sales_operation"."type" <> 'payment' or "jubelio_sales_operation"."invoice_id" is not null);--> statement-breakpoint
ALTER TABLE "jubelio_sales_operation" ADD CONSTRAINT "jubelio_sales_operation_confirmed_invoice_requires_invoice_id" CHECK ("jubelio_sales_operation"."type" <> 'invoice' or "jubelio_sales_operation"."status" <> 'confirmed' or "jubelio_sales_operation"."invoice_id" is not null);--> statement-breakpoint
ALTER TABLE "jubelio_sales_operation" ADD CONSTRAINT "jubelio_sales_operation_confirmed_payment_requires_payment_id" CHECK ("jubelio_sales_operation"."type" <> 'payment' or "jubelio_sales_operation"."status" <> 'confirmed' or "jubelio_sales_operation"."payment_id" is not null);--> statement-breakpoint
ALTER TABLE "jubelio_sales_operation" ADD CONSTRAINT "jubelio_sales_operation_type_valid" CHECK ("jubelio_sales_operation"."type" in ('create', 'cancel', 'invoice', 'payment'));
-- Backfill (data migration, same release): legacy rows never captured a
-- provider `available` snapshot. The adjustment-era reality (no on_order /
-- reserved) makes `stock` the correct initial value; a NULL would fail closed
-- and hide every sellable unit until the next Jubelio stock sync.
UPDATE "branch_stock" SET "available_stock" = "stock" WHERE "available_stock" IS NULL;

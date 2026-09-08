ALTER TABLE "orders" DROP CONSTRAINT "orders_amounts_nonnegative";--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "ppn_rate" numeric(9, 6) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "ppn_amount" numeric(15, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_ppn_rate_valid" CHECK ("orders"."ppn_rate" >= 0 and "orders"."ppn_rate" <= 100);--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_amounts_nonnegative" CHECK ("orders"."subtotal" >= 0 and "orders"."shipping_cost" >= 0 and "orders"."discount" >= 0 and "orders"."service_fee" >= 0 and "orders"."ppn_amount" >= 0 and "orders"."total" >= 0);
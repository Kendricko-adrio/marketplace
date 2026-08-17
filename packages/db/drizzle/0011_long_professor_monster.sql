ALTER TABLE "orders" ADD COLUMN "pickup_verification_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "pickup_locked_until" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "orders_pickup_code_unique" ON "orders" USING btree ("pickup_code");--> statement-breakpoint
WITH grouped AS (
  SELECT "cart_id", "variant_id", "branch_id", MIN("id") AS keep_id,
         SUM("quantity")::integer AS merged_quantity
  FROM "cart_item"
  GROUP BY "cart_id", "variant_id", "branch_id"
  HAVING COUNT(*) > 1
)
UPDATE "cart_item" AS item
SET "quantity" = grouped.merged_quantity, "updated_at" = NOW()
FROM grouped
WHERE item."id" = grouped.keep_id;--> statement-breakpoint
WITH ranked AS (
  SELECT "id", ROW_NUMBER() OVER (
    PARTITION BY "cart_id", "variant_id", "branch_id" ORDER BY "created_at", "id"
  ) AS row_number
  FROM "cart_item"
)
DELETE FROM "cart_item"
WHERE "id" IN (SELECT "id" FROM ranked WHERE row_number > 1);--> statement-breakpoint
CREATE UNIQUE INDEX "cart_item_cart_variant_branch_unique" ON "cart_item" USING btree ("cart_id","variant_id","branch_id");--> statement-breakpoint
ALTER TABLE "branch_stock" ADD CONSTRAINT "branch_stock_nonnegative" CHECK ("branch_stock"."stock" >= 0);--> statement-breakpoint
ALTER TABLE "branch_stock" ADD CONSTRAINT "branch_reserved_stock_nonnegative" CHECK ("branch_stock"."reserved_stock" >= 0);--> statement-breakpoint
ALTER TABLE "branch" ADD CONSTRAINT "branch_status_valid" CHECK ("branch"."status" in ('aktif', 'nonaktif'));--> statement-breakpoint
ALTER TABLE "order_item" ADD CONSTRAINT "order_item_quantity_positive" CHECK ("order_item"."quantity" > 0);--> statement-breakpoint
ALTER TABLE "order_item" ADD CONSTRAINT "order_item_price_nonnegative" CHECK ("order_item"."price" >= 0);--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_status_valid" CHECK ("orders"."status" in ('pending_payment', 'processing', 'ready_for_pickup', 'completed', 'cancelled', 'failed_payment'));--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_payment_status_valid" CHECK ("orders"."payment_status" in ('pending', 'paid', 'failed'));--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_amounts_nonnegative" CHECK ("orders"."subtotal" >= 0 and "orders"."shipping_cost" >= 0 and "orders"."discount" >= 0 and "orders"."service_fee" >= 0 and "orders"."total" >= 0);--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_pickup_attempts_nonnegative" CHECK ("orders"."pickup_verification_attempts" >= 0);--> statement-breakpoint
ALTER TABLE "cart_item" ADD CONSTRAINT "cart_item_quantity_positive" CHECK ("cart_item"."quantity" > 0);

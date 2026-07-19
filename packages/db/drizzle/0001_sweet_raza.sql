ALTER TABLE "orders" ADD COLUMN "payment_failure_reason" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "midtrans_failure_status" text;
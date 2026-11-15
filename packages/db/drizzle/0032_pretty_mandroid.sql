CREATE TABLE "delivery_booking_reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"shipment_id" text NOT NULL,
	"attempt_number" integer NOT NULL,
	"original_dispatched_by" text,
	"original_dispatched_at" timestamp with time zone,
	"archived_request" jsonb NOT NULL,
	"proof_source" text NOT NULL,
	"proof_reference" text NOT NULL,
	"proof_reason" text NOT NULL,
	"absence_confirmed" boolean NOT NULL,
	"operation_closed" boolean NOT NULL,
	"released_by" text NOT NULL,
	"released_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_booking_review_attempt_positive" CHECK ("delivery_booking_reviews"."attempt_number" >= 1),
	CONSTRAINT "delivery_booking_review_proof_valid" CHECK ("delivery_booking_reviews"."proof_source" = 'jubelio_confirmation' and
        "delivery_booking_reviews"."absence_confirmed" is true and "delivery_booking_reviews"."operation_closed" is true)
);
--> statement-breakpoint
ALTER TABLE "delivery_shipment" DROP CONSTRAINT "delivery_shipment_attempt_at_most_one";--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "delivery_failure_code" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "delivery_failure_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "delivery_failure_by" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "delivery_manual_reason" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "delivery_manual_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "delivery_manual_by" text;--> statement-breakpoint
ALTER TABLE "delivery_booking_reviews" ADD CONSTRAINT "delivery_booking_reviews_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_booking_reviews" ADD CONSTRAINT "delivery_booking_reviews_shipment_id_delivery_shipment_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."delivery_shipment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_booking_reviews" ADD CONSTRAINT "delivery_booking_reviews_released_by_user_id_fk" FOREIGN KEY ("released_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_booking_review_shipment_attempt_unique" ON "delivery_booking_reviews" USING btree ("shipment_id","attempt_number");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_delivery_failure_by_user_id_fk" FOREIGN KEY ("delivery_failure_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_delivery_manual_by_user_id_fk" FOREIGN KEY ("delivery_manual_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_shipment" ADD CONSTRAINT "delivery_shipment_attempt_at_most_one" CHECK ("delivery_shipment"."attempt_count" >= 0);--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_delivery_failure_code_valid" CHECK ("orders"."delivery_failure_code" is null or "orders"."delivery_failure_code" in
        ('physical_stock_unavailable', 'damaged_goods', 'paid_service_limits_exceeded'));--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_delivery_manual_fields_complete" CHECK (("orders"."delivery_manual_reason" is null or ("orders"."delivery_manual_reason" <> ''
         and "orders"."delivery_manual_at" is not null and "orders"."delivery_manual_by" is not null)));--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_delivery_failure_manual_exclusive" CHECK (not ("orders"."delivery_failure_code" is not null and "orders"."delivery_manual_reason" is not null));
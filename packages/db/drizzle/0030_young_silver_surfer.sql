CREATE TABLE "delivery_shipment" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"state" text DEFAULT 'packed' NOT NULL,
	"stored_request" jsonb NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"packed_by" text NOT NULL,
	"dispatched_by" text,
	"booked_by" text,
	"dispatched_at" timestamp with time zone,
	"booked_at" timestamp with time zone,
	"shipment_id" integer,
	"awb" text,
	"tracking_url" text,
	"quote_rates" numeric(15, 2) NOT NULL,
	"booked_price" numeric(15, 2),
	"billed_price" numeric(15, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_shipment_order_id_unique" UNIQUE("order_id"),
	CONSTRAINT "delivery_shipment_state_valid" CHECK ("delivery_shipment"."state" in ('packed', 'booking_dispatched', 'booked', 'booking_unknown')),
	CONSTRAINT "delivery_shipment_attempt_at_most_one" CHECK ("delivery_shipment"."attempt_count" >= 0 and "delivery_shipment"."attempt_count" <= 1),
	CONSTRAINT "delivery_shipment_shipment_id_positive" CHECK ("delivery_shipment"."shipment_id" is null or "delivery_shipment"."shipment_id" > 0),
	CONSTRAINT "delivery_shipment_costs_finite_nonnegative" CHECK (("delivery_shipment"."quote_rates" >= 0 and "delivery_shipment"."quote_rates"::text not in ('NaN','Infinity','-Infinity')) and
        ("delivery_shipment"."booked_price" is null or ("delivery_shipment"."booked_price" >= 0 and "delivery_shipment"."booked_price"::text not in ('NaN','Infinity','-Infinity'))) and
        ("delivery_shipment"."billed_price" is null or ("delivery_shipment"."billed_price" >= 0 and "delivery_shipment"."billed_price"::text not in ('NaN','Infinity','-Infinity')))),
	CONSTRAINT "delivery_shipment_booked_fields_present" CHECK (("delivery_shipment"."state" <> 'booked' or ("delivery_shipment"."awb" is not null and "delivery_shipment"."shipment_id" is not null
         and "delivery_shipment"."booked_price" is not null and "delivery_shipment"."booked_by" is not null and "delivery_shipment"."dispatched_at" is not null))),
	CONSTRAINT "delivery_shipment_ambiguity_fields_absent" CHECK (("delivery_shipment"."state" not in ('packed', 'booking_dispatched', 'booking_unknown') or
         ("delivery_shipment"."awb" is null and "delivery_shipment"."shipment_id" is null and
          "delivery_shipment"."booked_price" is null and "delivery_shipment"."billed_price" is null and "delivery_shipment"."booked_at" is null)))
);
--> statement-breakpoint
ALTER TABLE "delivery_shipment" ADD CONSTRAINT "delivery_shipment_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_shipment" ADD CONSTRAINT "delivery_shipment_packed_by_user_id_fk" FOREIGN KEY ("packed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_shipment" ADD CONSTRAINT "delivery_shipment_dispatched_by_user_id_fk" FOREIGN KEY ("dispatched_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_shipment" ADD CONSTRAINT "delivery_shipment_booked_by_user_id_fk" FOREIGN KEY ("booked_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
CREATE TABLE "delivery_tracking_event" (
	"id" text PRIMARY KEY NOT NULL,
	"shipment_id" text NOT NULL,
	"external_shipment_id" integer,
	"ref_no" text,
	"awb" text NOT NULL,
	"latest_status" text,
	"status_detail" text,
	"fingerprint" text NOT NULL,
	"source" text DEFAULT 'webhook' NOT NULL,
	"applied" boolean DEFAULT false NOT NULL,
	"ignored_reason" text,
	"provider_event_at" timestamp with time zone,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"applied_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "delivery_shipment" ADD COLUMN "handed_over_by" text;--> statement-breakpoint
ALTER TABLE "delivery_shipment" ADD COLUMN "handed_over_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "delivery_shipment" ADD COLUMN "latest_status" text;--> statement-breakpoint
ALTER TABLE "delivery_shipment" ADD COLUMN "latest_event_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "delivery_shipment" ADD COLUMN "delivered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "delivery_shipment" ADD COLUMN "pod_url" text;--> statement-breakpoint
ALTER TABLE "delivery_tracking_event" ADD CONSTRAINT "delivery_tracking_event_shipment_id_delivery_shipment_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."delivery_shipment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_tracking_event_fingerprint_unique" ON "delivery_tracking_event" USING btree ("fingerprint");--> statement-breakpoint
CREATE INDEX "idx_delivery_tracking_event_shipment" ON "delivery_tracking_event" USING btree ("shipment_id");--> statement-breakpoint
ALTER TABLE "delivery_shipment" ADD CONSTRAINT "delivery_shipment_handed_over_by_user_id_fk" FOREIGN KEY ("handed_over_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_shipment_awb_global_unique" ON "delivery_shipment" USING btree ("awb");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_shipment_shipment_id_global_unique" ON "delivery_shipment" USING btree ("shipment_id");--> statement-breakpoint
ALTER TABLE "delivery_shipment" ADD CONSTRAINT "delivery_shipment_handoff_fields_present" CHECK (("delivery_shipment"."handed_over_at" is null or ("delivery_shipment"."booked_at" is not null and "delivery_shipment"."handed_over_by" is not null)));
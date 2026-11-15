ALTER TABLE "delivery_booking_reviews" DROP CONSTRAINT "delivery_booking_reviews_order_id_orders_id_fk";
--> statement-breakpoint
ALTER TABLE "delivery_booking_reviews" DROP CONSTRAINT "delivery_booking_reviews_shipment_id_delivery_shipment_id_fk";
--> statement-breakpoint
ALTER TABLE "delivery_shipment" DROP CONSTRAINT "delivery_shipment_order_id_orders_id_fk";
--> statement-breakpoint
ALTER TABLE "delivery_tracking_event" DROP CONSTRAINT "delivery_tracking_event_shipment_id_delivery_shipment_id_fk";
--> statement-breakpoint
ALTER TABLE "order_item" DROP CONSTRAINT "order_item_order_id_orders_id_fk";
--> statement-breakpoint
ALTER TABLE "order_item" DROP CONSTRAINT "order_item_variant_id_product_variant_id_fk";
--> statement-breakpoint
ALTER TABLE "orders" DROP CONSTRAINT "orders_user_id_client_id_fk";
--> statement-breakpoint
ALTER TABLE "jubelio_sales_operation" DROP CONSTRAINT "jubelio_sales_operation_order_id_orders_id_fk";
--> statement-breakpoint
ALTER TABLE "jubelio_channel_status_intent" DROP CONSTRAINT "jubelio_channel_status_intent_order_id_orders_id_fk";
--> statement-breakpoint
ALTER TABLE "delivery_booking_reviews" ADD CONSTRAINT "delivery_booking_reviews_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_booking_reviews" ADD CONSTRAINT "delivery_booking_reviews_shipment_id_delivery_shipment_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."delivery_shipment"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_shipment" ADD CONSTRAINT "delivery_shipment_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_tracking_event" ADD CONSTRAINT "delivery_tracking_event_shipment_id_delivery_shipment_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."delivery_shipment"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_item" ADD CONSTRAINT "order_item_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_item" ADD CONSTRAINT "order_item_variant_id_product_variant_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variant"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_client_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."client"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jubelio_sales_operation" ADD CONSTRAINT "jubelio_sales_operation_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jubelio_channel_status_intent" ADD CONSTRAINT "jubelio_channel_status_intent_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "orders" DROP CONSTRAINT "orders_address_id_address_id_fk";
--> statement-breakpoint
ALTER TABLE "address" ADD COLUMN "province_id" text;--> statement-breakpoint
ALTER TABLE "address" ADD COLUMN "city_id" text;--> statement-breakpoint
ALTER TABLE "address" ADD COLUMN "district_id" text;--> statement-breakpoint
ALTER TABLE "address" ADD COLUMN "area_id" text;--> statement-breakpoint
ALTER TABLE "address" ADD COLUMN "province" text;--> statement-breakpoint
ALTER TABLE "address" ADD COLUMN "area" text;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_address_id_address_id_fk" FOREIGN KEY ("address_id") REFERENCES "public"."address"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "address_default_per_client_unique" ON "address" USING btree ("user_id") WHERE "address"."is_default" = true;
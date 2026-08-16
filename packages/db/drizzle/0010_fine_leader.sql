ALTER TABLE "category" ADD COLUMN "jubelio_category_id" integer;--> statement-breakpoint
ALTER TABLE "product_variant" ADD COLUMN "jubelio_item_id" integer;--> statement-breakpoint
ALTER TABLE "product" ADD COLUMN "jubelio_item_group_id" integer;--> statement-breakpoint
ALTER TABLE "product" ADD COLUMN "thumbnail" text;--> statement-breakpoint
ALTER TABLE "product" ADD COLUMN "images" jsonb;--> statement-breakpoint
ALTER TABLE "branch" ADD COLUMN "jubelio_location_id" integer;--> statement-breakpoint
ALTER TABLE "category" ADD CONSTRAINT "category_jubelio_category_id_unique" UNIQUE("jubelio_category_id");--> statement-breakpoint
ALTER TABLE "product_variant" ADD CONSTRAINT "product_variant_jubelio_item_id_unique" UNIQUE("jubelio_item_id");--> statement-breakpoint
ALTER TABLE "product" ADD CONSTRAINT "product_jubelio_item_group_id_unique" UNIQUE("jubelio_item_group_id");--> statement-breakpoint
ALTER TABLE "branch" ADD CONSTRAINT "branch_jubelio_location_id_unique" UNIQUE("jubelio_location_id");
ALTER TABLE "product_variant" ADD COLUMN "barcode" text;--> statement-breakpoint
ALTER TABLE "product_variant" ADD COLUMN "discount" text;--> statement-breakpoint
ALTER TABLE "product" ADD COLUMN "article_number" text;--> statement-breakpoint
ALTER TABLE "product" ADD COLUMN "brand" text;--> statement-breakpoint
ALTER TABLE "product" ADD COLUMN "gender" text;--> statement-breakpoint
ALTER TABLE "product" ADD COLUMN "season" text;--> statement-breakpoint
ALTER TABLE "product" ADD COLUMN "collection" text;--> statement-breakpoint
CREATE INDEX "product_variant_barcode_idx" ON "product_variant" USING btree ("barcode");--> statement-breakpoint
ALTER TABLE "product" ADD CONSTRAINT "product_article_number_unique" UNIQUE("article_number");
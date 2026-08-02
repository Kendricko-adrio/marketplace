DROP TABLE "review" CASCADE;--> statement-breakpoint
ALTER TABLE "product" DROP COLUMN "rating";--> statement-breakpoint
ALTER TABLE "product" DROP COLUMN "sold";--> statement-breakpoint
ALTER TABLE "product" DROP COLUMN "is_flash_sale";--> statement-breakpoint
ALTER TABLE "product" DROP COLUMN "flash_sale_price";--> statement-breakpoint
ALTER TABLE "product" DROP COLUMN "flash_sale_ends_at";
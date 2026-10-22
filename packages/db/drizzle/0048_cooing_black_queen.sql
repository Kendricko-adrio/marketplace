ALTER TABLE "discount_request_window" DROP CONSTRAINT "discount_request_window_kind_valid";--> statement-breakpoint
ALTER TABLE "discount_offer" DROP CONSTRAINT "discount_offer_activation_kind_supported";--> statement-breakpoint
ALTER TABLE "discount_redemption" DROP CONSTRAINT "discount_redemption_activation_public";--> statement-breakpoint
ALTER TABLE "discount_redemption" ADD COLUMN "code_id" text;--> statement-breakpoint
ALTER TABLE "discount_offer" ADD CONSTRAINT "discount_offer_id_activation_unique" UNIQUE("id","activation_kind");--> statement-breakpoint
ALTER TABLE "discount_request_window" ADD CONSTRAINT "discount_request_window_kind_valid" CHECK ("discount_request_window"."kind" IN ('preview:account','preview:ip','place:account','place:ip','code:account','code:ip'));--> statement-breakpoint
ALTER TABLE "discount_offer" ADD CONSTRAINT "discount_offer_activation_kind_supported" CHECK ("discount_offer"."activation_kind" in ('public', 'manual_only'));--> statement-breakpoint
ALTER TABLE "discount_redemption" ADD CONSTRAINT "discount_redemption_activation_kind" CHECK (("discount_redemption"."activation_kind" = 'public' and "discount_redemption"."code_id" is null)
        or ("discount_redemption"."activation_kind" = 'manual_only' and "discount_redemption"."code_id" is not null));
ALTER TABLE "checkout_attempt" DROP CONSTRAINT "checkout_attempt_rejection_valid";--> statement-breakpoint
ALTER TABLE "checkout_attempt" ADD CONSTRAINT "checkout_attempt_rejection_valid" CHECK ((
    ("checkout_attempt"."state" = 'rejected' AND "checkout_attempt"."failure_code" IN ('SALES_ORDER_REJECTED','PAYMENT_INITIALIZATION_REJECTED','CHECKOUT_EXPIRED')
      AND "checkout_attempt"."stock_hold_state" = 'released' AND "checkout_attempt"."payment_state" IN ('none','rejected'))
    OR ("checkout_attempt"."state" <> 'rejected' AND "checkout_attempt"."failure_code" IS NULL)) IS TRUE);
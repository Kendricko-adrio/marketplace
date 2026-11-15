ALTER TABLE "orders" DROP CONSTRAINT "orders_pricing_versions_valid";--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_pricing_versions_valid" CHECK (("orders"."pricing_contract_version" = 0
          and "orders"."pricing_engine_version" = 0
          and "orders"."provider_contract_version" = 0)
        or ("orders"."pricing_contract_version" = 1
          and "orders"."pricing_engine_version" = 1
          and "orders"."provider_contract_version" = 2)
        or ("orders"."pricing_contract_version" = 1
          and "orders"."pricing_engine_version" = 1
          and "orders"."provider_contract_version" = 3));
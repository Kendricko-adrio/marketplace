ALTER TABLE "order_item" ADD COLUMN "pricing_contract_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "order_item" ADD COLUMN "source_unit_price" numeric(15, 2);--> statement-breakpoint
ALTER TABLE "order_item" ADD COLUMN "markdown_amount" numeric(15, 2);--> statement-breakpoint
ALTER TABLE "order_item" ADD COLUMN "goods_discount_amount" numeric(15, 2);--> statement-breakpoint
ALTER TABLE "order_item" ADD COLUMN "net_line_amount" numeric(15, 2);--> statement-breakpoint
ALTER TABLE "order_item" ADD COLUMN "markdown_revision_id" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "pricing_contract_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "pricing_engine_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "provider_contract_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "pricing_currency" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "source_goods_subtotal" numeric(15, 2);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "markdown_total" numeric(15, 2);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "net_goods" numeric(15, 2);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "shipping_before_subsidy" numeric(15, 2);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "shipping_subsidy" numeric(15, 2);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "merchant_funding" numeric(15, 2);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "taxable_base" numeric(15, 2);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "expected_provider_payable" numeric(15, 2);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "provider_quoted_shipping_cost" numeric(15, 2);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "provider_billed_shipping_cost" numeric(15, 2);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "pricing_snapshot" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "order_item_order_variant_unique" ON "order_item" USING btree ("order_id","variant_id");--> statement-breakpoint
ALTER TABLE "order_item" ADD CONSTRAINT "order_item_pricing_versions_valid" CHECK ("order_item"."pricing_contract_version" >= 0 and ("order_item"."pricing_contract_version" = 0 or "order_item"."pricing_contract_version" = 1));--> statement-breakpoint
ALTER TABLE "order_item" ADD CONSTRAINT "order_item_pricing_snapshot_complete" CHECK ("order_item"."pricing_contract_version" <> 1 or (
        "order_item"."source_unit_price" is not null
        and "order_item"."source_unit_price" >= 0
        and "order_item"."source_unit_price" = trunc("order_item"."source_unit_price")
        and "order_item"."source_unit_price" <= 9999999999999
        and "order_item"."markdown_amount" is not null
        and "order_item"."markdown_amount" >= 0
        and "order_item"."markdown_amount" = trunc("order_item"."markdown_amount")
        and "order_item"."markdown_amount" <= 9999999999999
        and "order_item"."goods_discount_amount" is not null
        and "order_item"."goods_discount_amount" >= 0
        and "order_item"."goods_discount_amount" = trunc("order_item"."goods_discount_amount")
        and "order_item"."goods_discount_amount" <= 9999999999999
        and "order_item"."net_line_amount" is not null
        and "order_item"."net_line_amount" >= 0
        and "order_item"."net_line_amount" = trunc("order_item"."net_line_amount")
        and "order_item"."net_line_amount" <= 9999999999999
        and "order_item"."price" >= 0
        and "order_item"."price" = trunc("order_item"."price")
        and "order_item"."price" <= 9999999999999
        and ("order_item"."markdown_revision_id" is null or length("order_item"."markdown_revision_id") <= 128)
      ));--> statement-breakpoint
ALTER TABLE "order_item" ADD CONSTRAINT "order_item_pricing_quantity_bounds" CHECK ("order_item"."pricing_contract_version" <> 1 or ("order_item"."quantity" >= 1 and "order_item"."quantity" <= 99));--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_pricing_versions_valid" CHECK (("orders"."pricing_contract_version" = 0
          and "orders"."pricing_engine_version" = 0
          and "orders"."provider_contract_version" = 0)
        or ("orders"."pricing_contract_version" = 1
          and "orders"."pricing_engine_version" = 1
          and "orders"."provider_contract_version" = 2));--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_pricing_currency_valid" CHECK ("orders"."pricing_currency" is null or "orders"."pricing_currency" = 'IDR');--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_pricing_amounts_nonnegative" CHECK (("orders"."source_goods_subtotal" is null or "orders"."source_goods_subtotal" >= 0)
        and ("orders"."markdown_total" is null or "orders"."markdown_total" >= 0)
        and ("orders"."net_goods" is null or "orders"."net_goods" >= 0)
        and ("orders"."shipping_before_subsidy" is null or "orders"."shipping_before_subsidy" >= 0)
        and ("orders"."shipping_subsidy" is null or "orders"."shipping_subsidy" >= 0)
        and ("orders"."merchant_funding" is null or "orders"."merchant_funding" >= 0)
        and ("orders"."taxable_base" is null or "orders"."taxable_base" >= 0)
        and ("orders"."expected_provider_payable" is null or "orders"."expected_provider_payable" >= 0)
        and ("orders"."provider_quoted_shipping_cost" is null or "orders"."provider_quoted_shipping_cost" >= 0)
        and ("orders"."provider_billed_shipping_cost" is null or "orders"."provider_billed_shipping_cost" >= 0));--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_pricing_snapshot_complete" CHECK ("orders"."pricing_contract_version" <> 1 or (
        "orders"."pricing_currency" is not null
        and "orders"."pricing_currency" = 'IDR'
        and "orders"."pricing_snapshot" is not null
        and "orders"."source_goods_subtotal" is not null
        and "orders"."source_goods_subtotal" >= 0
        and "orders"."source_goods_subtotal" = trunc("orders"."source_goods_subtotal")
        and "orders"."source_goods_subtotal" <= 9999999999999
        and "orders"."markdown_total" is not null
        and "orders"."markdown_total" >= 0
        and "orders"."markdown_total" = trunc("orders"."markdown_total")
        and "orders"."markdown_total" <= 9999999999999
        and "orders"."net_goods" is not null
        and "orders"."net_goods" >= 0
        and "orders"."net_goods" = trunc("orders"."net_goods")
        and "orders"."net_goods" <= 9999999999999
        and "orders"."shipping_before_subsidy" is not null
        and "orders"."shipping_before_subsidy" >= 0
        and "orders"."shipping_before_subsidy" = trunc("orders"."shipping_before_subsidy")
        and "orders"."shipping_before_subsidy" <= 9999999999999
        and "orders"."shipping_subsidy" is not null
        and "orders"."shipping_subsidy" >= 0
        and "orders"."shipping_subsidy" = trunc("orders"."shipping_subsidy")
        and "orders"."shipping_subsidy" <= 9999999999999
        and "orders"."merchant_funding" is not null
        and "orders"."merchant_funding" >= 0
        and "orders"."merchant_funding" = trunc("orders"."merchant_funding")
        and "orders"."merchant_funding" <= 9999999999999
        and "orders"."taxable_base" is not null
        and "orders"."taxable_base" >= 0
        and "orders"."taxable_base" = trunc("orders"."taxable_base")
        and "orders"."taxable_base" <= 9999999999999
        and "orders"."expected_provider_payable" is not null
        and "orders"."expected_provider_payable" >= 0
        and "orders"."expected_provider_payable" = trunc("orders"."expected_provider_payable")
        and "orders"."expected_provider_payable" <= 9999999999999
        and "orders"."subtotal" >= 0
        and "orders"."subtotal" = trunc("orders"."subtotal")
        and "orders"."subtotal" <= 9999999999999
        and "orders"."discount" >= 0
        and "orders"."discount" = trunc("orders"."discount")
        and "orders"."discount" <= 9999999999999
        and "orders"."shipping_cost" >= 0
        and "orders"."shipping_cost" = trunc("orders"."shipping_cost")
        and "orders"."shipping_cost" <= 9999999999999
        and "orders"."service_fee" = 0
        and "orders"."ppn_amount" >= 0
        and "orders"."ppn_amount" = trunc("orders"."ppn_amount")
        and "orders"."ppn_amount" <= 9999999999999
        and "orders"."total" >= 0
        and "orders"."total" = trunc("orders"."total")
        and "orders"."total" <= 9999999999999
        and ("orders"."provider_quoted_shipping_cost" is null
          or ("orders"."provider_quoted_shipping_cost" >= 0
              and "orders"."provider_quoted_shipping_cost" = trunc("orders"."provider_quoted_shipping_cost")
              and "orders"."provider_quoted_shipping_cost" <= 9999999999999))
        and ("orders"."provider_billed_shipping_cost" is null
          or ("orders"."provider_billed_shipping_cost" >= 0
              and "orders"."provider_billed_shipping_cost" = trunc("orders"."provider_billed_shipping_cost")
              and "orders"."provider_billed_shipping_cost" <= 9999999999999))
      ));--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_pricing_snapshot_size" CHECK ("orders"."pricing_snapshot" is null or octet_length("orders"."pricing_snapshot"::text) <= 262144);
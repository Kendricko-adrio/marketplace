CREATE INDEX "idx_orders_created_at" ON "orders" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_orders_branch_created_at" ON "orders" USING btree ("branch_id","created_at");
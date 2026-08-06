CREATE TABLE "notification" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text DEFAULT 'order_paid' NOT NULL,
	"order_id" text NOT NULL,
	"branch_id" text NOT NULL,
	"title" text NOT NULL,
	"message" text,
	"is_read" boolean DEFAULT false NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_notifications_branch_unread_created" ON "notification" USING btree ("branch_id","is_read","created_at");--> statement-breakpoint
CREATE INDEX "idx_notifications_order_id" ON "notification" USING btree ("order_id");
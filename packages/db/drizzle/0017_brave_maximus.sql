CREATE TABLE "admin_role_grant" (
	"id" text PRIMARY KEY NOT NULL,
	"role_id" text NOT NULL,
	"module" text NOT NULL,
	"action" text NOT NULL,
	"scope" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_role_grant_tuple_unique" UNIQUE("role_id","module","action"),
	CONSTRAINT "admin_role_grant_action_check" CHECK ("admin_role_grant"."action" in ('view', 'edit', 'delete')),
	CONSTRAINT "admin_role_grant_scope_check" CHECK ("admin_role_grant"."scope" is null or "admin_role_grant"."scope" in ('own_branch', 'all_branches', 'global')),
	CONSTRAINT "admin_role_grant_module_scope_shape_check" CHECK ((
        "admin_role_grant"."module" in ('products', 'orders', 'notifications', 'branches', 'analytics', 'audit_log')
        and "admin_role_grant"."scope" in ('own_branch', 'all_branches')
      ) or (
        "admin_role_grant"."module" in ('customers', 'homepage', 'pages', 'users', 'roles', 'footer')
        and ("admin_role_grant"."scope" = 'global' or "admin_role_grant"."scope" is null)
      ))
);
--> statement-breakpoint
CREATE TABLE "admin_role" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text,
	"name" text NOT NULL,
	"description" text,
	"is_system" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_role_key_unique" UNIQUE("key"),
	CONSTRAINT "admin_role_name_length_check" CHECK (char_length(regexp_replace(btrim("admin_role"."name"), '\s+', ' ', 'g')) between 2 and 64)
);
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "role_id" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "policy_version" integer;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "branch_scope" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "branch_id" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "related_branch_id" text;--> statement-breakpoint
ALTER TABLE "admin_role_grant" ADD CONSTRAINT "admin_role_grant_role_id_admin_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."admin_role"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "admin_role_name_normalized_unique" ON "admin_role" USING btree (lower(regexp_replace("name", '\s+', ' ', 'g')));--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_role_id_admin_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."admin_role"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_related_branch_id_branch_id_fk" FOREIGN KEY ("related_branch_id") REFERENCES "public"."branch"("id") ON DELETE set null ON UPDATE no action;
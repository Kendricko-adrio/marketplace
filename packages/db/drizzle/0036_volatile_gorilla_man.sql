ALTER TABLE "admin_role_grant" DROP CONSTRAINT "admin_role_grant_module_scope_shape_check";--> statement-breakpoint
ALTER TABLE "admin_role_grant" ADD CONSTRAINT "admin_role_grant_module_scope_shape_check" CHECK (((
        "admin_role_grant"."module" in ('products', 'orders', 'notifications', 'branches', 'analytics', 'audit_log')
        and "admin_role_grant"."scope" in ('own_branch', 'all_branches')
      ) or (
        "admin_role_grant"."module" in ('customers', 'homepage', 'pages', 'users', 'roles', 'footer')
        and ("admin_role_grant"."scope" = 'global' or "admin_role_grant"."scope" is null)
      )) or (
        "admin_role_grant"."module" in ('discounts', 'discount_capacity')
        and "admin_role_grant"."action" in ('view', 'edit')
        and ("admin_role_grant"."scope" = 'global' or "admin_role_grant"."scope" is null)
      ));
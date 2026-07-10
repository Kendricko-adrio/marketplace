import { pgTable, text, boolean, timestamp, unique } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// =========================================================
// ADMIN RBAC: Role-level permission matrix
// =========================================================
// Roles are hardcoded to "admin" and "hq" (see auth.ts).
// HQ is treated as implicit superuser in application code, so only
// the "admin" role is normally configured here. Each row defines
// what a role can do for a given admin module.

export const moduleNames = [
	"products",
	"orders",
	"branches",
	"homepage",
	"pages",
	"users",
] as const;

export type ModuleName = (typeof moduleNames)[number];

export type PermissionAction = "view" | "edit" | "delete";

export interface ModulePermissions {
	canView: boolean;
	canEdit: boolean;
	canDelete: boolean;
}

export type PermissionMap = Record<ModuleName, ModulePermissions>;

export const permissions = pgTable(
	"permission",
	{
		id: text("id").primaryKey(),
		role: text("role").notNull(), // admin | hq
		module: text("module").notNull(), // products | orders | branches | homepage | pages | users
		canView: boolean("can_view").notNull().default(false),
		canEdit: boolean("can_edit").notNull().default(false),
		canDelete: boolean("can_delete").notNull().default(false),
		createdAt: timestamp("created_at").notNull().defaultNow(),
		updatedAt: timestamp("updated_at").notNull().defaultNow(),
	},
	(t) => [unique("permission_role_module_unique").on(t.role, t.module)]
);

export const permissionsRelations = relations(permissions, () => ({}));

import { db, permissions, moduleNames } from "@/db";
import { eq } from "drizzle-orm";
import type {
	ModuleName,
	PermissionAction,
	PermissionMap,
	ModulePermissions,
} from "@/db";
import { HQ_PERMISSIONS } from "./permissions-shared";

export { HQ_PERMISSIONS, moduleLabel } from "./permissions-shared";

export async function getPermissionsForRole(role: string): Promise<PermissionMap> {
	if (role === "hq") {
		return { ...HQ_PERMISSIONS };
	}

	const rows = await db.select().from(permissions).where(eq(permissions.role, role));

	const map: Partial<PermissionMap> = {};
	for (const row of rows) {
		map[row.module as ModuleName] = {
			canView: row.canView,
			canEdit: row.canEdit,
			canDelete: row.canDelete,
		};
	}

	for (const moduleName of moduleNames) {
		if (!map[moduleName]) {
			map[moduleName] = { canView: false, canEdit: false, canDelete: false };
		}
	}

	return map as PermissionMap;
}

export function checkPermission(
	permMap: PermissionMap,
	moduleName: ModuleName,
	action: PermissionAction
): boolean {
	const p = permMap[moduleName];
	if (!p) return false;
	if (action === "view") return p.canView;
	if (action === "edit") return p.canEdit;
	if (action === "delete") return p.canDelete;
	return false;
}

export async function hasPermission(
	role: string,
	moduleName: ModuleName,
	action: PermissionAction
): Promise<boolean> {
	const permMap = await getPermissionsForRole(role);
	return checkPermission(permMap, moduleName, action);
}

export function getFirstViewableModule(permMap: PermissionMap): ModuleName | null {
	for (const moduleName of moduleNames) {
		if (permMap[moduleName]?.canView) {
			return moduleName;
		}
	}
	return null;
}

export async function getAllPermissions() {
	return db.select().from(permissions);
}

export async function upsertPermission(
	role: string,
	moduleName: ModuleName,
	perms: ModulePermissions
) {
	await db
		.insert(permissions)
		.values({
			id: crypto.randomUUID(),
			role,
			module: moduleName,
			canView: perms.canView,
			canEdit: perms.canEdit,
			canDelete: perms.canDelete,
		})
		.onConflictDoUpdate({
			target: [permissions.role, permissions.module],
			set: {
				canView: perms.canView,
				canEdit: perms.canEdit,
				canDelete: perms.canDelete,
				updatedAt: new Date(),
			},
		});
}

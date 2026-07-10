import type { ModuleName, PermissionMap } from "@/db";

// HQ is an implicit superuser — always full access. Keeping this in code
// prevents accidental lockout from the management page.
export const HQ_PERMISSIONS: PermissionMap = {
	products: { canView: true, canEdit: true, canDelete: true },
	orders: { canView: true, canEdit: true, canDelete: true },
	branches: { canView: true, canEdit: true, canDelete: true },
	homepage: { canView: true, canEdit: true, canDelete: true },
	pages: { canView: true, canEdit: true, canDelete: true },
	users: { canView: true, canEdit: true, canDelete: true },
};

export const MODULE_LABELS: Record<ModuleName, string> = {
	products: "Produk",
	orders: "Pesanan",
	branches: "Cabang",
	homepage: "Homepage",
	pages: "Halaman",
	users: "Pengguna",
};

export function moduleLabel(moduleName: ModuleName): string {
	return MODULE_LABELS[moduleName];
}

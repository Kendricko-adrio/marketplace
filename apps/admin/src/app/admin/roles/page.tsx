import { RolesListClient } from "./roles-list-client";

// =========================================================
// /admin/roles — Role list (server gate: roles:view via layout)
// =========================================================
// Replaces the legacy HQ permission matrix. The searchable list shows the
// System Owner (visible but immutable), editable system Roles, and custom
// Roles; archived Roles are behind an explicit filter. Detail/editor lives
// at /admin/roles/[id].

export default function RolesPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Hak Akses Role</h1>
        <p className="text-muted-foreground">
          Kelola Role dan hak aksesnya. Kombinasi izin mengikuti katalog
          tetap; cakupan cabang ditentukan per aksi.
        </p>
      </div>
      <RolesListClient />
    </div>
  );
}
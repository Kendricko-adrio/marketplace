import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { permissions } from "@/db";
import { eq } from "drizzle-orm";
import { RolesClient } from "./roles-client";
import type { ModuleName, PermissionMap } from "@/db";

// HQ-only hardcoded gate.
export default async function RolesPage() {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) {
    redirect("/login?callbackUrl=/admin/roles");
  }

  if (session.user.role !== "hq") {
    redirect("/admin?error=forbidden");
  }

  const rows = await db.select().from(permissions).where(eq(permissions.role, "admin"));

  const adminPermissions: PermissionMap = {
    products: { canView: false, canEdit: false, canDelete: false },
    orders: { canView: false, canEdit: false, canDelete: false },
    branches: { canView: false, canEdit: false, canDelete: false },
    homepage: { canView: false, canEdit: false, canDelete: false },
    pages: { canView: false, canEdit: false, canDelete: false },
    users: { canView: false, canEdit: false, canDelete: false },
  };

  for (const row of rows) {
    adminPermissions[row.module as ModuleName] = {
      canView: row.canView,
      canEdit: row.canEdit,
      canDelete: row.canDelete,
    };
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Hak Akses Role</h1>
        <p className="text-muted-foreground">
          Atur modul apa saja yang dapat diakses oleh role Admin. HQ selalu memiliki
          akses penuh ke semua modul.
        </p>
      </div>

      <RolesClient adminPermissions={adminPermissions} />
    </div>
  );
}

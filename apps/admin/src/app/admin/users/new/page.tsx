import { SYSTEM_OWNER_KEY, type Grant } from "@marketplace/db/src/rbac/catalog";
import { withinCeiling } from "@marketplace/db/src/rbac/policy";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { db } from "@/db";
import { branches } from "@/db";
import { eq } from "drizzle-orm";
import { NewUserClient } from "./new-user-client";
import { pagePermissionOrRedirect } from "@/lib/rbac/page-guard";
import { listRoles } from "@/lib/rbac/roles-service";
import type { RoleOption } from "@/components/admin/UserForm";

export const dynamic = "force-dynamic";

export default async function NewUserPage() {
  // Policy gate: creating users requires the `users:edit` grant from the
  // Current Policy (server-authoritative on every navigation).
  const policy = await pagePermissionOrRedirect("users", "edit", "/admin/users/new");

  const activeBranches = await db
    .select({
      id: branches.id,
      name: branches.name,
      code: branches.code,
      city: branches.city,
    })
    .from(branches)
    .where(eq(branches.status, "aktif"))
    .orderBy(branches.name);

  // Assignable Roles for this actor: active Roles the actor may assign
  // (Owner Role only for an Owner actor, others within the Authorization
  // Ceiling). The API re-validates every assignment server-side.
  const isOwnerActor = policy.role.key === SYSTEM_OWNER_KEY;
  const allRoles = await listRoles({});
  const assignableRoles: RoleOption[] = allRoles
    .filter((role) => !role.archived)
    .filter(
      (role) => role.key !== SYSTEM_OWNER_KEY || isOwnerActor
    )
    .filter((role) =>
      withinCeiling(
        isOwnerActor,
        policy.role.grants,
        role.grants.map((g) => ({
          module: g.module as Grant["module"],
          action: g.action as Grant["action"],
          scope: (g.scope ?? "global") as Grant["scope"],
        }))
      )
    )
    .map((role) => ({
      id: role.id,
      key: role.key,
      name: role.name,
      isSystem: role.isSystem,
    }));

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2">
          <Link href="/admin/users">
            <ChevronLeft className="h-4 w-4 mr-1" />
            Kembali ke daftar pengguna
          </Link>
        </Button>
        <h2 className="text-2xl font-bold tracking-tight">Tambah Admin</h2>
        <p className="text-muted-foreground text-sm mt-1">
          Buat akun admin baru. Kredensial akan ditampilkan satu kali setelah
          pembuatan.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Buat Pengguna Baru</CardTitle>
          <CardDescription>
            Setelah dibuat, pengguna wajib mengganti kata sandi pada login
            pertama.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <NewUserClient
            roles={assignableRoles}
            branches={activeBranches}
          />
        </CardContent>
      </Card>
    </div>
  );
}
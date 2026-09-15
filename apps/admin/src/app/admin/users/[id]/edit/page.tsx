import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
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
import { EditUserClient } from "./edit-user-client";
import { pagePermissionOrRedirect } from "@/lib/rbac/page-guard";
import { getUserDetail } from "@/lib/rbac/users-service";

export const dynamic = "force-dynamic";

export default async function EditUserPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // Policy gate: editing users requires the `users:edit` grant from the
  // Current Policy (server-authoritative on every navigation).
  await pagePermissionOrRedirect("users", "edit", `/admin/users/${id}/edit`);

  const user = await getUserDetail(id);
  // `users.role_id` is NOT NULL with an FK to `admin_role`, so the current
  // Role object always resolves for an existing user.
  if (!user || !user.role) notFound();

  const activeBranches = await db
    .select({
      id: branches.id,
      name: branches.name,
      code: branches.code,
      city: branches.city,
    })
    .from(branches)
    .orderBy(branches.name);

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2">
          <Link href="/admin/users">
            <ChevronLeft className="h-4 w-4 mr-1" />
            Kembali ke daftar pengguna
          </Link>
        </Button>
        <h2 className="text-2xl font-bold tracking-tight">Edit Pengguna</h2>
        <p className="text-muted-foreground text-sm mt-1">
          Ubah informasi pengguna{" "}
          <strong>{user.name}</strong> ({user.email}).
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Detail Pengguna</CardTitle>
          <CardDescription>
            {user.username && (
              <>
                Username: <code className="font-mono">{user.username}</code>
              </>
            )}
            {user.mustResetPassword && (
              <span className="ml-2 text-xs text-amber-600">
                (pengguna belum mengganti kata sandi)
              </span>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <EditUserClient
            userId={user.id}
            role={user.role}
            initialData={{
              name: user.name,
              email: user.email,
              roleId: user.role.id,
              branchId: user.branch?.id ?? null,
              username: user.username,
            }}
            branches={activeBranches}
          />
        </CardContent>
      </Card>
    </div>
  );
}
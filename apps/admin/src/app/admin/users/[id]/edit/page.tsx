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
import { users, branches } from "@/db";
import { eq } from "drizzle-orm";
import { EditUserClient } from "./edit-user-client";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { checkPermission, getPermissionsForRole } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export default async function EditUserPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) {
    redirect(`/login?callbackUrl=/admin/users/${id}/edit`);
  }

  const permissions = await getPermissionsForRole(session.user.role);
  if (!checkPermission(permissions, "users", "edit")) {
    redirect("/admin/users?error=forbidden");
  }

  const user = await db
    .select({
      id: users.id,
      name: users.name,
      username: users.username,
      email: users.email,
      role: users.role,
      branchId: users.branchId,
      mustResetPassword: users.mustResetPassword,
    })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);

  if (!user.length) notFound();

  const activeBranches = await db
    .select({
      id: branches.id,
      name: branches.name,
      code: branches.code,
      city: branches.city,
    })
    .from(branches)
    .orderBy(branches.name);

  const u = user[0];

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
          <strong>{u.name}</strong> ({u.email}).
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Detail Pengguna</CardTitle>
          <CardDescription>
            Username: <code className="font-mono">{u.username}</code>
            {u.mustResetPassword && (
              <span className="ml-2 text-xs text-amber-600">
                (pengguna belum mengganti kata sandi)
              </span>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <EditUserClient
            userId={u.id}
            initialData={{
              name: u.name,
              email: u.email,
              role: u.role as "admin" | "hq",
              branchId: u.branchId,
            }}
            branches={activeBranches}
          />
        </CardContent>
      </Card>
    </div>
  );
}

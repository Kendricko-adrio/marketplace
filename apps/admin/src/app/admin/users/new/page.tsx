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
import { NewUserClient } from "./new-user-client";

export const dynamic = "force-dynamic";

export default async function NewUserPage() {
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
          <NewUserClient branches={activeBranches} />
        </CardContent>
      </Card>
    </div>
  );
}
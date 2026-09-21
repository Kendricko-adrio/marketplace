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
import { PageForm } from "@/components/admin/PageForm";
import { pagePermissionOrRedirect } from "@/lib/rbac/page-guard";

export const dynamic = "force-dynamic";

export default async function NewPagePage() {
  // Policy gate: creating pages requires the `pages:edit` grant from the
  // Current Policy (server-authoritative on every navigation).
  await pagePermissionOrRedirect("pages", "edit", "/admin/pages/new");

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2">
          <Link href="/admin/pages">
            <ChevronLeft className="h-4 w-4 mr-1" />
            Kembali ke daftar halaman
          </Link>
        </Button>
        <h2 className="text-2xl font-bold tracking-tight">Halaman Baru</h2>
        <p className="text-muted-foreground text-sm mt-1">
          Buat halaman statis baru dengan konten markdown.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Buat Halaman Baru</CardTitle>
          <CardDescription>
            Gunakan editor visual untuk memformat konten — markdown dibuat
            otomatis di latar belakang.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PageForm mode="create" />
        </CardContent>
      </Card>
    </div>
  );
}

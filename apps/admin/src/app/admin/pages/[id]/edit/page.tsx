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
import { staticPages } from "@/db";
import { eq } from "drizzle-orm";
import { PageForm } from "@/components/admin/PageForm";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { checkPermission, getPermissionsForRole } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export default async function EditPagePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) {
    redirect(`/login?callbackUrl=/admin/pages/${id}/edit`);
  }

  const permissions = await getPermissionsForRole(session.user.role);
  if (!checkPermission(permissions, "pages", "edit")) {
    redirect("/admin/pages?error=forbidden");
  }

  const rows = await db
    .select({
      id: staticPages.id,
      slug: staticPages.slug,
      title: staticPages.title,
      content: staticPages.content,
      isPublished: staticPages.isPublished,
      displayOrder: staticPages.displayOrder,
    })
    .from(staticPages)
    .where(eq(staticPages.id, id))
    .limit(1);

  if (!rows.length) notFound();

  const page = rows[0];

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2">
          <Link href="/admin/pages">
            <ChevronLeft className="h-4 w-4 mr-1" />
            Kembali ke daftar halaman
          </Link>
        </Button>
        <h2 className="text-2xl font-bold tracking-tight">Edit Halaman</h2>
        <p className="text-muted-foreground text-sm mt-1">
          Ubah halaman <strong>{page.title}</strong> ({" "}
          <code className="font-mono text-xs">/pages/{page.slug}</code>).
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Detail Halaman</CardTitle>
          <CardDescription>
            Konten diedit melalui editor visual (WYSIWYG) dan disimpan sebagai
            markdown di latar belakang.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PageForm
            mode="edit"
            pageId={page.id}
            initialData={{
              slug: page.slug,
              title: page.title,
              content: page.content,
              isPublished: page.isPublished,
              displayOrder: page.displayOrder,
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}

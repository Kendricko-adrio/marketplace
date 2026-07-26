import { db } from "@/db";
import { footerConfig } from "@/db";
import { FooterForm } from "@/components/admin/FooterForm";
import type { FooterConfigData } from "@marketplace/ui";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function AdminFooterPage() {
  // Layout already enforces HQ-only; we just fetch the row directly on the
  // server and pass it to the client form as initialData.
  let initialData: FooterConfigData | null = null;

  try {
    const rows = await db
      .select({ data: footerConfig.data })
      .from(footerConfig)
      .limit(1);
    if (rows.length > 0) {
      initialData = rows[0].data as FooterConfigData;
    }
  } catch (error) {
    console.error("Error fetching footer config:", error);
  }

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Footer</h2>
        <p className="text-muted-foreground text-sm mt-1">
          Atur konten footer yang tampil di seluruh halaman storefront. Hanya HQ
          yang dapat mengubah pengaturan ini.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Konfigurasi Footer</CardTitle>
          <CardDescription>
            Brand, kolom link, social media, dan teks copyright. Perubahan
            langsung tampil di storefront setelah disimpan.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FooterForm initialData={initialData} />
        </CardContent>
      </Card>
    </div>
  );
}
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { db } from "@/db";
import { staticPages } from "@/db";
import { eq, and } from "drizzle-orm";
import { MarkdownRenderer } from "@marketplace/ui";

export const dynamic = "force-dynamic";

interface PageRow {
  id: string;
  slug: string;
  title: string;
  content: string;
  isPublished: boolean;
  displayOrder: number;
}

async function getStaticPage(slug: string): Promise<PageRow | null> {
  try {
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
      .where(and(eq(staticPages.slug, slug), eq(staticPages.isPublished, true)))
      .limit(1);
    return rows[0] ?? null;
  } catch (error) {
    console.error("Error fetching static page:", error);
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const page = await getStaticPage(slug);
  if (!page) return { title: "Halaman tidak ditemukan" };
  return {
    title: page.title,
    description: page.title,
  };
}

export default async function StaticPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const page = await getStaticPage(slug);

  if (!page) notFound();

  return (
    <div className="container mx-auto px-4 py-10 max-w-3xl">
      <article>
        <h1 className="text-4xl font-bold tracking-tight mb-6">
          {page.title}
        </h1>
        <MarkdownRenderer content={page.content} />
      </article>
    </div>
  );
}
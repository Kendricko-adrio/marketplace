"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  HomepageSectionRenderer,
  type HomepageSectionData,
  type HomepageProduct,
  type HomepageBranch,
} from "@marketplace/ui";
import { toStoreUrl } from "@/lib/store-url";

interface PreviewSection {
  id: string;
  type: string;
  title: string | null;
  subtitle: string | null;
  content: unknown;
  displayOrder: number;
  isActive: boolean;
  products?: HomepageProduct[];
  branches?: HomepageBranch[];
}

function rewriteBannerImages(content: unknown): unknown {
  if (!content || typeof content !== "object") return content;
  const c = content as Record<string, unknown>;
  // New schema: slides array
  if (Array.isArray(c.slides)) {
    return {
      ...c,
      slides: c.slides.map(
        (s) =>
          s && typeof s === "object" && typeof (s as Record<string, unknown>).imageUrl === "string"
            ? {
                ...(s as Record<string, unknown>),
                imageUrl: toStoreUrl((s as Record<string, unknown>).imageUrl as string),
              }
            : s
      ),
    };
  }
  // Legacy schema: single imageUrl
  if (typeof c.imageUrl === "string") {
    return { ...c, imageUrl: toStoreUrl(c.imageUrl) };
  }
  // Promo cards: rewrite each card imageUrl
  if (Array.isArray(c.cards)) {
    return {
      ...c,
      cards: c.cards.map(
        (card) =>
          card && typeof card === "object" && typeof (card as Record<string, unknown>).imageUrl === "string"
            ? {
                ...(card as Record<string, unknown>),
                imageUrl: toStoreUrl((card as Record<string, unknown>).imageUrl as string),
              }
            : card
      ),
    };
  }
  return content;
}

export default function HomepagePreviewPage() {
  const [sections, setSections] = useState<PreviewSection[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    const fetchAll = async () => {
      try {
        // Single fetch: the preview-all endpoint returns ALL sections
        // (active + inactive) with carousel products and store_banner
        // branches fully hydrated. This avoids the storefront API which
        // only returns active sections.
        const res = await fetch("/api/admin/homepage/preview-all", { cache: "no-store" });
        const data = await res.json();
        if (data.success) setSections(data.data);
      } catch (error) {
        console.error("Error fetching sections:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchAll();
  }, []);

  const visibleSections = showAll ? sections : sections.filter((s) => s.isActive);

  const announcement = visibleSections.find((s) => s.type === "announcement_bar");
  const rest = visibleSections.filter((s) => s.type !== "announcement_bar");

  const renderSection = (section: PreviewSection) => {
    // Rewrite carousel product images to the store origin. The API returns
    // image paths as "/uploads/..." which the admin app (port 3001) does not
    // serve — without rewriting they would 404 in the admin preview.
    const products = section.products?.map((p) => ({
      ...p,
      image: p.image ? toStoreUrl(p.image) : null,
    }));
    const sectionData: HomepageSectionData = {
      id: section.id,
      type: section.type as HomepageSectionData["type"],
      title: section.title,
      subtitle: section.subtitle,
      content: rewriteBannerImages(section.content),
      displayOrder: section.displayOrder,
      isActive: section.isActive,
      products,
      branches: section.branches,
    };
    return <HomepageSectionRenderer key={section.id} section={sectionData} preview />;
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b bg-card sticky top-0 z-20">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" asChild>
              <Link href="/admin/homepage">
                <ArrowLeft className="h-4 w-4" /> Kembali ke Kelola
              </Link>
            </Button>
            <span className="text-sm text-muted-foreground">Preview Homepage</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowAll(!showAll)}
            className="gap-2"
          >
            {showAll ? (
              <>
                <EyeOff className="h-4 w-4" /> Tampilkan Aktif Saja
              </>
            ) : (
              <>
                <Eye className="h-4 w-4" /> Tampilkan Semua
              </>
            )}
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : visibleSections.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground">
          Tidak ada section untuk ditampilkan
        </div>
      ) : (
        <div>
          {showAll && !announcement?.isActive && announcement && (
            <div className="bg-amber-100 text-amber-900 text-xs py-1 text-center">
              Section berikut tidak aktif ( disembunyikan dari customer )
            </div>
          )}
          {announcement && (
            <div className="relative">
              {renderSection(announcement)}
              {!announcement.isActive && <InactiveBadge />}
            </div>
          )}
          {rest.map((section) => (
            <div key={section.id} className="relative">
              {renderSection(section)}
              {!section.isActive && <InactiveBadge />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function InactiveBadge() {
  return (
    <div className="absolute top-2 right-2 z-20">
      <Badge variant="destructive">Nonaktif</Badge>
    </div>
  );
}
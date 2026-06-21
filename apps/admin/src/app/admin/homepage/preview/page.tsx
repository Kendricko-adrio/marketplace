"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  HomepageSectionRenderer,
  type HomepageSectionData,
} from "@marketplace/ui";

interface AdminSection {
  id: string;
  type: string;
  title: string | null;
  subtitle: string | null;
  content: unknown;
  displayOrder: number;
  isActive: boolean;
  products?: { id: string; name: string; slug: string; displayOrder: number }[];
}

export default function HomepagePreviewPage() {
  const [sections, setSections] = useState<AdminSection[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    const fetchSections = async () => {
      try {
        const res = await fetch("/api/admin/homepage");
        const data = await res.json();
        if (data.success) setSections(data.data);
      } catch (error) {
        console.error("Error fetching sections:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchSections();
  }, []);

  const visibleSections = showAll
    ? sections
    : sections.filter((s) => s.isActive);

  const announcement = visibleSections.find((s) => s.type === "announcement_bar");
  const rest = visibleSections.filter((s) => s.type !== "announcement_bar");

  const renderSection = (section: AdminSection) => {
    const sectionData: HomepageSectionData = {
      id: section.id,
      type: section.type as HomepageSectionData["type"],
      title: section.title,
      subtitle: section.subtitle,
      content: section.content,
      displayOrder: section.displayOrder,
      isActive: section.isActive,
    };
    return <HomepageSectionRenderer key={section.id} section={sectionData} preview />;
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b bg-card sticky top-0 z-50">
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
              {!announcement.isActive && (
                <InactiveBadge />
              )}
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
    <div className="absolute top-2 right-2 z-50">
      <Badge variant="destructive">Nonaktif</Badge>
    </div>
  );
}
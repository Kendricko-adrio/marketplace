"use client";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { GripVertical, Pencil, Trash2 } from "lucide-react";
import type { HomepageSection, SectionType } from "@/types/homepage";

const typeLabels: Record<SectionType, string> = {
  banner: "Banner",
  carousel_product: "Carousel Produk",
  category_grid: "Grid Kategori",
  promo_cards: "Kartu Promo",
  countdown_flash_sale: "Flash Sale",
  image_text_block: "Gambar + Teks",
  announcement_bar: "Announcement",
  product_grid: "Grid Produk",
  brand_strip: "Brand Strip",
  video_embed: "Video",
};

interface SectionCardProps {
  section: HomepageSection;
  onToggle: (id: string, active: boolean) => void;
  onEdit: (section: HomepageSection) => void;
  onDelete: (id: string) => void;
  onDragStart: (e: React.DragEvent, index: number) => void;
  onDragOver: (e: React.DragEvent, index: number) => void;
  onDrop: (e: React.DragEvent, index: number) => void;
  index: number;
}

export default function SectionCard({
  section,
  onToggle,
  onEdit,
  onDelete,
  onDragStart,
  onDragOver,
  onDrop,
  index,
}: SectionCardProps) {
  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, index)}
      onDragOver={(e) => onDragOver(e, index)}
      onDrop={(e) => onDrop(e, index)}
      className="flex items-center gap-4 p-4 rounded-lg border bg-card hover:shadow-sm transition-shadow"
    >
      <div className="cursor-grab active:cursor-grabbing text-muted-foreground">
        <GripVertical className="h-5 w-5" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm truncate">{section.title}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground font-medium uppercase tracking-wide">
            {typeLabels[section.type as SectionType] || section.type}
          </span>
          {!section.isActive && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-destructive/10 text-destructive font-medium">
              Nonaktif
            </span>
          )}
        </div>
      </div>
      <Switch
        checked={section.isActive}
        onCheckedChange={(checked) => onToggle(section.id, checked)}
      />
      <Button size="icon" variant="ghost" onClick={() => onEdit(section)}>
        <Pencil className="h-4 w-4" />
      </Button>
      <Button size="icon" variant="ghost" onClick={() => onDelete(section.id)}>
        <Trash2 className="h-4 w-4 text-destructive" />
      </Button>
    </div>
  );
}

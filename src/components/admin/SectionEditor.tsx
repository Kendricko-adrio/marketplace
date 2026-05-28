"use client";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { HomepageSection } from "@/types/homepage";
import BannerEditor from "./editors/BannerEditor";
import CarouselEditor from "./editors/CarouselEditor";
import CategoryGridEditor from "./editors/CategoryGridEditor";
import PromoCardsEditor from "./editors/PromoCardsEditor";
import CountdownEditor from "./editors/CountdownEditor";
import ImageTextEditor from "./editors/ImageTextEditor";
import AnnouncementEditor from "./editors/AnnouncementEditor";
import ProductGridEditor from "./editors/ProductGridEditor";
import BrandStripEditor from "./editors/BrandStripEditor";
import VideoEmbedEditor from "./editors/VideoEmbedEditor";

interface SectionEditorProps {
  section: HomepageSection | null;
  open: boolean;
  onClose: () => void;
  onSave: (id: string, values: { title: string; config: Record<string, unknown>; isActive?: boolean }) => void;
}

export default function SectionEditor({ section, open, onClose, onSave }: SectionEditorProps) {
  if (!section) return null;

  const editors: Record<string, React.ComponentType<{ section: HomepageSection; onSave: SectionEditorProps["onSave"] }>> = {
    banner: BannerEditor,
    carousel_product: CarouselEditor,
    category_grid: CategoryGridEditor,
    promo_cards: PromoCardsEditor,
    countdown_flash_sale: CountdownEditor,
    image_text_block: ImageTextEditor,
    announcement_bar: AnnouncementEditor,
    product_grid: ProductGridEditor,
    brand_strip: BrandStripEditor,
    video_embed: VideoEmbedEditor,
  };

  const EditorComponent = editors[section.type];

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Edit Section</SheetTitle>
        </SheetHeader>
        <div className="py-6">
          {EditorComponent ? (
            <EditorComponent section={section} onSave={onSave} />
          ) : (
            <div className="text-muted-foreground">Editor tidak tersedia untuk tipe ini.</div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

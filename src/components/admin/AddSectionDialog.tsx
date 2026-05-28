"use client";
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

const sectionTypes = [
  { type: "banner", label: "Banner", description: "Hero atau split banner dengan CTA" },
  { type: "carousel_product", label: "Carousel Produk", description: "Gulir horizontal produk" },
  { type: "category_grid", label: "Grid Kategori", description: "Tampilan ikon kategori" },
  { type: "promo_cards", label: "Kartu Promo", description: "Kartu promosi 1-3 kolom" },
  { type: "countdown_flash_sale", label: "Flash Sale Countdown", description: "Hitung mundur flash sale" },
  { type: "image_text_block", label: "Gambar + Teks", description: "Blok konten gambar dan teks" },
  { type: "announcement_bar", label: "Announcement Bar", description: "Bar pengumuman di atas halaman" },
  { type: "product_grid", label: "Grid Produk", description: "Grid produk 3-4 kolom" },
  { type: "brand_strip", label: "Brand Strip", description: "Strip logo merek" },
  { type: "video_embed", label: "Video Embed", description: "Embed YouTube/Vimeo" },
];

interface AddSectionDialogProps {
  onAdd: (type: string) => void;
}

export default function AddSectionDialog({ onAdd }: AddSectionDialogProps) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2">
          <Plus className="h-4 w-4" />
          Tambah Section
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Pilih Tipe Section</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3 py-4">
          {sectionTypes.map((s) => (
            <button
              key={s.type}
              onClick={() => {
                onAdd(s.type);
                setOpen(false);
              }}
              className="text-left p-4 rounded-lg border hover:bg-accent hover:border-primary transition-colors"
            >
              <div className="font-medium text-sm">{s.label}</div>
              <div className="text-xs text-muted-foreground mt-1">{s.description}</div>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

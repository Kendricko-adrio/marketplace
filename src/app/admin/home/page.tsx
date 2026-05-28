"use client";
import { useEffect, useState } from "react";
import AddSectionDialog from "@/components/admin/AddSectionDialog";
import SectionCard from "@/components/admin/SectionCard";
import SectionEditor from "@/components/admin/SectionEditor";
import type { HomepageSection } from "@/types/homepage";
import { Button } from "@/components/ui/button";
import { ArrowUp, ArrowDown } from "lucide-react";

export default function AdminHomePage() {
  const [sections, setSections] = useState<HomepageSection[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingSection, setEditingSection] = useState<HomepageSection | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  async function loadSections() {
    const res = await fetch("/api/admin/home");
    const json = await res.json();
    if (json.success) setSections(json.data);
    setLoading(false);
  }

  useEffect(() => {
    async function load() {
      await loadSections();
    }
    load();
  }, []);

  const handleAdd = async (type: string) => {
    const defaultConfigs: Record<string, Record<string, unknown>> = {
      banner: { template: "hero", images: [{ url: "", link: "", alt: "" }] },
      carousel_product: { source: "flash_sale", maxItems: 8, autoplay: true },
      category_grid: { categoryIds: [], columns: 6, showIcon: true },
      promo_cards: { layout: "double", cards: [] },
      countdown_flash_sale: { title: "Flash Sale", endDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), source: "flash_sale", maxItems: 6 },
      image_text_block: { imageUrl: "", imagePosition: "left", title: "", description: "" },
      announcement_bar: { text: "", dismissible: false },
      product_grid: { source: "best_seller", columns: 4, rows: 2, showViewAll: true },
      brand_strip: { logos: [], autoplay: true },
      video_embed: { videoUrl: "", platform: "youtube", aspectRatio: "16/9", autoplay: false },
    };

    const titleMap: Record<string, string> = {
      banner: "Banner Baru",
      carousel_product: "Carousel Produk",
      category_grid: "Grid Kategori",
      promo_cards: "Kartu Promo",
      countdown_flash_sale: "Flash Sale",
      image_text_block: "Gambar + Teks",
      announcement_bar: "Pengumuman",
      product_grid: "Grid Produk",
      brand_strip: "Brand Strip",
      video_embed: "Video",
    };

    const res = await fetch("/api/admin/home", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type,
        title: titleMap[type] || "Section Baru",
        config: defaultConfigs[type] || {},
      }),
    });
    const json = await res.json();
    if (json.success) {
      await loadSections();
    }
  };

  const handleToggle = async (id: string, active: boolean) => {
    await fetch(`/api/admin/home/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: active }),
    });
    setSections((prev) =>
      prev.map((s) => (s.id === id ? { ...s, isActive: active } : s))
    );
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Yakin ingin menghapus section ini?")) return;
    await fetch(`/api/admin/home/${id}`, { method: "DELETE" });
    setSections((prev) => prev.filter((s) => s.id !== id));
  };

  const handleEdit = (section: HomepageSection) => {
    setEditingSection(section);
    setEditorOpen(true);
  };

  const handleSave = async (
    id: string,
    values: { title: string; config: Record<string, unknown>; isActive?: boolean }
  ) => {
    await fetch(`/api/admin/home/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });
    setEditorOpen(false);
    setEditingSection(null);
    await loadSections();
  };

  const persistOrder = async (newSections: HomepageSection[]) => {
    const payload = newSections.map((s, i) => ({ id: s.id, displayOrder: i }));
    await fetch("/api/admin/home", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sections: payload }),
    });
  };

  const handleDragStart = (_e: React.DragEvent, index: number) => {
    setDragIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (dragIndex === null || dragIndex === index) return;
    const newSections = [...sections];
    const [moved] = newSections.splice(dragIndex, 1);
    newSections.splice(index, 0, moved);
    setSections(newSections);
    setDragIndex(index);
  };

  const handleDrop = () => {
    setDragIndex(null);
    persistOrder(sections);
  };

  const moveUp = (index: number) => {
    if (index === 0) return;
    const newSections = [...sections];
    [newSections[index - 1], newSections[index]] = [newSections[index], newSections[index - 1]];
    setSections(newSections);
    persistOrder(newSections);
  };

  const moveDown = (index: number) => {
    if (index === sections.length - 1) return;
    const newSections = [...sections];
    [newSections[index], newSections[index + 1]] = [newSections[index + 1], newSections[index]];
    setSections(newSections);
    persistOrder(newSections);
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Halaman Depan</h1>
          <p className="text-muted-foreground text-sm">Atur tampilan homepage marketplace</p>
        </div>
        <AddSectionDialog onAdd={handleAdd} />
      </div>

      {loading ? (
        <div className="text-muted-foreground">Memuat sections...</div>
      ) : sections.length === 0 ? (
        <div className="text-center py-12 border rounded-lg bg-muted/30">
          <p className="text-muted-foreground">Belum ada section. Tambahkan section pertama.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {sections.map((section, i) => (
            <div key={section.id} className="flex items-center gap-2">
              <SectionCard
                section={section}
                index={i}
                onToggle={handleToggle}
                onEdit={handleEdit}
                onDelete={handleDelete}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
              />
              <div className="flex flex-col gap-1">
                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => moveUp(i)} disabled={i === 0}>
                  <ArrowUp className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => moveDown(i)} disabled={i === sections.length - 1}>
                  <ArrowDown className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <SectionEditor
        section={editingSection}
        open={editorOpen}
        onClose={() => { setEditorOpen(false); setEditingSection(null); }}
        onSave={handleSave}
      />
    </div>
  );
}

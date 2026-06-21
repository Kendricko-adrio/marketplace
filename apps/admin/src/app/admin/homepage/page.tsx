"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Plus, GripVertical, Edit, Trash2, Eye, Loader2, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

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

const TYPE_LABELS: Record<string, string> = {
  banner: "Banner Hero",
  carousel_product: "Carousel Produk",
  promo_cards: "Promo Cards",
  announcement_bar: "Announcement Bar",
  store_banner: "Store Banner",
};

const TYPE_DESCRIPTIONS: Record<string, string> = {
  banner: "Hero section besar dengan gambar dan tombol CTA",
  carousel_product: "Deretan produk pilihan yang dipilih manual",
  promo_cards: "Grid kartu promosi dengan gambar, judul, dan tautan",
  announcement_bar: "Bar pengumuman di atas halaman, bisa ditutup visitor",
  store_banner: "Grid cabang toko aktif (otomatis dari database)",
};

export default function AdminHomepagePage() {
  const router = useRouter();
  const [sections, setSections] = useState<AdminSection[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [reordering, setReordering] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const fetchSections = async () => {
    setLoading(true);
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

  useEffect(() => {
    fetchSections();
  }, []);

  const handleToggleActive = async (id: string, isActive: boolean) => {
    setSections((prev) =>
      prev.map((s) => (s.id === id ? { ...s, isActive } : s))
    );
    try {
      await fetch(`/api/admin/homepage/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive }),
      });
    } catch (error) {
      console.error("Error toggling section:", error);
      setSections((prev) =>
        prev.map((s) => (s.id === id ? { ...s, isActive: !isActive } : s))
      );
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("Yakin ingin menghapus section ini?")) return;
    try {
      const res = await fetch(`/api/admin/homepage/${id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (data.success) {
        setSections((prev) => prev.filter((s) => s.id !== id));
      } else {
        alert(data.error || "Gagal menghapus section");
      }
    } catch (error) {
      console.error("Error deleting section:", error);
      alert("Gagal menghapus section");
    }
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = sections.findIndex((s) => s.id === active.id);
    const newIndex = sections.findIndex((s) => s.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const newSections = arrayMove(sections, oldIndex, newIndex);
    setSections(newSections);

    setReordering(true);
    try {
      await fetch("/api/admin/homepage/reorder", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: newSections.map((s, i) => ({
            id: s.id,
            displayOrder: i + 1,
          })),
        }),
      });
    } catch (error) {
      console.error("Error reordering sections:", error);
      fetchSections();
    } finally {
      setReordering(false);
    }
  };

  const handleAddType = (type: string) => {
    setShowAddDialog(false);
    router.push(`/admin/homepage/new?type=${type}`);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Homepage CMS</h2>
          <p className="text-sm text-muted-foreground">
            Kelola konten halaman depan toko
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <a href="/admin/homepage/preview" target="_blank">
              <Eye className="h-4 w-4" /> Preview
            </a>
          </Button>
          <Button onClick={() => setShowAddDialog(true)} className="gap-2">
            <Plus className="h-4 w-4" /> Tambah Section
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : sections.length === 0 ? (
        <div className="text-center py-20 border rounded-lg bg-muted/30">
          <p className="text-muted-foreground mb-4">
            Belum ada section. Tambahkan section pertama untuk homepage.
          </p>
          <Button onClick={() => setShowAddDialog(true)} className="gap-2">
            <Plus className="h-4 w-4" /> Tambah Section
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {reordering && (
            <div className="text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="h-3 w-3 animate-spin" /> Menyimpan urutan...
            </div>
          )}
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={sections.map((s) => s.id)}
              strategy={verticalListSortingStrategy}
            >
              {sections.map((section, index) => (
                <SortableSectionRow
                  key={section.id}
                  section={section}
                  index={index}
                  onToggleActive={handleToggleActive}
                  onDelete={handleDelete}
                />
              ))}
            </SortableContext>
          </DndContext>
        </div>
      )}

      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Tambah Section Baru</DialogTitle>
            <DialogDescription>
              Pilih tipe section yang ingin ditambahkan ke homepage
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            {Object.entries(TYPE_LABELS).map(([type, label]) => (
              <button
                key={type}
                onClick={() => handleAddType(type)}
                className="flex items-start gap-3 p-4 rounded-lg border bg-card hover:border-primary hover:bg-accent/50 transition-colors text-left"
              >
                <div className="flex-1">
                  <div className="font-semibold">{label}</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {TYPE_DESCRIPTIONS[type]}
                  </div>
                </div>
                <Plus className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SortableSectionRow({
  section,
  index,
  onToggleActive,
  onDelete,
}: {
  section: AdminSection;
  index: number;
  onToggleActive: (id: string, isActive: boolean) => void;
  onDelete: (id: string) => void;
}) {
  const router = useRouter();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: section.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-center gap-3 p-4 rounded-lg border bg-card shadow-sm",
        isDragging && "shadow-lg border-primary",
        !section.isActive && "opacity-60"
      )}
    >
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground"
        aria-label="Drag to reorder"
      >
        <GripVertical className="h-5 w-5" />
      </button>

      <div className="w-8 text-center text-sm text-muted-foreground font-mono">
        {index + 1}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <Badge variant="secondary">{TYPE_LABELS[section.type] ?? section.type}</Badge>
          {section.type === "carousel_product" && section.products && (
            <span className="text-xs text-muted-foreground">
              {section.products.length} produk
            </span>
          )}
        </div>
        <div className="font-medium truncate">
          {section.title || <span className="text-muted-foreground italic">Tanpa judul</span>}
        </div>
      </div>

      <Switch
        checked={section.isActive}
        onCheckedChange={(checked) => onToggleActive(section.id, checked)}
      />

      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        onClick={() => router.push(`/admin/homepage/${section.id}/edit`)}
      >
        <Edit className="h-4 w-4" />
      </Button>

      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-destructive hover:text-destructive"
        onClick={() => onDelete(section.id)}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}
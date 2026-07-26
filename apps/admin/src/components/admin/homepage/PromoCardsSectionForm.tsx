"use client";
import { useState, useRef } from "react";
import { Upload, Loader2, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type {
  PromoCardsContent,
  PromoCardItem,
  ProductFilterConfig,
} from "@marketplace/ui";
import { toStoreUrl } from "@/lib/store-url";
import ProductFilterEditor from "./ProductFilterEditor";

const MAX_CARDS = 6;

interface PromoCardsSectionFormProps {
  content: Record<string, unknown>;
  onChange: (content: unknown) => void;
}

export default function PromoCardsSectionForm({
  content,
  onChange,
}: PromoCardsSectionFormProps) {
  const promoContent = content as Partial<PromoCardsContent>;
  const cards: PromoCardItem[] = promoContent.cards ?? [];
  const [uploadingIndex, setUploadingIndex] = useState<number | null>(null);
  const fileInputRefs = useRef<Map<string, HTMLInputElement>>(new Map());

  const updateCards = (newCards: PromoCardItem[]) => {
    onChange({ cards: newCards });
  };

  const addCard = () => {
    if (cards.length >= MAX_CARDS) {
      toast.error(`Maksimal ${MAX_CARDS} kartu`);
      return;
    }
    updateCards([
      ...cards,
      { id: crypto.randomUUID(), imageUrl: "", title: "" },
    ]);
  };

  const updateCardField = <K extends keyof PromoCardItem>(
    id: string,
    field: K,
    value: PromoCardItem[K]
  ) => {
    updateCards(cards.map((c) => (c.id === id ? { ...c, [field]: value } : c)));
  };

  const updateCardFilter = (id: string, filter: ProductFilterConfig) => {
    updateCardField(id, "filter", filter);
  };

  const deleteOldImage = async (url: string) => {
    if (!url || !url.startsWith("/uploads/")) return;
    try {
      await fetch(`/api/admin/upload?url=${encodeURIComponent(url)}`, { method: "DELETE" });
    } catch (error) {
      console.error("Error deleting old file:", error);
    }
  };

  const removeCard = (id: string) => {
    const card = cards.find((c) => c.id === id);
    if (card?.imageUrl) {
      deleteOldImage(card.imageUrl);
    }
    updateCards(cards.filter((c) => c.id !== id));
    fileInputRefs.current.delete(id);
  };

  const handleClearImage = (id: string) => {
    const card = cards.find((c) => c.id === id);
    if (card?.imageUrl) {
      deleteOldImage(card.imageUrl);
    }
    updateCardField(id, "imageUrl", "");
  };

  const handleUpload = async (id: string, file: File) => {
    const index = cards.findIndex((c) => c.id === id);
    setUploadingIndex(index);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/admin/upload?folder=homepage", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (data.success) {
        const card = cards.find((c) => c.id === id);
        if (card?.imageUrl) {
          await deleteOldImage(card.imageUrl);
        }
        updateCardField(id, "imageUrl", data.url);
        toast.success("Gambar berhasil diunggah");
      } else {
        toast.error(data.error || "Gagal upload gambar");
      }
    } catch (error) {
      console.error("Error uploading:", error);
      toast.error("Gagal upload gambar");
    } finally {
      setUploadingIndex(null);
    }
  };

  const handleFileChange = (cardId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleUpload(cardId, file);
    e.target.value = "";
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Label>Kartu Promosi ({cards.length}/{MAX_CARDS})</Label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addCard}
          disabled={cards.length >= MAX_CARDS}
          className="gap-2"
        >
          <Plus className="h-4 w-4" /> Tambah Kartu
        </Button>
      </div>

      {cards.length === 0 ? (
        <div className="text-center py-8 border rounded-lg text-sm text-muted-foreground">
          Belum ada kartu. Klik &quot;Tambah Kartu&quot; untuk menambahkan.
        </div>
      ) : (
        <div className="space-y-4">
          {cards.map((card, index) => (
            <div key={card.id} className="border rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Kartu {index + 1}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-destructive"
                  onClick={() => removeCard(card.id)}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-[160px_1fr] gap-3">
                <div className="border rounded-md p-2 space-y-2">
                  {card.imageUrl ? (
                    <div className="relative">
                      <img
                        src={toStoreUrl(card.imageUrl)}
                        alt={card.title}
                        className="w-full h-24 object-cover rounded"
                      />
                      <button
                        type="button"
                        onClick={() => handleClearImage(card.id)}
                        className="absolute top-1 right-1 bg-black/60 text-white p-1 rounded"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ) : (
                    <div className="w-full h-24 bg-muted rounded flex items-center justify-center text-muted-foreground text-xs">
                      Belum ada gambar
                    </div>
                  )}
                  <input
                    ref={(el) => {
                      if (el) fileInputRefs.current.set(card.id, el);
                    }}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    className="hidden"
                    onChange={(e) => handleFileChange(card.id, e)}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-2 w-full"
                    disabled={uploadingIndex === index}
                    onClick={() => fileInputRefs.current.get(card.id)?.click()}
                  >
                    {uploadingIndex === index ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Upload className="h-4 w-4" />
                    )}
                    Upload
                  </Button>
                </div>

                <div className="space-y-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Judul</Label>
                    <input
                      className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={card.title}
                      onChange={(e) => updateCardField(card.id, "title", e.target.value)}
                      placeholder="New Arrivals"
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs">Filter Produk (saat kartu diklik)</Label>
                      {card.filter && Object.keys(card.filter).length > 0 && (
                        <button
                          type="button"
                          onClick={() => updateCardField(card.id, "filter", undefined)}
                          className="text-xs text-destructive hover:underline"
                        >
                          Reset filter
                        </button>
                      )}
                    </div>
                    <div className="border rounded-md p-3 bg-muted/20">
                      <ProductFilterEditor
                        value={card.filter ?? {}}
                        onChange={(f) => updateCardFilter(card.id, f)}
                        idPrefix={`card-${card.id}`}
                      />
                      <p className="text-xs text-muted-foreground mt-2">
                        Kartu tanpa filter tidak akan bisa diklik oleh customer.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
"use client";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import type { HomepageSection, CarouselConfig } from "@/types/homepage";

interface EditorProps {
  section: HomepageSection;
  onSave: (id: string, values: { title: string; config: Record<string, unknown> }) => void;
}

export default function CarouselEditor({ section, onSave }: EditorProps) {
  const config = ((section.config || {}) as unknown) as CarouselConfig;
  const [title, setTitle] = useState(section.title);
  const [source, setSource] = useState(config.source || "flash_sale");
  const [categoryId, setCategoryId] = useState(config.categoryId || "");
  const [productIds, setProductIds] = useState((config.productIds || []).join(","));
  const [maxItems, setMaxItems] = useState(config.maxItems || 8);
  const [autoplay, setAutoplay] = useState(config.autoplay !== false);

  const handleSave = () => {
    const payload: Record<string, unknown> = { source, maxItems, autoplay };
    if (source === "category") payload.categoryId = categoryId;
    if (source === "manual") payload.productIds = productIds.split(",").map((s) => s.trim()).filter(Boolean);
    onSave(section.id, { title, config: payload });
  };

  return (
    <div className="space-y-4">
      <div>
        <Label>Judul Section</Label>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div>
        <Label>Sumber Produk</Label>
        <select value={source} onChange={(e) => setSource(e.target.value as CarouselConfig["source"])} className="w-full border rounded-md px-3 py-2 text-sm mt-1">
          <option value="flash_sale">Flash Sale</option>
          <option value="best_seller">Best Seller</option>
          <option value="category">Kategori</option>
          <option value="manual">Manual (ID)</option>
        </select>
      </div>
      {source === "category" && (
        <div>
          <Label>Category ID</Label>
          <Input value={categoryId} onChange={(e) => setCategoryId(e.target.value)} />
        </div>
      )}
      {source === "manual" && (
        <div>
          <Label>Product IDs (comma separated)</Label>
          <Input value={productIds} onChange={(e) => setProductIds(e.target.value)} />
        </div>
      )}
      <div>
        <Label>Max Items</Label>
        <Input type="number" value={maxItems} onChange={(e) => setMaxItems(Number(e.target.value))} />
      </div>
      <div className="flex items-center gap-2">
        <Switch checked={autoplay} onCheckedChange={setAutoplay} />
        <Label>Autoplay scroll</Label>
      </div>
      <Button onClick={handleSave} className="w-full">Simpan</Button>
    </div>
  );
}

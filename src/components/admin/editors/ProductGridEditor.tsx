"use client";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { HomepageSection, ProductGridConfig } from "@/types/homepage";

interface EditorProps {
  section: HomepageSection;
  onSave: (id: string, values: { title: string; config: Record<string, unknown> }) => void;
}

export default function ProductGridEditor({ section, onSave }: EditorProps) {
  const config = ((section.config || {}) as unknown) as ProductGridConfig;
  const [title, setTitle] = useState(section.title);
  const [source, setSource] = useState(config.source || "best_seller");
  const [categoryId, setCategoryId] = useState(config.categoryId || "");
  const [productIds, setProductIds] = useState((config.productIds || []).join(","));
  const [columns, setColumns] = useState<number>(config.columns || 4);
  const [rows, setRows] = useState(config.rows || 2);
  const [showViewAll, setShowViewAll] = useState(config.showViewAll !== false);

  const handleSave = () => {
    const payload: Record<string, unknown> = { source, columns, rows, showViewAll };
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
        <select value={source} onChange={(e) => setSource(e.target.value as ProductGridConfig["source"])} className="w-full border rounded-md px-3 py-2 text-sm mt-1">
          <option value="best_seller">Best Seller</option>
          <option value="new_arrivals">New Arrivals</option>
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
        <Label>Kolom</Label>
        <RadioGroup value={String(columns)} onValueChange={(v) => setColumns(Number(v))} className="flex gap-4 mt-2">
          <div className="flex items-center gap-2">
            <RadioGroupItem value="3" id="g3" />
            <Label htmlFor="g3">3</Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="4" id="g4" />
            <Label htmlFor="g4">4</Label>
          </div>
        </RadioGroup>
      </div>
      <div>
        <Label>Rows</Label>
        <Input type="number" value={rows} onChange={(e) => setRows(Number(e.target.value))} />
      </div>
      <div className="flex items-center gap-2">
        <Switch checked={showViewAll} onCheckedChange={setShowViewAll} />
        <Label>Tampilkan &quot;Lihat Semua&quot;</Label>
      </div>
      <Button onClick={handleSave} className="w-full">Simpan</Button>
    </div>
  );
}

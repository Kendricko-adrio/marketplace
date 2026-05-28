"use client";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import type { HomepageSection, CountdownConfig } from "@/types/homepage";

interface EditorProps {
  section: HomepageSection;
  onSave: (id: string, values: { title: string; config: Record<string, unknown> }) => void;
}

export default function CountdownEditor({ section, onSave }: EditorProps) {
  const config = ((section.config || {}) as unknown) as CountdownConfig;
  const [title, setTitle] = useState(section.title);
  const [countdownTitle, setCountdownTitle] = useState(config.title || "");
  const [endDate, setEndDate] = useState(config.endDate ? new Date(config.endDate).toISOString().slice(0, 16) : "");
  const [source, setSource] = useState(config.source || "flash_sale");
  const [productIds, setProductIds] = useState((config.productIds || []).join(","));
  const [maxItems, setMaxItems] = useState(config.maxItems || 6);

  const handleSave = () => {
    const payload: Record<string, unknown> = { title: countdownTitle, endDate, source, maxItems };
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
        <Label>Judul Countdown</Label>
        <Input value={countdownTitle} onChange={(e) => setCountdownTitle(e.target.value)} />
      </div>
      <div>
        <Label>Tanggal Berakhir</Label>
        <Input type="datetime-local" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
      </div>
      <div>
        <Label>Sumber Produk</Label>
        <select value={source} onChange={(e) => setSource(e.target.value as "flash_sale" | "manual")} className="w-full border rounded-md px-3 py-2 text-sm mt-1">
          <option value="flash_sale">Flash Sale</option>
          <option value="manual">Manual (ID)</option>
        </select>
      </div>
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
      <Button onClick={handleSave} className="w-full">Simpan</Button>
    </div>
  );
}

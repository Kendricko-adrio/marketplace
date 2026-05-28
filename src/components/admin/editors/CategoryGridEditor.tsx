"use client";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { HomepageSection, CategoryGridConfig } from "@/types/homepage";

interface EditorProps {
  section: HomepageSection;
  onSave: (id: string, values: { title: string; config: Record<string, unknown> }) => void;
}

export default function CategoryGridEditor({ section, onSave }: EditorProps) {
  const config = ((section.config || {}) as unknown) as CategoryGridConfig;
  const [title, setTitle] = useState(section.title);
  const [categoryIds, setCategoryIds] = useState((config.categoryIds || []).join(","));
  const [columns, setColumns] = useState<number>(config.columns || 6);
  const [showIcon, setShowIcon] = useState(config.showIcon !== false);

  const handleSave = () => {
    onSave(section.id, {
      title,
      config: {
        categoryIds: categoryIds.split(",").map((s) => s.trim()).filter(Boolean),
        columns,
        showIcon,
      },
    });
  };

  return (
    <div className="space-y-4">
      <div>
        <Label>Judul Section</Label>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div>
        <Label>Category IDs (kosong = semua, pisah koma)</Label>
        <Input value={categoryIds} onChange={(e) => setCategoryIds(e.target.value)} />
      </div>
      <div>
        <Label>Kolom</Label>
        <RadioGroup value={String(columns)} onValueChange={(v) => setColumns(Number(v))} className="flex gap-4 mt-2">
          <div className="flex items-center gap-2">
            <RadioGroupItem value="4" id="c4" />
            <Label htmlFor="c4">4</Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="6" id="c6" />
            <Label htmlFor="c6">6</Label>
          </div>
        </RadioGroup>
      </div>
      <div className="flex items-center gap-2">
        <Switch checked={showIcon} onCheckedChange={setShowIcon} />
        <Label>Tampilkan Ikon</Label>
      </div>
      <Button onClick={handleSave} className="w-full">Simpan</Button>
    </div>
  );
}

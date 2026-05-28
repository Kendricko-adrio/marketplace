"use client";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import type { HomepageSection, BrandStripConfig } from "@/types/homepage";

interface EditorProps {
  section: HomepageSection;
  onSave: (id: string, values: { title: string; config: Record<string, unknown> }) => void;
}

export default function BrandStripEditor({ section, onSave }: EditorProps) {
  const config = ((section.config || {}) as unknown) as BrandStripConfig;
  const [title, setTitle] = useState(section.title);
  const [logos, setLogos] = useState(config.logos || []);
  const [autoplay, setAutoplay] = useState(config.autoplay !== false);

  const updateLogo = (i: number, field: string, value: string) => {
    const next = [...logos];
    next[i] = { ...next[i], [field]: value };
    setLogos(next);
  };

  const addLogo = () => setLogos([...logos, { image: "", name: "" }]);
  const removeLogo = (i: number) => setLogos(logos.filter((_, idx) => idx !== i));

  const handleSave = () => {
    onSave(section.id, { title, config: { logos, autoplay } });
  };

  return (
    <div className="space-y-4">
      <div>
        <Label>Judul Section</Label>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="space-y-3">
        {logos.map((logo, i) => (
          <div key={i} className="border p-3 rounded-md space-y-2">
            <div className="flex items-center justify-between">
              <Label>Logo {i + 1}</Label>
              <Button size="sm" variant="ghost" onClick={() => removeLogo(i)}>Hapus</Button>
            </div>
            <Input placeholder="URL Gambar" value={logo.image} onChange={(e) => updateLogo(i, "image", e.target.value)} />
            <Input placeholder="Nama Merek" value={logo.name} onChange={(e) => updateLogo(i, "name", e.target.value)} />
            <Input placeholder="Link (opsional)" value={logo.link || ""} onChange={(e) => updateLogo(i, "link", e.target.value)} />
          </div>
        ))}
        <Button variant="outline" onClick={addLogo} className="w-full">+ Tambah Logo</Button>
      </div>
      <div className="flex items-center gap-2">
        <Switch checked={autoplay} onCheckedChange={setAutoplay} />
        <Label>Autoplay scroll</Label>
      </div>
      <Button onClick={handleSave} className="w-full">Simpan</Button>
    </div>
  );
}

"use client";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { HomepageSection, ImageTextConfig } from "@/types/homepage";

interface EditorProps {
  section: HomepageSection;
  onSave: (id: string, values: { title: string; config: Record<string, unknown> }) => void;
}

export default function ImageTextEditor({ section, onSave }: EditorProps) {
  const config = ((section.config || {}) as unknown) as ImageTextConfig;
  const [title, setTitle] = useState(section.title);
  const [imageUrl, setImageUrl] = useState(config.imageUrl || "");
  const [imagePosition, setImagePosition] = useState<"left" | "right">(config.imagePosition || "left");
  const [blockTitle, setBlockTitle] = useState(config.title || "");
  const [description, setDescription] = useState(config.description || "");
  const [ctaText, setCtaText] = useState(config.ctaText || "");
  const [ctaLink, setCtaLink] = useState(config.ctaLink || "");
  const [bgColor, setBgColor] = useState(config.backgroundColor || "");

  const handleSave = () => {
    onSave(section.id, {
      title,
      config: { imageUrl, imagePosition, title: blockTitle, description, ctaText, ctaLink, backgroundColor: bgColor || undefined },
    });
  };

  return (
    <div className="space-y-4">
      <div>
        <Label>Judul Section</Label>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div>
        <Label>URL Gambar</Label>
        <Input value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} />
      </div>
      <div>
        <Label>Posisi Gambar</Label>
        <RadioGroup value={imagePosition} onValueChange={(v) => setImagePosition(v as "left" | "right")} className="flex gap-4 mt-2">
          <div className="flex items-center gap-2">
            <RadioGroupItem value="left" id="left" />
            <Label htmlFor="left">Kiri</Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="right" id="right" />
            <Label htmlFor="right">Kanan</Label>
          </div>
        </RadioGroup>
      </div>
      <div>
        <Label>Judul Blok</Label>
        <Input value={blockTitle} onChange={(e) => setBlockTitle(e.target.value)} />
      </div>
      <div>
        <Label>Deskripsi</Label>
        <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>CTA Text</Label>
          <Input value={ctaText} onChange={(e) => setCtaText(e.target.value)} />
        </div>
        <div>
          <Label>CTA Link</Label>
          <Input value={ctaLink} onChange={(e) => setCtaLink(e.target.value)} />
        </div>
      </div>
      <div>
        <Label>Background Color (hex, opsional)</Label>
        <Input value={bgColor} onChange={(e) => setBgColor(e.target.value)} placeholder="#f8f9fa" />
      </div>
      <Button onClick={handleSave} className="w-full">Simpan</Button>
    </div>
  );
}

"use client";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { HomepageSection, BannerConfig } from "@/types/homepage";

interface EditorProps {
  section: HomepageSection;
  onSave: (id: string, values: { title: string; config: Record<string, unknown> }) => void;
}

export default function BannerEditor({ section, onSave }: EditorProps) {
  const config = ((section.config || {}) as unknown) as BannerConfig;
  const [title, setTitle] = useState(section.title);
  const [template, setTemplate] = useState<"hero" | "split">(config.template || "hero");
  const [images, setImages] = useState(config.images || [{ url: "", link: "", alt: "" }]);
  const [ctaText, setCtaText] = useState(config.ctaText || "");
  const [ctaLink, setCtaLink] = useState(config.ctaLink || "");

  const handleSave = () => {
    onSave(section.id, {
      title,
      config: { template, images: images.slice(0, template === "hero" ? 1 : 2), ctaText, ctaLink },
    });
  };

  const updateImage = (i: number, field: string, value: string) => {
    const next = [...images];
    next[i] = { ...next[i], [field]: value };
    setImages(next);
  };

  return (
    <div className="space-y-4">
      <div>
        <Label>Judul Section</Label>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div>
        <Label>Template</Label>
        <RadioGroup value={template} onValueChange={(v) => setTemplate(v as "hero" | "split")} className="flex gap-4 mt-2">
          <div className="flex items-center gap-2">
            <RadioGroupItem value="hero" id="hero" />
            <Label htmlFor="hero">Hero</Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="split" id="split" />
            <Label htmlFor="split">Split (2 gambar)</Label>
          </div>
        </RadioGroup>
      </div>
      {(template === "hero" ? [0] : [0, 1]).map((i) => (
        <div key={i} className="space-y-2 border p-3 rounded-md">
          <Label>Gambar {i + 1}</Label>
          <Input placeholder="URL Gambar" value={images[i]?.url || ""} onChange={(e) => updateImage(i, "url", e.target.value)} />
          <Input placeholder="Link" value={images[i]?.link || ""} onChange={(e) => updateImage(i, "link", e.target.value)} />
          <Input placeholder="Alt Text" value={images[i]?.alt || ""} onChange={(e) => updateImage(i, "alt", e.target.value)} />
        </div>
      ))}
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
      <Button onClick={handleSave} className="w-full">Simpan</Button>
    </div>
  );
}

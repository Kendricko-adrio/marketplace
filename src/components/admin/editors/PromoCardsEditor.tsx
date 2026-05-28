"use client";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { HomepageSection, PromoCardsConfig } from "@/types/homepage";

interface EditorProps {
  section: HomepageSection;
  onSave: (id: string, values: { title: string; config: Record<string, unknown> }) => void;
}

export default function PromoCardsEditor({ section, onSave }: EditorProps) {
  const config = ((section.config || {}) as unknown) as PromoCardsConfig;
  const [title, setTitle] = useState(section.title);
  const [layout, setLayout] = useState<"single" | "double" | "triple">(config.layout || "double");
  const [cards, setCards] = useState(config.cards || []);

  const updateCard = (i: number, field: string, value: string) => {
    const next = [...cards];
    next[i] = { ...next[i], [field]: value };
    setCards(next);
  };

  const addCard = () => setCards([...cards, { image: "", title: "", description: "", link: "" }]);
  const removeCard = (i: number) => setCards(cards.filter((_, idx) => idx !== i));

  const handleSave = () => {
    onSave(section.id, { title, config: { layout, cards } });
  };

  return (
    <div className="space-y-4">
      <div>
        <Label>Judul Section</Label>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div>
        <Label>Layout</Label>
        <RadioGroup value={layout} onValueChange={(v) => setLayout(v as "single" | "double" | "triple")} className="flex gap-4 mt-2">
          {["single", "double", "triple"].map((l) => (
            <div key={l} className="flex items-center gap-2">
              <RadioGroupItem value={l} id={l} />
              <Label htmlFor={l}>{l}</Label>
            </div>
          ))}
        </RadioGroup>
      </div>
      <div className="space-y-3">
        {cards.map((card, i) => (
          <div key={i} className="border p-3 rounded-md space-y-2">
            <div className="flex items-center justify-between">
              <Label>Kartu {i + 1}</Label>
              <Button size="sm" variant="ghost" onClick={() => removeCard(i)}>Hapus</Button>
            </div>
            <Input placeholder="URL Gambar" value={card.image} onChange={(e) => updateCard(i, "image", e.target.value)} />
            <Input placeholder="Judul" value={card.title} onChange={(e) => updateCard(i, "title", e.target.value)} />
            <Input placeholder="Deskripsi" value={card.description} onChange={(e) => updateCard(i, "description", e.target.value)} />
            <Input placeholder="Link" value={card.link} onChange={(e) => updateCard(i, "link", e.target.value)} />
            <Input placeholder="Badge (opsional)" value={card.badge || ""} onChange={(e) => updateCard(i, "badge", e.target.value)} />
          </div>
        ))}
        <Button variant="outline" onClick={addCard} className="w-full">+ Tambah Kartu</Button>
      </div>
      <Button onClick={handleSave} className="w-full">Simpan</Button>
    </div>
  );
}

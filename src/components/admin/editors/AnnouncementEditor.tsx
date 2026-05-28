"use client";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import type { HomepageSection, AnnouncementConfig } from "@/types/homepage";

interface EditorProps {
  section: HomepageSection;
  onSave: (id: string, values: { title: string; config: Record<string, unknown> }) => void;
}

export default function AnnouncementEditor({ section, onSave }: EditorProps) {
  const config = ((section.config || {}) as unknown) as AnnouncementConfig;
  const [title, setTitle] = useState(section.title);
  const [text, setText] = useState(config.text || "");
  const [link, setLink] = useState(config.link || "");
  const [linkText, setLinkText] = useState(config.linkText || "");
  const [bgColor, setBgColor] = useState(config.backgroundColor || "");
  const [textColor, setTextColor] = useState(config.textColor || "");
  const [dismissible, setDismissible] = useState(config.dismissible || false);

  const handleSave = () => {
    onSave(section.id, {
      title,
      config: { text, link: link || undefined, linkText: linkText || undefined, backgroundColor: bgColor || undefined, textColor: textColor || undefined, dismissible },
    });
  };

  return (
    <div className="space-y-4">
      <div>
        <Label>Judul Section</Label>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div>
        <Label>Teks Pengumuman</Label>
        <Input value={text} onChange={(e) => setText(e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Link</Label>
          <Input value={link} onChange={(e) => setLink(e.target.value)} />
        </div>
        <div>
          <Label>Link Text</Label>
          <Input value={linkText} onChange={(e) => setLinkText(e.target.value)} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Background Color</Label>
          <Input value={bgColor} onChange={(e) => setBgColor(e.target.value)} placeholder="hsl(var(--primary))" />
        </div>
        <div>
          <Label>Text Color</Label>
          <Input value={textColor} onChange={(e) => setTextColor(e.target.value)} placeholder="#ffffff" />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Switch checked={dismissible} onCheckedChange={setDismissible} />
        <Label>Dapat ditutup pengguna</Label>
      </div>
      <Button onClick={handleSave} className="w-full">Simpan</Button>
    </div>
  );
}

"use client";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { HomepageSection, VideoEmbedConfig } from "@/types/homepage";

interface EditorProps {
  section: HomepageSection;
  onSave: (id: string, values: { title: string; config: Record<string, unknown> }) => void;
}

export default function VideoEmbedEditor({ section, onSave }: EditorProps) {
  const config = ((section.config || {}) as unknown) as VideoEmbedConfig;
  const [title, setTitle] = useState(section.title);
  const [videoUrl, setVideoUrl] = useState(config.videoUrl || "");
  const [platform, setPlatform] = useState<"youtube" | "vimeo">(config.platform || "youtube");
  const [aspectRatio, setAspectRatio] = useState<"16/9" | "4/3" | "1/1">(config.aspectRatio || "16/9");
  const [thumbnail, setThumbnail] = useState(config.thumbnail || "");
  const [autoplay, setAutoplay] = useState(config.autoplay || false);

  const handleSave = () => {
    onSave(section.id, { title, config: { videoUrl, platform, aspectRatio, thumbnail: thumbnail || undefined, autoplay } });
  };

  return (
    <div className="space-y-4">
      <div>
        <Label>Judul Section</Label>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div>
        <Label>Video URL</Label>
        <Input value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} placeholder="https://youtube.com/watch?v=..." />
      </div>
      <div>
        <Label>Platform</Label>
        <RadioGroup value={platform} onValueChange={(v) => setPlatform(v as "youtube" | "vimeo")} className="flex gap-4 mt-2">
          <div className="flex items-center gap-2">
            <RadioGroupItem value="youtube" id="yt" />
            <Label htmlFor="yt">YouTube</Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="vimeo" id="vimeo" />
            <Label htmlFor="vimeo">Vimeo</Label>
          </div>
        </RadioGroup>
      </div>
      <div>
        <Label>Aspect Ratio</Label>
        <RadioGroup value={aspectRatio} onValueChange={(v) => setAspectRatio(v as "16/9" | "4/3" | "1/1")} className="flex gap-4 mt-2">
          {["16/9", "4/3", "1/1"].map((r) => (
            <div key={r} className="flex items-center gap-2">
              <RadioGroupItem value={r} id={r} />
              <Label htmlFor={r}>{r}</Label>
            </div>
          ))}
        </RadioGroup>
      </div>
      <div>
        <Label>Thumbnail URL (opsional)</Label>
        <Input value={thumbnail} onChange={(e) => setThumbnail(e.target.value)} />
      </div>
      <div className="flex items-center gap-2">
        <Switch checked={autoplay} onCheckedChange={setAutoplay} />
        <Label>Autoplay</Label>
      </div>
      <Button onClick={handleSave} className="w-full">Simpan</Button>
    </div>
  );
}

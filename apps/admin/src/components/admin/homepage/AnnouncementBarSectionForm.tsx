"use client";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AnnouncementBarContent } from "@marketplace/ui";

interface AnnouncementBarSectionFormProps {
  content: Record<string, unknown>;
  onChange: (content: unknown) => void;
}

export default function AnnouncementBarSectionForm({
  content,
  onChange,
}: AnnouncementBarSectionFormProps) {
  const announcement = content as Partial<AnnouncementBarContent>;
  const message = announcement.message ?? "";
  const variant = announcement.variant ?? "info";

  const update = (field: keyof AnnouncementBarContent, value: string) => {
    onChange({ ...announcement, [field]: value });
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="message">Pesan Pengumuman</Label>
        <textarea
          id="message"
          className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          value={message}
          onChange={(e) => update("message", e.target.value)}
          placeholder="Gratis ongkir untuk pembelian di atas Rp 200.000!"
        />
      </div>

      <div className="space-y-2">
        <Label>Varian Warna</Label>
        <Select value={variant} onValueChange={(v) => update("variant", v)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="info">Info (Biru)</SelectItem>
            <SelectItem value="warning">Warning (Kuning)</SelectItem>
            <SelectItem value="success">Success (Hijau)</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
"use client";
import { useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import type { AnnouncementConfig } from "@/types/homepage";

interface AnnouncementSectionProps {
  config: AnnouncementConfig;
}

export default function AnnouncementSection({ config }: AnnouncementSectionProps) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  return (
    <div
      className="w-full px-4 py-2 text-sm flex items-center justify-center gap-2 relative"
      style={{
        backgroundColor: config.backgroundColor || "hsl(var(--primary))",
        color: config.textColor || "#ffffff",
      }}
    >
      <span>{config.text}</span>
      {config.link && (
        <Link href={config.link} className="underline font-medium">
          {config.linkText || "Lihat Selengkapnya"}
        </Link>
      )}
      {config.dismissible && (
        <button
          onClick={() => setDismissed(true)}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:opacity-80"
          aria-label="Tutup"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

"use client";

import { useState, useEffect } from "react";
import { X, Info, AlertTriangle, CheckCircle } from "lucide-react";
import type { HomepageSectionData, AnnouncementBarContent } from "./types";

interface AnnouncementBarSectionProps {
  section: HomepageSectionData;
  preview?: boolean;
}

const VARIANT_STYLES = {
  info: "bg-secondary text-secondary-foreground",
  warning: "bg-amber-500 text-white",
  success: "bg-emerald-600 text-white",
};

const VARIANT_ICONS = {
  info: Info,
  warning: AlertTriangle,
  success: CheckCircle,
};

export default function AnnouncementBarSection({
  section,
  preview,
}: AnnouncementBarSectionProps) {
  const content = (section.content ?? {}) as AnnouncementBarContent;
  const variant = content.variant ?? "info";
  const Icon = VARIANT_ICONS[variant];
  const storageKey = `homepage:announcement:dismissed:${section.id}`;

  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (preview) return;
    if (typeof window === "undefined") return;
    const stored = localStorage.getItem(storageKey);
    if (stored === "1") setDismissed(true);
  }, [storageKey, preview]);

  if (dismissed) return null;

  const handleClose = () => {
    if (!preview && typeof window !== "undefined") {
      localStorage.setItem(storageKey, "1");
    }
    setDismissed(true);
  };

  return (
    <div
      className={`relative w-full ${VARIANT_STYLES[variant]} text-sm py-2.5`}
    >
      <div className="container mx-auto px-4 flex items-center justify-center gap-2 pr-10">
        <Icon className="h-4 w-4 shrink-0" />
        <span className="text-center">{content.message}</span>
      </div>
      <button
        onClick={handleClose}
        className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-md hover:bg-black/10 transition-colors"
        aria-label="Tutup pengumuman"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
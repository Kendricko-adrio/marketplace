import * as React from "react";

import { cn } from "../../lib/utils";
import { getStatusToneClassName } from "../../lib/status-styles";
import type { StatusTone } from "../../lib/status-presentation";
import { Badge } from "./badge";

/**
 * Pill status pasif dengan tone semantik eksplisit.
 *
 * Bukan kontrol interaktif: tidak menerima `variant`, `onClick`, `role`, atau
 * `tabIndex`, tidak berubah hue saat hover, dan tidak mengumumkan diri ke
 * screen reader sebagai live region. Caller hanya boleh menambah kelas layout
 * (mis. posisi absolut atau `gap-1`); hue tetap berasal dari treatment shared.
 *
 * Label tidak dipotong dengan ellipsis: teks boleh wrap di dalam container
 * berlebar terbatas agar status panjang tetap terbaca utuh.
 */
export interface StatusBadgeProps {
  tone: StatusTone;
  children: React.ReactNode;
  className?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
  "data-testid"?: string;
}

export function StatusBadge({
  tone,
  children,
  className,
  ...aria
}: StatusBadgeProps) {
  return (
    <Badge
      variant="outline"
      data-status-tone={tone}
      className={cn(
        "max-w-full whitespace-normal break-words text-center",
        getStatusToneClassName(tone),
        className
      )}
      {...aria}
    >
      {children}
    </Badge>
  );
}

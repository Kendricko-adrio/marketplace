"use client"

import { Toaster as Sonner, type ToasterProps } from "sonner"
import { cn } from "../../lib/utils"

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      className={cn("toaster group")}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
        } as React.CSSProperties
      }
      richColors
      closeButton
      {...props}
    />
  )
}

export { Toaster }
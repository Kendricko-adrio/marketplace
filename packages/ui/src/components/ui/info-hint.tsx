"use client"

import * as React from "react"
import { Info } from "lucide-react"

import { cn } from "../../lib/utils"
import { Popover, PopoverContent, PopoverTrigger } from "./popover"

export interface InfoHintProps {
  /** Nama aksesibel untuk tombol info (tidak terlihat, dibaca pembaca layar). */
  label: string
  /** Penjelasan sekunder; bukan satu-satunya tempat informasi wajib/biaya/status. */
  children: React.ReactNode
  side?: "top" | "right" | "bottom" | "left"
  align?: "start" | "center" | "end"
  className?: string
}

/**
 * Tombol info 24×24 dengan popover penjelasan sekunder.
 *
 * Terbuka lewat hover (mouse), click/tap, dan keyboard (Enter/Space pada
 * tombol native). Escape menutup popover dan mengembalikan fokus ke trigger
 * (perilaku FocusScope Radix Popover). Hover hanya jalan pintas: informasi
 * yang dibutuhkan hampir semua pengguna tetap harus terlihat tanpa hover.
 */
export function InfoHint({
  label,
  children,
  side = "top",
  align = "center",
  className,
}: InfoHintProps) {
  const [open, setOpen] = React.useState(false)
  const openedByHover = React.useRef(false)
  const closeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const cancelClose = React.useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }, [])

  // Penundaan kecil supaya pointer bisa menyeberangi jarak trigger → konten
  // (konten di-portal) tanpa popover langsung tertutup.
  const scheduleClose = React.useCallback(() => {
    cancelClose()
    closeTimer.current = setTimeout(() => {
      closeTimer.current = null
      setOpen(false)
    }, 120)
  }, [cancelClose])

  React.useEffect(() => cancelClose, [cancelClose])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          title={label}
          data-testid="info-hint-trigger"
          onMouseEnter={() => {
            openedByHover.current = true
            cancelClose()
            setOpen(true)
          }}
          onMouseLeave={() => {
            openedByHover.current = false
            scheduleClose()
          }}
          // Mouse: hover sudah membuka, jadi click tidak boleh menutup lagi
          // (default trigger Radix men-toggle). Touch/tap dan keyboard tidak
          // melewati hover dan tetap memakai toggle normal.
          onClick={(event) => {
            if (openedByHover.current) {
              event.preventDefault()
              cancelClose()
              setOpen(true)
            }
          }}
          className={cn(
            "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            className
          )}
        >
          <Info className="h-4 w-4" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side={side}
        align={align}
        sideOffset={6}
        onMouseEnter={cancelClose}
        onMouseLeave={scheduleClose}
        className="w-64 text-xs leading-relaxed"
      >
        {children}
      </PopoverContent>
    </Popover>
  )
}

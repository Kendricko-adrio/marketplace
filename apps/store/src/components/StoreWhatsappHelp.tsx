"use client";

import { usePathname } from "next/navigation";
import { FloatingWhatsappButton } from "@marketplace/ui";

/**
 * Bantuan WhatsApp yang sadar route.
 *
 * Preflight hit-test (320 CSS px, dev render `playwright/mcp/checkout-phase2/`):
 * tombol mengambang 56×56 menutup 34% tombol utama “Lanjut” pada /checkout dan
 * 92% tombol hint “Tentang cabang pickup”. Karena itu, pada surface checkout
 * dan detail pesanan **di bawah breakpoint desktop `lg`**, bantuan tampil
 * sebagai link biasa sebelum footer dan tombol mengambang disembunyikan.
 * Desktop dan route lain tetap memakai tombol mengambang yang sama.
 *
 * Komponen ini hanya menyusun dua presentasi dari satu URL existing: tidak
 * mengambil config, tidak fetch data bisnis, dan tidak merender dua link bantuan
 * aktif pada viewport yang sama (satu `lg:hidden`, satu `hidden lg:block`).
 */
const ORDER_DETAIL_PATH = /^\/account\/orders\/[^/]+\/?$/;

export function StoreWhatsappHelp({ href }: { href: string }) {
  const pathname = usePathname() ?? "";
  const inlineOnMobile =
    pathname === "/checkout" || ORDER_DETAIL_PATH.test(pathname);

  return (
    <>
      {inlineOnMobile && (
        <div className="container mx-auto px-4 pb-6 lg:hidden">
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center gap-2 rounded-md border border-input bg-field px-4 text-sm font-medium text-foreground transition-colors hover:border-primary/40 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            Butuh bantuan? Hubungi WhatsApp
          </a>
        </div>
      )}
      <div className={inlineOnMobile ? "hidden lg:block" : undefined}>
        <FloatingWhatsappButton href={href} />
      </div>
    </>
  );
}

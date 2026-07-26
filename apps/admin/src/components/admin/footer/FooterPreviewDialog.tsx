"use client";

import { Eye } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Footer, type FooterConfigData } from "@marketplace/ui";

interface FooterPreviewDialogProps {
  config: FooterConfigData;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function FooterPreviewDialog({
  config,
  open,
  onOpenChange,
}: FooterPreviewDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-7xl w-[95vw] h-[85vh] p-0 gap-0 flex flex-col overflow-hidden"
      >
        <DialogHeader className="px-6 py-4 border-b shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Eye className="h-5 w-5" />
            Preview Footer
          </DialogTitle>
          <DialogDescription>
            Tampilan footer pada lebar penuh, mirip layar storefront aktual.
            Link tidak berfungsi di sini — ini hanya pratinjau visual.
          </DialogDescription>
        </DialogHeader>

        {/* Scrollable body: mock storefront page with footer pinned at bottom */}
        <div className="flex-1 overflow-y-auto bg-background">
          {/* Mock storefront top nav */}
          <div className="border-b bg-white">
            <div className="container mx-auto flex items-center justify-between px-4 h-16">
              <span className="text-lg font-bold text-primary">
                {config.brandName || "StoreFront"}
              </span>
              <div className="hidden sm:flex items-center gap-6 text-sm text-muted-foreground">
                <span>Beranda</span>
                <span>Produk</span>
                <span>Cabang</span>
                <span className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5">
                  Keranjang
                </span>
              </div>
            </div>
          </div>

          {/* Mock page content placeholder */}
          <div className="container mx-auto px-4 py-10 min-h-[300px]">
            <div className="h-8 w-48 rounded-md bg-muted/60 mb-4" />
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div
                  key={i}
                  className="rounded-lg border bg-muted/30 overflow-hidden"
                >
                  <div className="aspect-square bg-muted/60" />
                  <div className="p-3 space-y-2">
                    <div className="h-3 w-full rounded bg-muted/60" />
                    <div className="h-3 w-1/2 rounded bg-muted/40" />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Actual footer at natural full width */}
          <Footer config={config} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
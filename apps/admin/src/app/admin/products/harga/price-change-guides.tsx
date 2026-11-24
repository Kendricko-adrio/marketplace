"use client";

import { useState } from "react";
import { HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/**
 * Tombol panduan on-demand untuk aturan kerja harga coret,
 * menggantikan blok teks panjang di bawah tabel utama.
 */
export function PriceRulesGuideButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="gap-1.5"
      >
        <HelpCircle className="h-4 w-4" aria-hidden="true" />
        Panduan
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Cara kerja harga coret</DialogTitle>
            <DialogDescription>
              Ringkasan aturan harga coret SKU di ADFSport.
            </DialogDescription>
          </DialogHeader>
          <ul className="list-disc space-y-2 pl-5 text-sm text-muted-foreground">
            <li>
              <strong className="font-medium text-foreground">Mengikuti harga dasar Jubelio:</strong>{" "}
              target harga coret berlaku untuk semua cabang tanpa tanggal akhir.
            </li>
            <li>
              <strong className="font-medium text-foreground">Target nonaktif otomatis:</strong>{" "}
              jika harga dasar turun sama dengan atau di bawah target, harga coret nonaktif sementara dan otomatis aktif lagi bila harga dasar naik di atas target.
            </li>
            <li>
              <strong className="font-medium text-foreground">Penerapan per baris:</strong>{" "}
              setiap baris yang valid langsung aktif saat diterapkan tanpa mengubah harga dasar Jubelio.
            </li>
          </ul>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Tutup
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * Dialog panduan format file Excel (`markdown_v2`) berbentuk tabel contoh ringkas.
 */
export function PriceFormatGuideDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] w-[95vw] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Panduan format Excel</DialogTitle>
          <DialogDescription>
            Sheet <span className="font-mono text-foreground">Harga</span> · versi{" "}
            <span className="font-mono text-foreground">markdown_v2</span> (file versi lama tetap didukung).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="overflow-x-auto rounded-md border">
            <Table aria-label="Contoh pengisian kolom Excel">
              <TableHeader>
                <TableRow>
                  <TableHead>action</TableHead>
                  <TableHead>input_type</TableHead>
                  <TableHead>new_price</TableHead>
                  <TableHead>Contoh (Harga dasar Rp 200.000)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="text-xs">
                <TableRow>
                  <TableCell className="font-mono font-medium">set_price</TableCell>
                  <TableCell className="font-mono">price</TableCell>
                  <TableCell>Nominal Rupiah (&gt; 0)</TableCell>
                  <TableCell>
                    <span className="font-mono">150000</span> → Rp 150.000
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-mono font-medium">set_price</TableCell>
                  <TableCell className="font-mono">percent</TableCell>
                  <TableCell>Angka diskon (10 = 10%)</TableCell>
                  <TableCell>
                    <span className="font-mono">10</span> → Rp 180.000
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-mono font-medium">restore_base</TableCell>
                  <TableCell className="text-muted-foreground">(kosong)</TableCell>
                  <TableCell className="text-muted-foreground">(kosong)</TableCell>
                  <TableCell>Kembali ke Rp 200.000</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>

          <ul className="list-disc space-y-1.5 pl-5 text-xs text-muted-foreground">
            <li>
              <strong className="font-medium text-foreground">Ganti atau hapus baris contoh:</strong>{" "}
              template berisi 2 baris contoh yang harus diganti dengan SKU produk atau dihapus sebelum unggah.
            </li>
            <li>
              <strong className="font-medium text-foreground">Kolom sku harus Text:</strong>{" "}
              jangan mengubah urutan kolom (<span className="font-mono">sku, action, new_price, input_type</span>).
            </li>
            <li>
              <strong className="font-medium text-foreground">Tanpa formula &amp; format persen Excel:</strong>{" "}
              isi diskon sebagai angka biasa (mis. <span className="font-mono">10</span> untuk 10%, bukan sel berformat Percentage atau formula).
            </li>
            <li>
              <strong className="font-medium text-foreground">Perbaikan baris gagal:</strong>{" "}
              unduh file baris gagal, perbaiki nilainya tanpa menghapus kolom referensi <span className="font-mono">origin_row</span>, lalu unggah kembali.
            </li>
          </ul>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Tutup
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

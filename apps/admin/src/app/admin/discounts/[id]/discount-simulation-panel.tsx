"use client";

import { Loader2, PlayCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export interface SimulationResult {
  simulation: true;
  offerId: string;
  draftRevisionId: string;
  draftVersion: number;
  applied: boolean;
  eligible: boolean;
  minSubtotal: string;
  breakdown: {
    subtotal: string;
    goodsDiscount: string;
    netGoods: string;
    shippingBeforeSubsidy: string;
    shippingSubsidy: string;
    shippingNet: string;
    ppnRatePercent: string;
    ppnAmount: string;
    total: string;
    lines: {
      variantId: string;
      quantity: number;
      sourceUnitPrice: string;
      goodsDiscountAmount: string;
      netLineAmount: string;
    }[];
  };
  notice: string;
}

export interface SimulationForm {
  variantId: string;
  unitPrice: string;
  quantity: string;
  fulfillment: "pickup" | "delivery";
  shipping: string;
}

function rupiah(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  return `Rp ${BigInt(value).toLocaleString("id-ID")}`;
}

/**
 * Tab **Simulasi**. Memakai versi draft tersimpan yang eksplisit; bila
 * konfigurasi masih dirty, aksi yang tersedia adalah **Simpan draft dan
 * simulasikan** (bukan save khusus tab). Input keranjang bukan konfigurasi
 * promo dan tidak ikut tersimpan.
 */
export function DiscountSimulationPanel(props: {
  form: SimulationForm;
  onFormChange: (patch: Partial<SimulationForm>) => void;
  result: SimulationResult | null;
  stale: boolean;
  dirty: boolean;
  busy: boolean;
  disabled: boolean;
  error: string | null;
  onRun: () => void;
}) {
  const { form, onFormChange, result, stale, dirty, busy, disabled, error } = props;
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Simulasi</h2>
        </CardTitle>
        <CardDescription>
          Menghitung contoh dari draft tersimpan. Bukan quote, bukan pesanan, dan
          tidak menahan stok atau kuota.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <div className="space-y-2">
            <Label htmlFor="sim-variant">Variant ID</Label>
            <Input
              id="sim-variant"
              value={form.variantId}
              disabled={disabled}
              onChange={(event) => onFormChange({ variantId: event.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sim-price">Harga satuan (Rp)</Label>
            <Input
              id="sim-price"
              inputMode="numeric"
              value={form.unitPrice}
              disabled={disabled}
              onChange={(event) => onFormChange({ unitPrice: event.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sim-qty">Jumlah</Label>
            <Input
              id="sim-qty"
              inputMode="numeric"
              value={form.quantity}
              disabled={disabled}
              onChange={(event) => onFormChange({ quantity: event.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sim-fulfillment">Pengiriman</Label>
            <Select
              value={form.fulfillment}
              disabled={disabled}
              onValueChange={(value) =>
                onFormChange({ fulfillment: value as "pickup" | "delivery" })
              }
            >
              <SelectTrigger id="sim-fulfillment">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pickup">Ambil di toko</SelectItem>
                <SelectItem value="delivery">Kirim</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="sim-shipping">Ongkir (Rp)</Label>
            <Input
              id="sim-shipping"
              inputMode="numeric"
              value={form.shipping}
              disabled={disabled || form.fulfillment === "pickup"}
              onChange={(event) => onFormChange({ shipping: event.target.value })}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Button onClick={props.onRun} disabled={disabled || busy} variant="outline">
            {busy ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <PlayCircle className="mr-2 h-4 w-4" />
            )}
            {dirty ? "Simpan draft dan simulasikan" : "Jalankan simulasi"}
          </Button>
          {dirty ? (
            <p className="text-xs text-muted-foreground">
              Konfigurasi disimpan sebagai draft lebih dulu supaya simulasi memakai
              versi yang tersimpan.
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>

        {!result ? (
          <p className="text-sm text-muted-foreground">
            Jalankan simulasi untuk melihat potongan dan total bayar.
          </p>
        ) : (
          <div className="space-y-4">
            {stale ? (
              <p className="rounded-md border border-amber-500/60 p-3 text-sm">
                Konfigurasi berubah setelah simulasi ini dijalankan. Jalankan lagi
                untuk hasil terkini.
              </p>
            ) : null}
            <div className="rounded-md border p-4 text-sm">
              <p className="font-medium">
                {result.applied
                  ? "Potongan diterapkan"
                  : "Potongan tidak diterapkan (minimum belum terpenuhi atau nilai potongan 0)"}
              </p>
              <dl className="mt-3 grid gap-2 sm:grid-cols-2">
                {[
                  ["Subtotal", rupiah(result.breakdown.subtotal)],
                  ["Diskon barang", rupiah(result.breakdown.goodsDiscount)],
                  ["Subtotal setelah diskon", rupiah(result.breakdown.netGoods)],
                  ["Ongkir sebelum subsidi", rupiah(result.breakdown.shippingBeforeSubsidy)],
                  ["Subsidi ongkir", rupiah(result.breakdown.shippingSubsidy)],
                  ["PPN " + result.breakdown.ppnRatePercent + "%", rupiah(result.breakdown.ppnAmount)],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
                <div className="flex justify-between gap-3 sm:col-span-2">
                  <dt className="font-medium">Total bayar</dt>
                  <dd className="font-semibold">{rupiah(result.breakdown.total)}</dd>
                </div>
              </dl>
              <p className="mt-3 text-xs text-muted-foreground">{result.notice}</p>
            </div>
            <div className="max-w-full overflow-x-auto rounded-md border">
              <Table aria-label="Rincian simulasi">
                <TableHeader>
                  <TableRow>
                    <TableHead>Varian</TableHead>
                    <TableHead>Jumlah</TableHead>
                    <TableHead>Harga satuan</TableHead>
                    <TableHead>Potongan</TableHead>
                    <TableHead>Total baris</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.breakdown.lines.map((line) => (
                    <TableRow key={line.variantId}>
                      <TableCell className="font-mono text-xs">{line.variantId}</TableCell>
                      <TableCell>{line.quantity}</TableCell>
                      <TableCell>{rupiah(line.sourceUnitPrice)}</TableCell>
                      <TableCell>{rupiah(line.goodsDiscountAmount)}</TableCell>
                      <TableCell>{rupiah(line.netLineAmount)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Tag } from "lucide-react";
import type { AvailableOfferDto } from "@/lib/discount-availability";

export type AvailableOffer = AvailableOfferDto;
export interface PromoInvalidation { offerId: string; message: string }
interface PromoSelectorProps {
  active: { name: string; benefitAmount: string } | null;
  invalidated: PromoInvalidation | null;
  disabled: boolean;
  onOpen: () => void;
  onClear: () => void;
  onContinueWithout: () => void;
}

export function PromoSelector({ active, invalidated, disabled, onOpen, onClear, onContinueWithout }: PromoSelectorProps) {
  return <section aria-label="Promo" className="mb-6 rounded-lg border p-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 items-start gap-2">
        <Tag className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">Promo</h3>
          {active && !invalidated ? <>
            <div className="mt-1 flex flex-wrap items-center gap-2 break-words text-sm font-medium"><span>{active.name}</span> <Badge variant="secondary">Dipakai</Badge></div>
            <p className="mt-1 text-xs text-muted-foreground">Potongan Rp {BigInt(active.benefitAmount).toLocaleString("id-ID")}</p>
          </> : <p className="mt-1 text-xs text-muted-foreground">Pilih promo atau masukkan kode</p>}
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        {active && !invalidated && <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={onClear}>Lepas promo</Button>}
        <Button id="promo-picker-trigger" type="button" variant="outline" size="sm" disabled={disabled} onClick={onOpen}>
          {invalidated ? "Pilih promo lain" : active ? "Ubah promo" : "Pilih promo"}
        </Button>
      </div>
    </div>
    {invalidated && <div role="alert" className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
      <p className="flex items-center gap-2 font-medium"><AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />Promo sebelumnya tidak lagi berlaku</p>
      <p className="mt-1 text-muted-foreground">{invalidated.message}</p>
      <Button type="button" variant="outline" size="sm" className="mt-2" disabled={disabled} onClick={onContinueWithout}>Lanjut tanpa promo</Button>
    </div>}
  </section>;
}

"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import type { PromoCandidateResult, PromoDraft, PromoPageResult } from "@/features/discounts/promo-picker-contract";

interface PromoSelectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contextKey: string;
  active: PromoDraft;
  activeName: string;
  data: PromoPageResult | null;
  loading: boolean;
  error: string | null;
  onPageChange: (page: number) => void;
  onCheckCode: (code: string) => Promise<PromoCandidateResult>;
  onUsePromo: (draft: PromoDraft) => Promise<PromoCandidateResult>;
  onConfirmIncrease: () => void;
  onCancelIncrease: () => void;
  onRetry: () => void;
}
const money = (value: string) => BigInt(value).toLocaleString("id-ID");
function same(a: PromoDraft, b: PromoDraft): boolean {
  return a.kind === b.kind && (a.kind === "none" ||
    (a.kind === "public" && b.kind === "public" && a.offerId === b.offerId) ||
    (a.kind === "manual" && b.kind === "manual" && a.code === b.code));
}

export function PromoSelectionDialog(props: PromoSelectionDialogProps) {
  const { data, loading, error } = props;
  const [draft, setDraft] = useState<PromoDraft>(props.active);
  const [name, setName] = useState(props.activeName);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [codeValid, setCodeValid] = useState(false);
  const [checkedBenefit, setCheckedBenefit] = useState<string | null>(null);
  const [pending, setPending] = useState<"check" | "apply" | null>(null);
  const [increase, setIncrease] = useState<Extract<PromoCandidateResult, { kind: "increase_confirmation" }> | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const session = useRef(0);
  const [draftContext, setDraftContext] = useState(props.contextKey);
  if (draftContext !== props.contextKey) {
    setDraftContext(props.contextKey);
    setDraft({ kind: "none" }); setName(""); setCodeValid(false); setIncrease(null); setPending(null);
    setMessage("Pesanan berubah. Pilih promo kembali.");
  }
  useLayoutEffect(() => { session.current++; }, [props.contextKey]);
  useEffect(() => () => { session.current++; }, []);
  useEffect(() => { if (listRef.current) listRef.current.scrollTop = 0; }, [data?.page]);
  function close(open: boolean) { if (!open) session.current++; props.onOpenChange(open); }
  async function checkCode() {
    const id = ++session.current;
    setPending("check"); setMessage(null);
    const result = await props.onCheckCode(code);
    if (id !== session.current) return;
    setPending(null);
    if (result.kind === "ready") {
      setDraft({ kind: "manual", code: code.trim().toUpperCase() }); setName(result.name); setCodeValid(true); setCheckedBenefit(result.benefitAmount);
    } else if (result.kind === "error" || result.kind === "context_changed") setMessage(result.message);
  }
  async function apply() {
    const id = ++session.current;
    setPending("apply"); setMessage(null);
    const result = await props.onUsePromo(draft);
    if (id !== session.current) return;
    setPending(null);
    if (result.kind === "ready") close(false);
    else if (result.kind === "increase_confirmation") setIncrease(result);
    else setMessage(result.message);
  }
  return (
    <Dialog open={props.open} onOpenChange={close}>
      <DialogContent className="flex max-h-[90dvh] w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl"
        onCloseAutoFocus={event => { event.preventDefault(); document.getElementById("promo-picker-trigger")?.focus(); }}>
        <DialogHeader className="shrink-0 border-b p-4 pr-10 text-left sm:p-6">
          <DialogTitle>{increase ? "Total pesanan naik" : "Pilih promo"}</DialogTitle>
          <DialogDescription>{increase
            ? "Mengganti promo membuat total final lebih tinggi. Pilihan promo kamu yang sekarang tetap berlaku sampai kamu mengonfirmasi."
            : "Gunakan satu promo untuk pesanan ini."}</DialogDescription>
        </DialogHeader>
        {increase ? <>
          <dl className="space-y-3 overflow-y-auto p-4 text-sm sm:p-6">
            <div className="flex justify-between gap-3"><dt>Total sekarang</dt><dd>Rp {money(increase.previousTotal)}</dd></div>
            <div className="flex justify-between gap-3"><dt>Total setelah ganti</dt><dd>Rp {money(increase.candidateTotal)}</dd></div>
            <div className="flex justify-between gap-3 font-semibold"><dt>Selisih</dt><dd className="text-destructive">+ Rp {money(increase.deltaTotal)}</dd></div>
          </dl>
          <div className="flex shrink-0 justify-end gap-2 border-t p-4">
            <Button variant="outline" onClick={() => { props.onCancelIncrease(); setIncrease(null); }}>Batal</Button>
            <Button onClick={props.onConfirmIncrease}>Ya, ganti promo</Button>
          </div>
        </> : <>
          <div className="max-h-[30dvh] shrink-0 space-y-2 overflow-y-auto border-b p-4 sm:px-6">
            <Label htmlFor="manual-promo-code">Kode promo</Label>
            <form className="flex gap-2" onSubmit={event => { event.preventDefault(); if (!pending && code.trim().length >= 3) void checkCode(); }}>
              <Input id="manual-promo-code" value={code} autoComplete="off" spellCheck={false} maxLength={64}
                placeholder="Masukkan kode promo" className="min-w-0 font-mono uppercase"
                disabled={pending !== null}
                onChange={event => {
                  setCode(event.target.value); setCodeValid(false); setMessage(null);
                  if (draft.kind === "manual") { setDraft({ kind: "none" }); setName(""); }
                }} />
              <Button type="submit" variant="outline" disabled={pending !== null || code.trim().length < 3}>
                {pending === "check" ? "Memeriksa…" : "Periksa"}
              </Button>
            </form>
            {message && <p role="alert" className="text-sm text-destructive">{message}</p>}
            {codeValid && <div className="space-y-1">
              <p role="status" className="text-xs text-muted-foreground">Kode promo valid. Pilih Gunakan promo untuk menerapkan.</p>
              {checkedBenefit && <p className="text-sm font-medium">{name} · Potongan Rp {money(checkedBenefit)}</p>}
            </div>}
          </div>
          <div className="shrink-0 px-4 pb-2 pt-3 sm:px-6">
            <h3 className="text-sm font-semibold">Promo tersedia</h3>
            <p className="text-xs text-muted-foreground">Diurutkan dari total bayar terendah</p>
          </div>
          <div ref={listRef} role="region" aria-label="Daftar promo" tabIndex={0}
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4 pt-1 sm:px-6" aria-busy={loading}>
            {loading ? <p role="status" className="flex items-center gap-2 py-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Memuat promo…</p>
              : error ? <div role="alert" className="space-y-2 py-4"><p className="text-sm">{error}</p><Button variant="outline" onClick={props.onRetry}>Coba lagi</Button></div>
              : !data?.items.length ? <p className="py-4 text-sm text-muted-foreground">Belum ada promo yang tersedia untuk pesanan ini.</p>
              : <fieldset className="space-y-2" disabled={pending !== null}>
                <legend className="sr-only">Pilih satu promo</legend>
                {data.items.map(offer => {
                  const selected = draft.kind === "public" && draft.offerId === offer.offerId;
                  const benefit = offer.benefitKind === "percentage_goods"
                    ? `Diskon ${offer.rate}%${offer.capAmount ? ` (maks Rp ${money(offer.capAmount)})` : ""}`
                    : `${offer.benefitKind === "shipping" ? "Subsidi ongkir" : "Potongan"} Rp ${money(offer.benefitAmount)}`;
                  return <label key={offer.offerId} className={`flex items-start gap-3 rounded-lg border p-3 ${selected ? "border-primary bg-primary/5" : "border-input"} ${offer.eligible ? "cursor-pointer hover:bg-muted/50" : "cursor-not-allowed"}`}>
                    <input type="radio" name="promo-draft" value={offer.offerId} checked={selected} disabled={!offer.eligible}
                      className="mt-1 h-4 w-4 shrink-0 accent-primary" onChange={() => { setDraft({ kind: "public", offerId: offer.offerId }); setName(offer.name); setCodeValid(false); }} />
                    <div className="min-w-0 flex-1 space-y-1 text-sm">
                      <div className="flex flex-wrap items-center gap-2"><span className="break-words font-medium">{offer.name}</span>{offer.recommended && <Badge>Paling hemat</Badge>}{selected && <Badge variant="outline">Dipilih</Badge>}</div>
                      <span className="block text-xs text-muted-foreground">{benefit}</span>
                      {offer.estimatedSavings && <span className="block text-xs font-medium">Hemat total Rp {money(offer.estimatedSavings)}</span>}
                      {BigInt(offer.minSubtotal) > BigInt(0) && <span className="block text-xs text-muted-foreground">Min. belanja Rp {money(offer.minSubtotal)}</span>}
                      {offer.endsAt && <span className="block text-xs text-muted-foreground">Berlaku sampai {new Date(offer.endsAt).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Jakarta" })}</span>}
                      {!offer.eligible && <span className="block text-xs text-muted-foreground">{offer.reasonMessage}</span>}
                    </div>
                  </label>;
                })}
              </fieldset>}
          </div>
          <div className="shrink-0 space-y-3 border-t bg-background p-4 sm:px-6">
            {data && data.totalItems > 0 && <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span role="status">{(data.page - 1) * 10 + 1}–{Math.min(data.page * 10, data.totalItems)} dari {data.totalItems} promo</span>
              {data.totalPages > 1 && <nav aria-label="Pagination promo" className="flex items-center gap-1">
                <Button variant="outline" size="icon" aria-label="Halaman promo sebelumnya" disabled={loading || pending !== null || data.page <= 1} onClick={() => props.onPageChange(data.page - 1)}><ChevronLeft className="h-4 w-4" /></Button>
                <span className="px-2 tabular-nums">{data.page} / {data.totalPages}</span>
                <Button variant="outline" size="icon" aria-label="Halaman promo berikutnya" disabled={loading || pending !== null || data.page >= data.totalPages} onClick={() => props.onPageChange(data.page + 1)}><ChevronRight className="h-4 w-4" /></Button>
              </nav>}
            </div>}
            <p role="status" className="truncate text-sm font-medium">{draft.kind === "none" ? "Belum ada promo dipilih" : `Pilihan: ${name}`}</p>
            <div className="flex items-center justify-between gap-3">
              <Button variant="outline" onClick={() => close(false)}>Batal</Button>
              <Button disabled={pending !== null || draft.kind === "none" || same(draft, props.active)} onClick={() => void apply()}>
                {pending === "apply" ? "Menerapkan…" : "Gunakan promo"}
              </Button>
            </div>
            {draft.kind === "none" && <p className="text-xs text-muted-foreground">Pilih promo terlebih dahulu</p>}
          </div>
        </>}
      </DialogContent>
    </Dialog>
  );
}

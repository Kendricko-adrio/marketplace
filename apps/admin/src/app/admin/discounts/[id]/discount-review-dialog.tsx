"use client";

import type { RefObject } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export interface ReviewResult {
  offerId: string;
  offerVersion: number;
  draftVersion: number;
  policyVersion: number;
  liveRevisionId: string | null;
  draftRevisionId: string;
  stateAfter: string;
  validations: { code: string; ok: boolean; message: string }[];
  canPublish: boolean;
  fingerprint: string;
  diff: {
    terms: { field: string; live: unknown; draft: unknown }[];
    benefit: { live: unknown; draft: unknown };
    capacity: { live: unknown; draft: unknown };
  };
  simulation: false;
  notice: string;
}
const FIELD_LABEL: Record<string, string> = { name: "Nama promo", currency: "Mata uang", minSubtotal: "Minimum barang setelah harga coret", startAt: "Mulai (WIB)", endAt: "Berakhir (WIB)" };
function display(value: unknown, field?: string): string {
  if (value === null || value === undefined || value === "") return "—";
  if ((field === "startAt" || field === "endAt") && typeof value === "string") {
    return `${new Date(value).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "medium", timeStyle: "short" })} WIB`;
  }
  if (typeof value !== "object") return String(value);
  const record = value as Record<string, unknown>;
  const money = (amount: unknown) => `Rp ${BigInt(String(amount)).toLocaleString("id-ID")}`;
  if (record.kind === "fixed_goods") return `Nominal barang ${money(record.fixedAmount)}`;
  if (record.kind === "percentage_goods") return `${Number(record.rate)}% barang${record.capAmount == null ? "" : `, maks ${money(record.capAmount)}`}`;
  if (record.kind === "shipping") return `Subsidi ongkir, maks ${money(record.capAmount)}`;
  return JSON.stringify(value);
}

export function DiscountReviewDialog(props: {
  open: boolean;
  busy: string | null;
  error: string | null;
  needsReload: boolean;
  review: ReviewResult | null;
  liveRevisionNo: number | null;
  draftRevisionNo: number | null;
  capacityNotice: string;
  triggerRef: RefObject<HTMLButtonElement | null>;
  onOpenChange: (open: boolean) => void;
  onPublish: () => void;
  onReload: () => void;
}) {
  const { review, busy } = props;
  const publishing = busy === "publish";
  return <Dialog open={props.open} onOpenChange={(open) => { if (!publishing) props.onOpenChange(open); }}>
    <DialogContent className="max-h-[90dvh] w-[calc(100%-2rem)] max-w-3xl overflow-y-auto"
      onCloseAutoFocus={(event) => { event.preventDefault(); props.triggerRef.current?.focus(); }}
      onEscapeKeyDown={(event) => { if (publishing) event.preventDefault(); }}
      onInteractOutside={(event) => { if (publishing) event.preventDefault(); }}>
      <DialogHeader>
        <DialogTitle>Review perubahan promo</DialogTitle>
        <DialogDescription>Live {props.liveRevisionNo === null ? "belum dipublish" : `Revision ${props.liveRevisionNo}`} → Draft Revision {props.draftRevisionNo ?? "—"}. Perubahan berlaku untuk pemakaian baru; hold dan snapshot order lama tidak berubah.</DialogDescription>
      </DialogHeader>
      {props.error ? <p role="alert" className="rounded-md border border-destructive/40 p-3 text-sm text-destructive">{props.error}</p> : null}
      {busy === "review" ? <p role="status" className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Memuat review…</p> : null}
      {review ? <div className="min-w-0 space-y-4 text-sm">
        <div className="max-w-full overflow-x-auto">
          <Table aria-label="Perubahan promo"><TableHeader><TableRow><TableHead>Field</TableHead><TableHead>Live</TableHead><TableHead>Draft</TableHead></TableRow></TableHeader>
            <TableBody>{[...review.diff.terms, { field: "benefit", ...review.diff.benefit }].map((entry) => <TableRow key={entry.field}>
              <TableCell>{FIELD_LABEL[entry.field] ?? (entry.field === "benefit" ? "Benefit" : entry.field)}</TableCell>
              <TableCell>{display(entry.live, entry.field)}</TableCell><TableCell>{display(entry.draft, entry.field)}</TableCell>
            </TableRow>)}</TableBody>
          </Table>
        </div>
        <p className="rounded-md border p-3">{props.capacityNotice} Kapasitas disimpan langsung pada promo, bukan menunggu publish. Syarat customer: akun store dengan email terverifikasi.</p>
        <ul className="space-y-2">{review.validations.map((validation) => <li key={validation.code} className={validation.ok ? "text-muted-foreground" : "text-destructive"}>
          {validation.ok ? "✓" : "Tidak valid:"} {validation.message}
        </li>)}</ul>
        <p>Review {review.canPublish ? "siap publish" : "belum siap publish"} · {review.notice}</p>
      </div> : null}
      <DialogFooter className="gap-2">
        <Button variant="outline" disabled={publishing} onClick={() => props.onOpenChange(false)}>Batal</Button>
        {props.needsReload ? <Button onClick={props.onReload} disabled={busy !== null}>Muat versi terbaru</Button>
          : review ? <Button onClick={props.onPublish} disabled={busy !== null || !review.canPublish}>{publishing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Publish promo</Button> : null}
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}

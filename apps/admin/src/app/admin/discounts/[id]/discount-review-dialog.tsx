"use client";

import type { RefObject } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface ReviewChange {
  path: string;
  before: unknown;
  after: unknown;
}

export interface ReviewResult {
  offerId: string;
  offerVersion: number;
  draftVersion: number;
  policyVersion: number;
  fingerprint: string;
  stateAfter: string;
  changes: ReviewChange[];
  issues: { path: string; message: string }[];
  warnings: string[];
}

const PATH_LABEL: Record<string, string> = {
  name: "Nama diskon",
  minSubtotal: "Minimum belanja",
  startAt: "Mulai",
  endAt: "Berakhir",
  benefit: "Potongan",
  capacity: "Batas penggunaan",
  codeChanges: "Kode promo",
};

function formatInstant(value: unknown): string {
  if (typeof value !== "string" || !value) return "—";
  return `${new Date(value).toLocaleString("id-ID", {
    timeZone: "Asia/Jakarta",
    dateStyle: "medium",
    timeStyle: "short",
  })} WIB`;
}

function formatMoney(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  return `Rp ${BigInt(value).toLocaleString("id-ID")}`;
}

function describeBenefit(value: unknown): string {
  if (!value || typeof value !== "object") return "—";
  const benefit = value as Record<string, unknown>;
  if (benefit.kind === "fixed_goods") {
    return `Nominal tetap ${formatMoney(benefit.fixedAmount) ?? "—"}`;
  }
  if (benefit.kind === "percentage_goods") {
    return `${String(benefit.rate ?? "—")}% barang${
      benefit.capAmount === null || benefit.capAmount === undefined
        ? ""
        : `, maks ${formatMoney(benefit.capAmount)}`
    }`;
  }
  if (benefit.kind === "shipping") {
    return `Subsidi ongkir maks ${formatMoney(benefit.capAmount) ?? "—"}`;
  }
  return "—";
}

function describeValue(path: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (path === "benefit") return describeBenefit(value);
  if (path === "startAt" || path === "endAt") return formatInstant(value);
  if (path === "minSubtotal") return formatMoney(value) ?? "—";
  if (path === "capacity") {
    const capacity = value as Record<string, unknown>;
    const quota = capacity.quotaCount === null || capacity.quotaCount === undefined
      ? "kuota tanpa batas"
      : `kuota ${capacity.quotaCount}`;
    const budget = formatMoney(capacity.budgetAmount) ?? "budget tanpa batas";
    const perClient = capacity.perClientLimit === null || capacity.perClientLimit === undefined
      ? "tanpa batas per customer"
      : `${capacity.perClientLimit} per customer`;
    return `${quota} · ${budget} · ${perClient}`;
  }
  if (path === "codeChanges") {
    const codes = value as { proposedCodes?: string[]; states?: { state: string }[] };
    const proposed = codes.proposedCodes?.length ?? 0;
    const changed = codes.states?.length ?? 0;
    if (proposed === 0 && changed === 0) return "Tanpa perubahan kode";
    return `${proposed} kode baru · ${changed} perubahan status kode`;
  }
  return String(value);
}

/**
 * Dialog **Periksa sebelum publish**: ringkasan manusiawi, bukan JSON,
 * fingerprint, atau engine/policy version. Aksi final tidak dieksekusi bila
 * review gagal; alasannya terlihat di dialog.
 */
export function DiscountReviewDialog(props: {
  open: boolean;
  busy: string | null;
  review: ReviewResult | null;
  error: string | null;
  needsReload: boolean;
  firstPublish: boolean;
  stateAfter: string;
  triggerRef: RefObject<HTMLButtonElement | null>;
  onOpenChange: (open: boolean) => void;
  onPublish: () => void;
  onReload: () => void;
}) {
  const { review, busy } = props;
  const publishing = busy === "publish";
  const blocked = !review || review.issues.length > 0 || props.needsReload;

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!publishing) props.onOpenChange(open);
      }}
    >
      <DialogContent
        className="max-h-[90dvh] w-[calc(100%-2rem)] max-w-2xl overflow-y-auto"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          props.triggerRef.current?.focus();
        }}
        onEscapeKeyDown={(event) => {
          if (publishing) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (publishing) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>Periksa sebelum publish</DialogTitle>
          <DialogDescription>
            Perubahan berlaku setelah publish. Pesanan yang sudah dibuat tidak
            berubah.
          </DialogDescription>
        </DialogHeader>

        {props.error ? (
          <p role="alert" className="rounded-md border border-destructive/40 p-3 text-sm text-destructive">
            {props.error}
          </p>
        ) : null}
        {busy === "review" ? (
          <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Menyiapkan review…
          </p>
        ) : null}

        {review ? (
          <div className="min-w-0 space-y-4 text-sm">
            {review.issues.length > 0 ? (
              <div className="rounded-md border border-destructive/40 p-3">
                <p className="font-medium text-destructive">Periksa bagian yang ditandai</p>
                <ul className="mt-2 space-y-1">
                  {review.issues.map((issue) => (
                    <li key={`${issue.path}-${issue.message}`}>• {issue.message}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {props.firstPublish ? (
              <dl className="space-y-2">
                {review.changes.map((change) => (
                  <div key={change.path} className="flex flex-wrap justify-between gap-2 border-b pb-2 last:border-b-0">
                    <dt className="text-muted-foreground">{PATH_LABEL[change.path] ?? change.path}</dt>
                    <dd className="text-right">{describeValue(change.path, change.after)}</dd>
                  </div>
                ))}
              </dl>
            ) : review.changes.length === 0 ? (
              <p className="text-muted-foreground">
                Tidak ada perubahan konfigurasi dibanding yang berlaku sekarang.
              </p>
            ) : (
              <div className="space-y-3">
                {review.changes.map((change) => (
                  <div key={change.path} className="rounded-md border p-3">
                    <p className="font-medium">{PATH_LABEL[change.path] ?? change.path}</p>
                    <p className="mt-1 text-muted-foreground">
                      Saat ini: {describeValue(change.path, change.before)}
                    </p>
                    <p>Setelah publish: {describeValue(change.path, change.after)}</p>
                  </div>
                ))}
              </div>
            )}

            <ul className="space-y-1">
              <li>Untuk customer dengan email terverifikasi.</li>
              <li>
                {review.stateAfter === "paused"
                  ? "Diskon tetap dijeda setelah publish."
                  : review.stateAfter === "enabled" && props.stateAfter === "enabled"
                    ? "Diskon aktif setelah publish."
                    : `Status setelah publish: ${review.stateAfter}.`}
              </li>
              {review.warnings.map((warning) => (
                <li key={warning} className="text-amber-700 dark:text-amber-400">
                  {warning}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <DialogFooter className="gap-2">
          <Button variant="outline" disabled={publishing} onClick={() => props.onOpenChange(false)}>
            Kembali mengedit
          </Button>
          {props.needsReload ? (
            <Button onClick={props.onReload} disabled={busy !== null}>
              Muat versi terbaru
            </Button>
          ) : (
            <Button onClick={props.onPublish} disabled={publishing || blocked}>
              {publishing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Publish diskon
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

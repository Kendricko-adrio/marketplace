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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  haltMessage,
  impactLabel,
  rowStatus,
  rupiah,
  statusMessage,
  type Batch,
  type BatchRow,
  type Candidate,
} from "./price-change-shared";

export type PriceDialogKind =
  | "manual"
  | "bulk"
  | "restore"
  | "review"
  | "history";
export type PriceForm = { target: string; percent: string; reason: string };
export type PriceHistory = {
  sku: string;
  currentVersion: number | null;
  revisions: {
    id: string;
    revisionNo: number;
    action: string;
    sourceUnitPrice: string;
    targetUnitPrice: string | null;
    effectiveUnitPrice: string;
    createdAt: string;
  }[];
};

type Props = {
  kind: PriceDialogKind | null;
  targets: Candidate[];
  skipped: number;
  form: PriceForm;
  onForm: (form: PriceForm) => void;
  batch: Batch | null;
  rows: BatchRow[];
  rowsReady: boolean;
  applied: boolean;
  history: PriceHistory | null;
  busy: boolean;
  error: string | null;
  canEdit: boolean;
  focusReturn: RefObject<HTMLElement | null>;
  onClose: () => void;
  onStage: () => void;
  onApply: () => void;
  onReload: () => void;
};

export function PriceChangeDialog(props: Props) {
  const {
    kind,
    targets,
    skipped,
    form,
    onForm,
    batch,
    rows,
    rowsReady,
    applied,
    history,
    busy,
    error,
    canEdit,
    focusReturn,
    onClose,
    onStage,
    onApply,
    onReload,
  } = props;
  const isForm = kind === "manual" || kind === "bulk" || kind === "restore";
  const title =
    kind === "manual"
      ? "Ubah harga coret manual"
      : kind === "bulk"
        ? "Ubah massal harga coret"
        : kind === "restore"
          ? "Restore harga coret"
          : kind === "history"
            ? "Histori harga"
            : "Review & hasil perubahan harga";
  const accepted = rows.filter(
    (row) =>
      row.preview.warnings.every((warning) => warning === "MARKDOWN_ABSENT") &&
      row.state !== "failed",
  ).length;
  const status = batch ? statusMessage(batch) : null;
  const halt = batch ? haltMessage(batch.haltReason) : null;
  return (
    <Dialog
      open={kind !== null}
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        className="max-h-[90dvh] w-[95vw] max-w-5xl overflow-y-auto"
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (busy) event.preventDefault();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          focusReturn.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {kind === "history"
              ? `${history?.sku ?? targets[0]?.sku ?? "SKU"} · histori immutable`
              : isForm
                ? `${targets.length} SKU · berlaku untuk seluruh cabang`
                : "Periksa perubahan sebelum diterapkan. Apply menggunakan base dan Markdown terbaru; target fixed tidak dihitung ulang."}
          </DialogDescription>
        </DialogHeader>
        {error && (
          <div
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
          >
            {error}
            {kind === "review" && (
              <Button
                variant="outline"
                size="sm"
                className="ml-2"
                disabled={busy}
                onClick={onReload}
              >
                Muat ulang hasil
              </Button>
            )}
          </div>
        )}
        {isForm && (
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              onStage();
            }}
          >
            <div className="max-h-56 overflow-auto rounded-md border">
              <Table aria-label="SKU yang akan diubah">
                <TableHeader>
                  <TableRow>
                    <TableHead>SKU</TableHead>
                    <TableHead>Base Jubelio</TableHead>
                    <TableHead>Website kini</TableHead>
                    <TableHead>Target tersimpan</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {targets.map((row) => (
                    <TableRow key={row.variantId}>
                      <TableCell className="font-mono text-xs">
                        {row.sku}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {rupiah(row.basePrice)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {rupiah(row.effectiveUnitPrice)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {rupiah(row.storedTarget)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {kind === "restore" ? (
              <div className="rounded-md border bg-muted/40 p-3 text-sm">
                <p>
                  Markdown terbaru akan dilepas. Harga website kembali mengikuti
                  base terbaru.
                </p>
                {skipped > 0 && (
                  <p>
                    {skipped} SKU tanpa target dilewati; {targets.length} SKU
                    disertakan.
                  </p>
                )}
              </div>
            ) : (
              <div className="max-w-md space-y-2">
                <Label htmlFor={kind === "bulk" ? "percent" : "target"}>
                  {kind === "bulk"
                    ? "Diskon (%) dari base"
                    : "Target harga website (Rp)"}
                </Label>
                <Input
                  id={kind === "bulk" ? "percent" : "target"}
                  inputMode={kind === "bulk" ? "decimal" : "numeric"}
                  value={kind === "bulk" ? form.percent : form.target}
                  disabled={busy}
                  onChange={(event) =>
                    onForm({
                      ...form,
                      [kind === "bulk" ? "percent" : "target"]:
                        event.target.value.replace(
                          kind === "bulk" ? /[^0-9.]/g : /[^0-9]/g,
                          "",
                        ),
                    })
                  }
                  placeholder={kind === "bulk" ? "20" : "150000"}
                />
                <p className="text-xs text-muted-foreground">
                  {kind === "bulk"
                    ? "Persentase dihitung dari Base Price, lalu dibekukan menjadi target harga tetap oleh server."
                    : "Harga akhir tetap harus lebih dari 0 dan di bawah base terbaru. Kenaikan dari harga website kini ditampilkan pada review."}
                </p>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="price-reason">Alasan bisnis (opsional)</Label>
              <Input
                id="price-reason"
                maxLength={500}
                value={form.reason}
                disabled={busy}
                onChange={(event) =>
                  onForm({ ...form, reason: event.target.value })
                }
                placeholder="Contoh: clearance stok lama"
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                disabled={busy}
              >
                Batal
              </Button>
              <Button
                type="submit"
                data-testid="bulk-stage"
                disabled={busy || !canEdit}
              >
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}Lihat
                review
              </Button>
            </DialogFooter>
          </form>
        )}
        {kind === "review" && batch && (
          <div className="space-y-4">
            {!rowsReady && !error && (
              <div role="status" className="text-sm text-muted-foreground">
                Review belum lengkap.{" "}
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={onReload}
                >
                  Lengkapi review
                </Button>
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p
                data-testid="bulk-review-counts"
                className="text-sm font-medium"
              >
                {batch.rowCount} baris · {accepted} diterima ·{" "}
                {rows.length - accepted} error
              </p>
              <span className="text-xs text-muted-foreground">
                Batch {batch.id.slice(0, 8)}
              </span>
            </div>
            <div className="max-h-[45dvh] overflow-auto rounded-md border">
              <Table
                data-testid="bulk-review-table"
                aria-label="Review perubahan harga"
              >
                <TableHeader>
                  <TableRow>
                    <TableHead>SKU / variant</TableHead>
                    <TableHead>Base</TableHead>
                    <TableHead>Website kini</TableHead>
                    <TableHead>Target</TableHead>
                    <TableHead>Dampak</TableHead>
                    <TableHead>Status / alasan</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="font-mono text-xs">
                        {row.inputSku}
                        <span className="block text-muted-foreground">
                          {row.preview.variantLabel}
                        </span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {rupiah(row.preview.sourceUnitPrice)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {rupiah(row.preview.effectiveUnitPriceBefore)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {row.action === "restore_base"
                          ? "Lepas Markdown"
                          : rupiah(row.targetUnitPrice)}
                      </TableCell>
                      <TableCell
                        className={`whitespace-nowrap font-medium ${row.preview.direction === "increase" ? "text-amber-700" : ""}`}
                      >
                        {impactLabel(row.preview)}
                      </TableCell>
                      <TableCell className="min-w-36 text-xs">
                        {rowStatus(row)}
                        {applied && (
                          <span className="mt-1 block">
                            Harga aktual:{" "}
                            {rupiah(row.actual.effectiveUnitPrice)}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {!applied && (
              <p className="text-sm text-muted-foreground">
                Stage/review belum mengubah harga. Baris sukses langsung live
                saat apply, bukan satu transaksi atomik penuh.
              </p>
            )}
            {applied && (
              <div
                data-testid="bulk-status"
                role="status"
                className={`rounded-md border p-3 text-sm ${halt || status?.tone === "error" ? "border-destructive/40 text-destructive" : "bg-muted/40"}`}
              >
                <p>{status?.text}</p>
                {halt && <p>{halt}</p>}
                <p className="mt-1 text-xs">
                  {batch.appliedCount} diterapkan · {batch.unchangedCount} tidak
                  berubah · {batch.failedCount} gagal · {batch.pendingCount}{" "}
                  belum selesai
                </p>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={onClose} disabled={busy}>
                Tutup
              </Button>
              {batch.pendingCount > 0 && (
                <Button
                  data-testid={applied ? "bulk-resume" : "bulk-apply"}
                  onClick={onApply}
                  disabled={busy || !canEdit || !rowsReady}
                >
                  {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                  {applied
                    ? `Lanjutkan apply (sisa ${batch.pendingCount})`
                    : `Terapkan ${batch.rowCount} SKU`}
                </Button>
              )}
            </DialogFooter>
          </div>
        )}
        {kind === "history" && (
          <div className="space-y-4">
            {busy ? (
              <p className="text-sm text-muted-foreground">Memuat histori…</p>
            ) : (
              history && (
                <>
                  <p className="text-sm text-muted-foreground">
                    Versi saat ini: {history.currentVersion ?? "—"}
                  </p>
                  <Table aria-label="Histori harga SKU">
                    <TableHeader>
                      <TableRow>
                        <TableHead>#</TableHead>
                        <TableHead>Aksi</TableHead>
                        <TableHead>Source</TableHead>
                        <TableHead>Target</TableHead>
                        <TableHead>Efektif</TableHead>
                        <TableHead>Waktu</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {history.revisions.map((row) => (
                        <TableRow key={row.id}>
                          <TableCell>{row.revisionNo}</TableCell>
                          <TableCell>
                            {row.action === "set_price" ? "Set" : "Restore"}
                          </TableCell>
                          <TableCell className="whitespace-nowrap">
                            {rupiah(row.sourceUnitPrice)}
                          </TableCell>
                          <TableCell className="whitespace-nowrap">
                            {rupiah(row.targetUnitPrice)}
                          </TableCell>
                          <TableCell className="whitespace-nowrap">
                            {rupiah(row.effectiveUnitPrice)}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-xs">
                            {new Date(row.createdAt).toLocaleString("id-ID")}
                          </TableCell>
                        </TableRow>
                      ))}
                      {history.revisions.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={6}>Belum ada revision.</TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </>
              )
            )}
            <DialogFooter>
              <Button variant="outline" onClick={onClose} disabled={busy}>
                Tutup
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useRef, useState, type FormEvent } from "react";
import { Download, FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { useAuth } from "@/providers/auth-provider";
import {
  haltMessage,
  loadBatchRows,
  reviewDigest,
  rupiah,
  statusMessage,
  type Batch,
  type BatchRow,
} from "./price-change-shared";

// =========================================================
// Excel harga — template → upload (staging) → review → apply → report/retry
// =========================================================
// Upload ALWAYS stages: the workbook is parsed/bounded on the server, fatal
// files are rejected before any price write, and bad rows are recorded as final
// failed rows so this panel can show the exact row/status/reason. Apply reuses
// the ticket-04 bounded pipeline (one chunk per click, honest pending counts).
// The failed subset is the linked-retry input: uploading it (after corrections)
// with its `origin_row` references creates a NEW batch linked to the parent's
// final failed rows, so the 97 successful rows are never replayed.

const MAX_VISIBLE_ROWS = 200;

function actionLabel(action: BatchRow["action"]): string {
  if (action === "set_price") return "Set harga";
  if (action === "restore_base") return "Restore base";
  return "Tidak valid";
}

function rowReason(row: BatchRow): string {
  const code = row.resultCode ?? row.preview.errorReason;
  if (code === "EXAMPLE_ROW_NOT_REPLACED") return "Ganti SKU contoh dengan SKU produk atau hapus baris contoh, lalu unggah kembali.";
  if (code === "INPUT_TYPE_INVALID") return "Gunakan input_type price atau percent untuk set_price.";
  if (code === "PERCENT_INVALID") return "Isi diskon persen yang menghasilkan harga lebih dari Rp0 dan di bawah harga source.";
  if (code === "INPUT_TYPE_NOT_ALLOWED" || code === "PRICE_NOT_ALLOWED") return "Kosongkan new_price dan input_type untuk restore_base.";
  return code ?? "—";
}

function inputLabel(row: BatchRow): string {
  const raw = row.preview.inputValueRaw ?? row.preview.inputTargetRaw;
  if (row.action === "restore_base" && !raw && !row.preview.inputTypeRaw) return "—";
  if (row.preview.inputType === "percent") return `${raw ?? "—"}% dari source`;
  if ((row.preview.inputType === "price" || row.preview.inputType === undefined) && raw && /^\d+$/.test(raw)) return rupiah(raw);
  return raw ?? (row.targetUnitPrice !== null ? rupiah(row.targetUnitPrice) : "—");
}

function targetLabel(row: BatchRow): string {
  if (row.targetUnitPrice !== null) return rupiah(row.targetUnitPrice);
  if (row.action === "restore_base") return "—";
  return row.preview.inputTargetRaw ?? "—";
}

export function PriceChangeExcelClient({ onBatchChange, onApplied }: { onBatchChange?: (batch: Batch) => void; onApplied?: () => void }) {
  const { hasPermission } = useAuth();
  const canEdit = hasPermission("prices", "edit");

  const [reason, setReason] = useState("");
  const [batch, setBatch] = useState<Batch | null>(null);
  const [rows, setRows] = useState<BatchRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [fatal, setFatal] = useState<{ reason: string; message: string } | null>(
    null
  );
  const [fileName, setFileName] = useState<string | null>(null);
  const applyKeyRef = useRef<string | null>(null);

  const replaceBatch = async (next: Batch) => {
    setBatch(next);
    onBatchChange?.(next);
    const allRows = await loadBatchRows(next.id);
    setRows(allRows);
    onBatchChange?.({ ...next, rows: allRows });
  };

  const upload = async (file: File, parentBatchId?: string) => {
    setBusy(true);
    setFatal(null);
    try {
      const form = new FormData();
      form.set("workbook", file);
      form.set("requestKey", crypto.randomUUID());
      if (reason.trim() !== "") form.set("reason", reason.trim());
      if (parentBatchId) form.set("parentBatchId", parentBatchId);
      const response = await fetch("/api/admin/price-changes", {
        method: "POST",
        body: form,
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) {
        if (payload?.code === "WORKBOOK_REJECTED") {
          setFatal({
            reason: payload.details?.reason ?? "WORKBOOK_REJECTED",
            message: payload.error ?? "Workbook ditolak",
          });
          toast.error(
            `Workbook ditolak (${payload.details?.reason ?? "WORKBOOK_REJECTED"}). Tidak ada harga yang berubah.`
          );
        } else {
          throw new Error(payload?.error ?? "Gagal mengunggah workbook");
        }
        return;
      }
      applyKeyRef.current = null;
      const staged = payload.data as Batch;
      await replaceBatch(staged);
      if (parentBatchId) {
        toast.success(
          `Koreksi ${staged.rowCount} baris di-stage (${staged.failedCount} tetap error), tertaut ke baris gagal batch asal.`
        );
      } else {
        toast.success(
          `Review ${staged.rowCount} baris: ${staged.pendingCount} siap diterapkan, ${staged.failedCount} perlu diperbaiki.`
        );
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Gagal mengunggah workbook"
      );
    } finally {
      setBusy(false);
    }
  };

  const submitUpload = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const input = event.currentTarget.elements.namedItem("workbook") as
      | HTMLInputElement
      | null;
    const file = input?.files?.[0];
    if (!file) {
      toast.error("Pilih berkas .xlsx terlebih dahulu.");
      return;
    }
    setFileName(file.name);
    event.currentTarget.reset();
    void upload(file);
  };

  const submitCorrection = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!batch) return;
    const input = event.currentTarget.elements.namedItem("correction") as
      | HTMLInputElement
      | null;
    const file = input?.files?.[0];
    if (!file) {
      toast.error("Pilih berkas koreksi .xlsx terlebih dahulu.");
      return;
    }
    event.currentTarget.reset();
    void upload(file, batch.id);
  };

  const applyOnce = async () => {
    if (!batch) return;
    setBusy(true);
    try {
      const requestKey = applyKeyRef.current ?? crypto.randomUUID();
      applyKeyRef.current = requestKey;
      const digest = await reviewDigest(rows);
      const response = await fetch(
        `/api/admin/price-changes/${batch.id}/apply`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            requestKey,
            ...(digest === null ? {} : { previewDigest: digest }),
          }),
        }
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) {
        throw new Error(payload?.error ?? "Gagal apply harga");
      }
      applyKeyRef.current = null;
      const applied = payload.data as Batch;
      onApplied?.();
      await replaceBatch(applied);
      const halted = haltMessage(applied.haltReason);
      if (halted !== null) toast.error(halted);
      else if (applied.pendingCount > 0)
        toast.info(`Belum final: ${applied.pendingCount} baris masih pending.`);
      else if (applied.failedCount > 0)
        toast.error(`${applied.failedCount} baris gagal.`);
      else if (applied.appliedCount === 0) toast.info("Tidak ada perubahan harga.");
      else toast.success(`${applied.appliedCount} baris diterapkan.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal apply harga");
    } finally {
      setBusy(false);
    }
  };

  const status = batch === null ? null : statusMessage(batch);
  const halted = batch === null ? null : haltMessage(batch.haltReason);
  const visibleRows = rows.slice(0, MAX_VISIBLE_ROWS);

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileSpreadsheet className="h-5 w-5 shrink-0" /><h2>Import harga Excel</h2>
        </CardTitle>
        <CardDescription>Siapkan file, unggah untuk review, lalu terapkan harga.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-4 lg:grid-cols-3">
          <section aria-labelledby="price-template-step" className="min-w-0 space-y-4 rounded-lg border bg-muted/30 p-5">
            <h3 id="price-template-step" className="font-semibold">1. Siapkan file</h3>
            <p className="text-sm text-muted-foreground">Gunakan template untuk mengisi SKU dan harga baru.</p>
            <p className="text-sm text-muted-foreground">Template berisi 2 baris contoh. Ganti SKU contoh atau hapus barisnya sebelum upload.</p>
            <Button data-testid="excel-template" type="button" variant="outline" size="sm"
              onClick={() => window.location.assign("/api/admin/price-changes/template")}>
              <Download className="h-4 w-4" />Unduh template
            </Button>
            <details className="text-sm">
              <summary className="cursor-pointer font-medium">Format file</summary>
              <div className="mt-3 space-y-2 break-words text-xs text-muted-foreground">
                <p>Sheet <span className="font-mono">Harga</span>, versi <span className="font-mono">markdown_v2</span>. File versi lama tetap dapat diunggah.</p>
                <p>Kolom: <span className="font-mono">sku</span>, <span className="font-mono">action</span>, <span className="font-mono">new_price</span>, <span className="font-mono">input_type</span>. Jangan mengganti struktur kolom.</p>
                <p><strong className="font-mono text-foreground">set_price:</strong> tetapkan harga baru. <span className="font-mono">input_type price</span> untuk nominal Rupiah, atau <span className="font-mono">percent</span> untuk diskon dari harga source.</p>
                <p>Contoh: source Rp200.000, <span className="font-mono">new_price 10</span>, <span className="font-mono">input_type percent</span> → target Rp180.000.</p>
                <p><strong className="font-mono text-foreground">restore_base:</strong> kembali mengikuti harga source. Kosongkan <span className="font-mono">new_price</span> dan <span className="font-mono">input_type</span>.</p>
                <p>SKU harus Text. Isi persen sebagai angka biasa: 10 untuk 10%, bukan sel berformat Percentage atau formula.</p>
                <p>Baris gagal dapat diperbaiki melalui subset gagal yang tertaut ke batch asal.</p>
              </div>
            </details>
          </section>
          {canEdit ? (
            <form onSubmit={submitUpload} aria-labelledby="price-upload-step" className="min-w-0 space-y-4 rounded-lg border p-5 lg:col-span-2">
              <h3 id="price-upload-step" className="font-semibold">2. Unggah untuk review</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="min-w-0 space-y-2 sm:col-span-2">
                  <Label htmlFor="excel-file">File Excel (.xlsx)</Label>
                  <Input id="excel-file" data-testid="excel-file" name="workbook" type="file"
                    accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    aria-describedby="excel-upload-notice"
                    className="h-auto min-h-10 w-full min-w-0 py-2 file:mr-3 file:cursor-pointer file:rounded-md file:border file:border-input file:bg-card file:px-3 file:py-1" />
                </div>
                <div className="min-w-0 space-y-2 sm:col-span-2">
                  <Label htmlFor="excel-reason">Alasan (opsional)</Label>
                  <Input id="excel-reason" data-testid="excel-reason" value={reason}
                    onChange={(event) => setReason(event.target.value)} placeholder="mis. koreksi harga akhir bulan" />
                </div>
              </div>
              <div className="space-y-3 border-t pt-4">
                <Button data-testid="excel-upload" type="submit" disabled={busy}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}Unggah workbook
                </Button>
                <p id="excel-upload-notice" className="text-sm text-muted-foreground"><strong className="font-medium text-foreground">Upload belum mengubah harga.</strong> Periksa hasil sebelum menerapkan.</p>
                {fileName !== null ? <p className="break-all text-xs text-muted-foreground">File terakhir: {fileName}</p> : null}
              </div>
            </form>
          ) : <section aria-label="2. Unggah untuk review" className="rounded-lg border p-5 lg:col-span-2">
            <h3 className="mb-3 font-semibold">2. Unggah untuk review</h3>
            <p className="text-sm text-muted-foreground">Anda dapat mengunduh template dan laporan. Upload dan penerapan harga memerlukan izin edit harga.</p>
          </section>}
        </div>

        <section aria-labelledby="price-review-step" className="min-w-0 space-y-4 border-t pt-6">
          <h3 id="price-review-step" className="font-semibold">3. Review &amp; terapkan</h3>
          {batch === null && fatal === null ? <p className="rounded-md border bg-muted/30 p-4 text-sm text-muted-foreground">Hasil review akan muncul setelah file diunggah.</p> : null}
        {fatal !== null ? (
          <div
            data-testid="excel-fatal"
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm"
          >
            <p className="font-medium text-destructive">
              Workbook ditolak: {fatal.reason}
            </p>
            <p className="text-muted-foreground">{fatal.message}</p>
            <p className="mt-1 text-muted-foreground">
              Tidak ada baris yang di-stage dan tidak ada harga yang berubah.
            </p>
          </div>
        ) : null}

        {batch !== null ? (
          <div className="min-w-0 space-y-4">
            <p className="text-sm text-muted-foreground">Setiap baris yang berhasil diterapkan langsung mengubah harga. Baris lain dapat gagal atau masih tertunda.</p>
            <div
              id="excel-results"
              tabIndex={-1}
              data-testid="excel-batch-summary"
              className="flex flex-wrap items-center gap-3 rounded-md border bg-muted/30 p-4"
            >
              <Badge variant={status?.tone === "error" ? "destructive" : "secondary"}>
                {status?.text}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {batch.rowCount} baris · {batch.appliedCount} diterapkan ·{" "}
                {batch.unchangedCount} tanpa perubahan · {batch.failedCount} gagal ·{" "}
                {batch.pendingCount} pending
              </span>
              {batch.parentBatchId !== null ? (
                <Badge variant="outline">Koreksi tertaut</Badge>
              ) : null}
              <Badge variant="outline">{batch.source.toUpperCase()}</Badge>
            </div>
            {halted !== null ? (
              <p className="text-sm text-destructive" role="alert">
                {halted}
              </p>
            ) : null}

            <div className="flex flex-wrap gap-2">
              {canEdit ? (
                <Button
                  data-testid="excel-apply"
                  type="button"
                  onClick={() => void applyOnce()}
                  disabled={busy || batch.pendingCount === 0}
                >
                  {batch.pendingCount > 0 && batch.appliedCount + batch.unchangedCount + batch.failedCount > 0
                    ? "Lanjutkan apply"
                    : "Terapkan baris valid"}
                </Button>
              ) : null}
              <Button
                data-testid="excel-report-all"
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  window.location.assign(
                    `/api/admin/price-changes/${batch.id}/report?subset=all`
                  )
                }
              >
                Unduh laporan
              </Button>
              {batch.failedCount > 0 ? (
                <Button
                  data-testid="excel-report-failed"
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    window.location.assign(
                      `/api/admin/price-changes/${batch.id}/report?subset=failed`
                    )
                  }
                >
                  Unduh subset gagal
                </Button>
              ) : (
                <Button
                  data-testid="excel-report-failed"
                  variant="outline"
                  size="sm"
                  disabled
                >
                  Unduh subset gagal
                </Button>
              )}
            </div>

            <div className="rounded-md border">
              <Table data-testid="excel-row-table">
                <TableHeader>
                  <TableRow>
                    <TableHead>Baris</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead>Aksi</TableHead>
                    <TableHead>Input</TableHead>
                    <TableHead>Target</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Alasan</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleRows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="tabular-nums">{row.rowNumber}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {row.inputSku === "" ? "—" : row.inputSku}
                      </TableCell>
                      <TableCell className="text-xs">
                        {actionLabel(row.action)}
                        {row.action === "invalid" && row.preview.inputActionRaw
                          ? ` (${row.preview.inputActionRaw})`
                          : ""}
                      </TableCell>
                      <TableCell className="text-xs tabular-nums">{inputLabel(row)}</TableCell>
                      <TableCell className="tabular-nums">{targetLabel(row)}</TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            row.state === "failed"
                              ? "destructive"
                              : row.state === "applied"
                                ? "default"
                                : "outline"
                          }
                        >
                          {row.state}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {rowReason(row)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {rows.length > MAX_VISIBLE_ROWS ? (
              <p className="text-xs text-muted-foreground">
                Menampilkan {MAX_VISIBLE_ROWS} dari {rows.length} baris. Unduh
                laporan untuk daftar lengkap.
              </p>
            ) : null}

            {canEdit && batch.failedCount > 0 && batch.pendingCount === 0 ? (
              <form
                onSubmit={submitCorrection}
                className="space-y-2 rounded-md border p-3"
              >
                <p className="text-sm font-medium">
                  Unggah koreksi untuk {batch.failedCount} baris gagal
                </p>
                <p className="text-xs text-muted-foreground">
                  Unduh subset gagal, perbaiki nilai yang salah, lalu unggah
                  kembali. File harus memuat kolom referensi{" "}
                  <span className="font-mono">origin_row</span>; server hanya
                  menerima tautan ke baris final gagal batch ini.
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <Input
                    data-testid="excel-correction-file"
                    name="correction"
                    type="file"
                    accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    className="max-w-xs"
                  />
                  <Button
                    data-testid="excel-correction-upload"
                    type="submit"
                    variant="outline"
                    disabled={busy}
                  >
                    Unggah koreksi
                  </Button>
                </div>
              </form>
            ) : null}
          </div>
        ) : null}
        </section>
      </CardContent>
    </Card>
  );
}

"use client";

import { useRef, useState, type FormEvent } from "react";
import {
  BookOpen,
  Download,
  FileSpreadsheet,
  Loader2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { getStatusToneClassName } from "@marketplace/ui/src/lib/status-styles";
import {
  getPriceBatchTone,
  getStatusTone,
} from "@marketplace/ui/src/lib/status-presentation";
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
  rowStateLabel,
  rupiah,
  statusMessage,
  type Batch,
  type BatchRow,
} from "./price-change-shared";
import { PriceFormatGuideDialog } from "./price-change-guides";
import { PriceExcelDropzone } from "./price-excel-dropzone";

const MAX_VISIBLE_ROWS = 200;

function actionLabel(action: BatchRow["action"]): string {
  if (action === "set_price") return "Set harga";
  if (action === "restore_base") return "Hapus harga coret";
  return "Tidak valid";
}

function rowReason(row: BatchRow): string {
  const code = row.resultCode ?? row.preview.errorReason;
  if (code === "EXAMPLE_ROW_NOT_REPLACED")
    return "Ganti SKU contoh dengan SKU produk atau hapus baris contoh, lalu unggah kembali.";
  if (code === "INPUT_TYPE_INVALID")
    return "Gunakan input_type price atau percent untuk set_price.";
  if (code === "PERCENT_INVALID")
    return "Isi diskon persen yang menghasilkan harga lebih dari Rp0 dan di bawah harga dasar.";
  if (code === "INPUT_TYPE_NOT_ALLOWED" || code === "PRICE_NOT_ALLOWED")
    return "Kosongkan new_price dan input_type untuk restore_base.";
  return code ?? "—";
}

function inputLabel(row: BatchRow): string {
  const raw = row.preview.inputValueRaw ?? row.preview.inputTargetRaw;
  if (row.action === "restore_base" && !raw && !row.preview.inputTypeRaw)
    return "—";
  if (row.preview.inputType === "percent")
    return `${raw ?? "—"}% dari harga dasar`;
  if (
    (row.preview.inputType === "price" ||
      row.preview.inputType === undefined) &&
    raw &&
    /^\d+$/.test(raw)
  )
    return rupiah(raw);
  return (
    raw ?? (row.targetUnitPrice !== null ? rupiah(row.targetUnitPrice) : "—")
  );
}

function targetLabel(row: BatchRow): string {
  if (row.targetUnitPrice !== null) return rupiah(row.targetUnitPrice);
  if (row.action === "restore_base") return "—";
  return row.preview.inputTargetRaw ?? "—";
}

export function PriceChangeExcelClient({
  onBatchChange,
  onApplied,
}: {
  onBatchChange?: (batch: Batch) => void;
  onApplied?: () => void;
}) {
  const { hasPermission } = useAuth();
  const canEdit = hasPermission("prices", "edit");

  const [reason, setReason] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [correctionFile, setCorrectionFile] = useState<File | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const [batch, setBatch] = useState<Batch | null>(null);
  const [rows, setRows] = useState<BatchRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [fatal, setFatal] = useState<{ reason: string; message: string } | null>(
    null,
  );
  const [lastFileName, setLastFileName] = useState<string | null>(null);
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
            message: payload.error ?? "File ditolak",
          });
          toast.error(
            `File ditolak (${payload.details?.reason ?? "WORKBOOK_REJECTED"}). Tidak ada harga yang berubah.`,
          );
        } else {
          throw new Error(payload?.error ?? "Gagal mengunggah file Excel");
        }
        return;
      }
      applyKeyRef.current = null;
      const staged = payload.data as Batch;
      await replaceBatch(staged);
      if (parentBatchId) {
        setCorrectionFile(null);
        toast.success(
          `Koreksi ${staged.rowCount} baris dicek (${staged.failedCount} masih gagal), tertaut ke batch asal.`,
        );
      } else {
        setSelectedFile(null);
        toast.success(
          `Hasil cek ${staged.rowCount} baris: ${staged.pendingCount} siap diterapkan, ${staged.failedCount} perlu diperbaiki.`,
        );
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Gagal mengunggah file Excel",
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
    const file = selectedFile ?? input?.files?.[0] ?? null;
    if (!file) {
      toast.error("Pilih file .xlsx terlebih dahulu.");
      return;
    }
    setLastFileName(file.name);
    event.currentTarget.reset();
    void upload(file);
  };

  const submitCorrection = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!batch) return;
    const input = event.currentTarget.elements.namedItem("correction") as
      | HTMLInputElement
      | null;
    const file = correctionFile ?? input?.files?.[0] ?? null;
    if (!file) {
      toast.error("Pilih file koreksi .xlsx terlebih dahulu.");
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
        },
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) {
        throw new Error(payload?.error ?? "Gagal menerapkan harga");
      }
      applyKeyRef.current = null;
      const applied = payload.data as Batch;
      onApplied?.();
      await replaceBatch(applied);
      const halted = haltMessage(applied.haltReason);
      if (halted !== null) toast.error(halted);
      else if (applied.pendingCount > 0)
        toast.info(`Belum final: ${applied.pendingCount} baris masih tersisa.`);
      else if (applied.failedCount > 0)
        toast.error(`${applied.failedCount} baris gagal.`);
      else if (applied.appliedCount === 0)
        toast.info("Tidak ada perubahan harga.");
      else toast.success(`${applied.appliedCount} baris diterapkan.`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Gagal menerapkan harga",
      );
    } finally {
      setBusy(false);
    }
  };

  const status = batch === null ? null : statusMessage(batch);
  const halted = batch === null ? null : haltMessage(batch.haltReason);
  const visibleRows = rows.slice(0, MAX_VISIBLE_ROWS);

  return (
    <div className="min-w-0 space-y-6">
      <Card className="min-w-0">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2">
                <FileSpreadsheet className="h-5 w-5 shrink-0" aria-hidden="true" />
                <h2>Import harga dari Excel</h2>
              </CardTitle>
              <CardDescription>
                Unggah file .xlsx untuk dicek sebelum harga diterapkan.
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                data-testid="excel-template"
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  window.location.assign("/api/admin/price-changes/template")
                }
              >
                <Download className="h-4 w-4" aria-hidden="true" />
                Unduh template (.xlsx)
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setGuideOpen(true)}
              >
                <BookOpen className="h-4 w-4" aria-hidden="true" />
                Panduan format
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {canEdit ? (
            <form
              onSubmit={submitUpload}
              aria-label="Unggah file Excel"
              className="space-y-4"
            >
              <PriceExcelDropzone
                id="excel-file"
                name="workbook"
                testId="excel-file"
                file={selectedFile}
                onFileChange={setSelectedFile}
                disabled={busy}
                describedBy="excel-upload-notice"
              />

              <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
                <div className="min-w-0 space-y-1.5">
                  <Label htmlFor="excel-reason">
                    Catatan perubahan (opsional)
                  </Label>
                  <Input
                    id="excel-reason"
                    data-testid="excel-reason"
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder="mis. Koreksi harga akhir bulan"
                  />
                </div>
                <Button data-testid="excel-upload" type="submit" disabled={busy}>
                  {busy ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Upload className="h-4 w-4" aria-hidden="true" />
                  )}
                  Unggah &amp; cek file
                </Button>
              </div>

              <p
                id="excel-upload-notice"
                className="text-xs text-muted-foreground"
              >
                Tip: Ganti atau hapus 2 baris contoh di template sebelum unggah. Harga belum berubah sebelum Anda klik Terapkan.
              </p>
            </form>
          ) : (
            <p className="rounded-md border bg-muted/40 p-4 text-sm text-muted-foreground">
              Anda dapat mengunduh template dan laporan. Unggah dan penerapan
              harga memerlukan izin edit harga.
            </p>
          )}

          {fatal !== null && (
            <div
              data-testid="excel-fatal"
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/5 p-3.5 text-sm"
            >
              <p className="font-medium text-destructive">
                File tidak dapat diproses ({fatal.reason})
              </p>
              <p className="mt-0.5 text-muted-foreground">{fatal.message}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Tidak ada harga yang berubah.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {batch !== null && (
        <Card className="min-w-0">
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="space-y-1">
                <CardTitle>
                  <h3>
                    Hasil pengecekan{lastFileName ? ` · ${lastFileName}` : ""}
                  </h3>
                </CardTitle>
                <CardDescription>
                  Setiap baris yang valid langsung aktif di toko setelah diterapkan.
                </CardDescription>
              </div>
              {batch.parentBatchId !== null && (
                <Badge variant="outline">Koreksi tertaut</Badge>
              )}
            </div>
          </CardHeader>

          <CardContent className="space-y-4">
            <div
              id="excel-results"
              tabIndex={-1}
              data-testid="excel-batch-summary"
              data-status-tone={getPriceBatchTone(batch)}
              className={`flex flex-wrap items-center justify-between gap-3 rounded-md border p-4 ${getStatusToneClassName(getPriceBatchTone(batch))}`}
            >
              <div className="flex flex-wrap items-center gap-3">
                <StatusBadge tone={getPriceBatchTone(batch)}>
                  {status?.text}
                </StatusBadge>
                <span className="text-xs text-muted-foreground">
                  {batch.rowCount} baris · {batch.appliedCount} diterapkan ·{" "}
                  {batch.unchangedCount} tanpa perubahan · {batch.failedCount}{" "}
                  gagal · {batch.pendingCount} siap diterapkan
                </span>
              </div>

              <div className="flex flex-wrap gap-2">
                {canEdit && batch.pendingCount > 0 && (
                  <Button
                    data-testid="excel-apply"
                    type="button"
                    size="sm"
                    onClick={() => void applyOnce()}
                    disabled={busy}
                  >
                    {busy && (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    )}
                    {batch.appliedCount +
                      batch.unchangedCount +
                      batch.failedCount >
                    0
                      ? "Lanjutkan penerapan"
                      : `Terapkan ${batch.pendingCount} baris`}
                  </Button>
                )}
                <Button
                  data-testid="excel-report-all"
                  type="button"
                  variant="outline"
                  size="sm"
                  className="bg-card text-foreground"
                  onClick={() =>
                    window.location.assign(
                      `/api/admin/price-changes/${batch.id}/report?subset=all`,
                    )
                  }
                >
                  Unduh laporan
                </Button>
                {batch.failedCount > 0 && (
                  <Button
                    data-testid="excel-report-failed"
                    type="button"
                    variant="outline"
                    size="sm"
                    className="bg-card text-foreground"
                    onClick={() =>
                      window.location.assign(
                        `/api/admin/price-changes/${batch.id}/report?subset=failed`,
                      )
                    }
                  >
                    Unduh baris gagal
                  </Button>
                )}
              </div>
            </div>

            {halted !== null && (
              <p className="text-sm text-destructive" role="alert">
                {halted}
              </p>
            )}

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
                    <TableHead>Keterangan</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleRows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="tabular-nums">
                        {row.rowNumber}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {row.inputSku === "" ? "—" : row.inputSku}
                      </TableCell>
                      <TableCell className="text-xs">
                        {actionLabel(row.action)}
                        {row.action === "invalid" && row.preview.inputActionRaw
                          ? ` (${row.preview.inputActionRaw})`
                          : ""}
                      </TableCell>
                      <TableCell className="text-xs tabular-nums">
                        {inputLabel(row)}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {targetLabel(row)}
                      </TableCell>
                      <TableCell>
                        <StatusBadge tone={getStatusTone("price-row", row.state)}>
                          {rowStateLabel(row.state)}
                        </StatusBadge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {rowReason(row)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {rows.length > MAX_VISIBLE_ROWS && (
              <p className="text-xs text-muted-foreground">
                Menampilkan {MAX_VISIBLE_ROWS} dari {rows.length} baris. Unduh
                laporan untuk daftar lengkap.
              </p>
            )}

            {canEdit && batch.failedCount > 0 && batch.pendingCount === 0 && (
              <form
                onSubmit={submitCorrection}
                className="space-y-3 rounded-md border bg-muted/30 p-4"
              >
                <div className="space-y-1">
                  <p className="text-sm font-medium">
                    Perbaiki {batch.failedCount} baris gagal
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Unduh file baris gagal, perbaiki nilainya tanpa menghapus
                    kolom referensi, lalu unggah kembali.
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-center">
                  <PriceExcelDropzone
                    id="excel-correction-file"
                    name="correction"
                    testId="excel-correction-file"
                    file={correctionFile}
                    onFileChange={setCorrectionFile}
                    disabled={busy}
                    compact
                    label="Pilih file koreksi Excel (.xlsx)"
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
            )}
          </CardContent>
        </Card>
      )}

      <PriceFormatGuideDialog open={guideOpen} onOpenChange={setGuideOpen} />
    </div>
  );
}

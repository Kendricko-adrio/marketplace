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
} from "./price-change-bulk-client";

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
  if (row.resultCode) return row.resultCode;
  return row.preview.errorReason ?? "—";
}

function targetLabel(row: BatchRow): string {
  if (row.targetUnitPrice !== null) return rupiah(row.targetUnitPrice);
  if (row.action === "restore_base") return "—";
  return row.preview.inputTargetRaw ?? "—";
}

export function PriceChangeExcelClient() {
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
    setRows(await loadBatchRows(next.id));
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
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileSpreadsheet className="h-5 w-5" /> Excel harga
        </CardTitle>
        <CardDescription>
          Unduh template berversi, unggah workbook untuk di-review, lalu terapkan
          baris yang valid. Setiap upload hanya staging; baris bermasalah dicatat
          sebagai gagal dan bisa dikoreksi lewat batch baru yang tertaut ke baris
          gagal batch asal.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
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
            <Download className="h-4 w-4" /> Unduh template
          </Button>
          <p className="text-sm text-muted-foreground">
            Sheet <span className="font-mono">Harga</span>, marker{" "}
            <span className="font-mono">OKCIR_MARKDOWN_V1</span>, kolom{" "}
            <span className="font-mono">sku</span> /{" "}
            <span className="font-mono">action</span> /{" "}
            <span className="font-mono">new_price</span>.
          </p>
        </div>

        {canEdit ? (
          <form
            onSubmit={submitUpload}
            className="flex flex-wrap items-end gap-3 rounded-md border p-3"
          >
            <div className="space-y-1">
              <Label htmlFor="excel-reason">Alasan (opsional)</Label>
              <Input
                id="excel-reason"
                data-testid="excel-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="mis. koreksi harga akhir bulan"
                className="max-w-xs"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="excel-file">Workbook .xlsx</Label>
              <Input
                id="excel-file"
                data-testid="excel-file"
                name="workbook"
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="max-w-xs"
              />
            </div>
            <Button
              data-testid="excel-upload"
              type="submit"
              disabled={busy}
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              Unggah workbook
            </Button>
            {fileName !== null ? (
              <p className="text-xs text-muted-foreground">{fileName}</p>
            ) : null}
          </form>
        ) : (
          <p className="text-sm text-muted-foreground">
            Anda dapat mengunduh template/laporan, tetapi staging dan apply
            memerlukan izin edit harga.
          </p>
        )}

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
          <div className="space-y-3">
            <div
              data-testid="excel-batch-summary"
              className="flex flex-wrap items-center gap-3"
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
      </CardContent>
    </Card>
  );
}

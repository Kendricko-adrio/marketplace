"use client";

import { useCallback, useRef, useState, type FormEvent } from "react";
import { Loader2, Search } from "lucide-react";
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
import { Checkbox } from "@/components/ui/checkbox";
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

// =========================================================
// Bulk Markdown — pilih SKU lintas halaman → stage → review → apply bertahap
// =========================================================
// Selection lives in a Map keyed by variant id, so it survives pagination and
// search changes; the header checkbox only ever covers the ACTIVE page, never
// the whole filtered result. The browser never computes authoritative money:
// the percent shortcut is frozen into a fixed target by the server, one click
// commits at most one server chunk, and the counts shown after every response
// are the server's own applied/unchanged/failed/pending numbers — a batch with
// pending rows is never reported as fully applied.

const CANDIDATE_PAGE_SIZE = 25;
const ROW_FETCH_LIMIT = 100;
/** Warnings that describe a legitimate no-op, not a row the admin must fix. */
const INFORMATIONAL_WARNINGS = new Set(["MARKDOWN_ABSENT"]);

type Candidate = {
  variantId: string;
  sku: string;
  productId: string;
  productName: string;
  variantLabel: string | null;
  basePrice: string | null;
  effectiveUnitPrice: string | null;
  storedTarget: string | null;
  markdownActive: boolean;
  priceVersion: number | null;
};

type Pagination = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

type CandidatePage = { rows: Candidate[]; pagination: Pagination };

type Preview = {
  inputSku: string;
  action: "set_price" | "restore_base";
  variantLabel: string | null;
  targetUnitPrice: string | null;
  sourceUnitPrice: string | null;
  storedTargetBefore: string | null;
  effectiveUnitPriceBefore: string | null;
  effectiveUnitPriceAfter: string | null;
  markdownActiveBefore: boolean;
  delta: string | null;
  direction: "increase" | "decrease" | "same" | "unknown";
  percent: string | null;
  warnings: string[];
};

type BatchRow = {
  id: string;
  rowNumber: number;
  inputSku: string;
  variantId: string | null;
  action: "set_price" | "restore_base";
  targetUnitPrice: string | null;
  state: "pending" | "applied" | "unchanged" | "failed";
  resultCode: string | null;
  preview: Preview;
  actual: {
    sourceUnitPrice: string | null;
    previousTargetUnitPrice: string | null;
    previousEffectiveUnitPrice: string | null;
    targetUnitPrice: string | null;
    effectiveUnitPrice: string | null;
    markdownActive: boolean | null;
  };
  appliedRevisionId: string | null;
};

type Batch = {
  id: string;
  state: string;
  rowCount: number;
  appliedCount: number;
  unchangedCount: number;
  failedCount: number;
  pendingCount: number;
  haltReason: string | null;
  rows: BatchRow[];
  pagination?: Pagination;
};

function rupiah(value: string | null): string {
  if (value === null || value === "") return "—";
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return value;
  return `Rp ${parsed.toLocaleString("id-ID")}`;
}

function percentLabel(value: string | null): string {
  if (value === null) return "—";
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return `${value}%`;
  return `${Math.abs(parsed).toLocaleString("id-ID", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}%`;
}

function impactLabel(preview: Preview): string {
  const delta = Math.abs(Number(preview.delta ?? 0));
  const suffix = preview.percent === null ? "" : ` (${percentLabel(preview.percent)})`;
  if (preview.direction === "increase") return `Naik ${rupiah(String(delta))}${suffix}`;
  if (preview.direction === "decrease") return `Turun ${rupiah(String(delta))}${suffix}`;
  if (preview.direction === "same") return "Tidak berubah";
  return "Tidak diketahui";
}

function warningLabel(warning: string): string {
  switch (warning) {
    case "VARIANT_NOT_FOUND":
      return "SKU tidak ditemukan";
    case "SOURCE_PRICE_INVALID":
      return "Harga sumber tidak valid";
    default:
      return warning;
  }
}

function rowStatus(row: BatchRow): string {
  const parts: string[] = [];
  if (row.action === "restore_base") {
    parts.push(
      row.preview.storedTargetBefore !== null
        ? "melepas Markdown"
        : "tidak ada Markdown aktif"
    );
  }
  for (const warning of row.preview.warnings) {
    // `MARKDOWN_ABSENT` is already explained by the restore text above.
    if (INFORMATIONAL_WARNINGS.has(warning)) continue;
    parts.push(warningLabel(warning));
  }
  if (row.state === "applied") parts.push("diterapkan");
  else if (row.state === "unchanged") parts.push("tanpa perubahan");
  else if (row.state === "failed") parts.push(`gagal (${row.resultCode ?? "UNKNOWN"})`);
  return parts.length === 0 ? "—" : parts.join(" · ");
}

function haltMessage(reason: string | null): string | null {
  switch (reason) {
    case null:
    case "":
      return null;
    case "POLICY_REVOKED":
      return "Izin edit dicabut; sisa baris ditahan.";
    case "ROW_LIMIT_EXCEEDED":
      return "Batch melebihi batas baris terbaru; sisa baris ditahan.";
    default:
      return `Apply ditahan (${reason}).`;
  }
}

function statusMessage(batch: Batch): { tone: "info" | "success" | "error"; text: string } {
  const { rowCount, appliedCount, unchangedCount, failedCount, pendingCount } = batch;
  if (pendingCount > 0) {
    return {
      tone: "info",
      text: `Belum final: ${appliedCount} diterapkan, ${unchangedCount} tanpa perubahan, ${failedCount} gagal, ${pendingCount} pending.`,
    };
  }
  if (failedCount === rowCount) return { tone: "error", text: "Semua baris gagal." };
  if (appliedCount === 0 && failedCount === 0 && unchangedCount > 0) {
    return { tone: "info", text: "Tidak ada perubahan harga." };
  }
  if (failedCount > 0) {
    return {
      tone: "error",
      text: `${appliedCount} diterapkan, ${unchangedCount} tanpa perubahan, ${failedCount} gagal.`,
    };
  }
  return { tone: "success", text: `${appliedCount} baris diterapkan.` };
}

async function reviewDigest(rows: readonly BatchRow[]): Promise<string | null> {
  // Review fingerprint for the audit trail (not an authorization token).
  if (typeof crypto === "undefined" || !crypto.subtle) return null;
  const bytes = new TextEncoder().encode(
    JSON.stringify(rows.map((row) => row.preview))
  );
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function loadBatchRows(batchId: string): Promise<BatchRow[]> {
  // The batch DTO is paginated; the review and result tables need every row so
  // the aggregates and the per-row audit view are not silently truncated.
  const collected: BatchRow[] = [];
  let page = 1;
  let totalPages = 1;
  do {
    const response = await fetch(
      `/api/admin/price-changes/${batchId}?page=${page}&limit=${ROW_FETCH_LIMIT}`,
      { cache: "no-store" }
    );
    const payload = await response.json();
    if (!response.ok || !payload.success) {
      throw new Error(payload.error ?? "Gagal memuat baris batch");
    }
    const dto = payload.data as Batch;
    collected.push(...dto.rows);
    totalPages = dto.pagination?.totalPages ?? 1;
    page += 1;
  } while (page <= totalPages);
  return collected;
}

export function PriceChangeBulkClient() {
  const { hasPermission } = useAuth();
  const canEdit = hasPermission("prices", "edit");

  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [selected, setSelected] = useState<Map<string, Candidate>>(new Map());

  const [action, setAction] = useState<"set_price" | "restore_base">("set_price");
  const [target, setTarget] = useState("");
  const [percent, setPercent] = useState("");
  const [reason, setReason] = useState("");

  const [batch, setBatch] = useState<Batch | null>(null);
  const [rows, setRows] = useState<BatchRow[]>([]);
  const [showBatchId, setShowBatchId] = useState(false);
  const [busy, setBusy] = useState(false);
  // One command key per apply attempt: reused on retry after an error, cleared
  // once the server accepted it so the next click is a NEW resume request.
  const applyKeyRef = useRef<string | null>(null);

  const loadCandidates = useCallback(async (term: string, nextPage: number) => {
    if (term === "") {
      setCandidates([]);
      setPagination(null);
      return;
    }
    setLoadingCandidates(true);
    try {
      const response = await fetch(
        `/api/admin/price-changes/candidates?search=${encodeURIComponent(term)}&page=${nextPage}&limit=${CANDIDATE_PAGE_SIZE}`,
        { cache: "no-store" }
      );
      const payload = (await response.json()) as {
        success?: boolean;
        // The candidates route returns its page object in `data`; the older
        // admin list routes keep the rows in `data` and the page beside it.
        data?: CandidatePage | Candidate[];
        pagination?: Pagination;
        error?: string;
      };
      if (!response.ok || !payload.success) {
        throw new Error(payload.error ?? "Gagal memuat kandidat SKU");
      }
      const pageData = payload.data;
      setCandidates(Array.isArray(pageData) ? pageData : pageData?.rows ?? []);
      setPagination(
        Array.isArray(pageData) ? payload.pagination ?? null : pageData?.pagination ?? null
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal memuat kandidat SKU");
    } finally {
      setLoadingCandidates(false);
    }
  }, []);

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const term = search.trim();
    setAppliedSearch(term);
    void loadCandidates(term, 1);
  };

  const selectable = candidates.filter((candidate) => candidate.basePrice !== null);
  const allOnPageSelected =
    selectable.length > 0 && selectable.every((candidate) => selected.has(candidate.variantId));
  const someOnPageSelected = selectable.some((candidate) => selected.has(candidate.variantId));

  const toggleRow = (candidate: Candidate, checked: boolean) => {
    setSelected((current) => {
      const next = new Map(current);
      if (checked) next.set(candidate.variantId, candidate);
      else next.delete(candidate.variantId);
      return next;
    });
  };

  const togglePage = (checked: boolean) => {
    setSelected((current) => {
      const next = new Map(current);
      for (const candidate of candidates) {
        if (candidate.basePrice === null) continue;
        if (checked) next.set(candidate.variantId, candidate);
        else next.delete(candidate.variantId);
      }
      return next;
    });
  };

  const stage = async () => {
    if (selected.size === 0) return;
    const usesPercent = action === "set_price" && percent.trim() !== "";
    const fixedTarget = target.replace(/[^0-9]/g, "");
    if (action === "set_price" && !usesPercent && fixedTarget === "") {
      toast.error("Isi target fixed atau diskon persen.");
      return;
    }
    setBusy(true);
    try {
      const payloadRows = [...selected.values()].map((candidate) =>
        action === "restore_base"
          ? { sku: candidate.sku, action: "restore_base" as const }
          : usesPercent
            ? {
                sku: candidate.sku,
                action: "set_price" as const,
                discountPercent: percent.trim(),
              }
            : {
                sku: candidate.sku,
                action: "set_price" as const,
                targetUnitPrice: fixedTarget,
              }
      );
      const response = await fetch("/api/admin/price-changes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // A client-generated command key makes a lost response replay the SAME
        // staged batch instead of staging a second one.
        body: JSON.stringify({
          requestKey: crypto.randomUUID(),
          source: "bulk",
          reason: reason.trim() || null,
          rows: payloadRows,
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        throw new Error(payload.error ?? "Gagal stage harga");
      }
      const staged = payload.data as Batch;
      applyKeyRef.current = null;
      setShowBatchId(false);
      setBatch(staged);
      // Render the first page from the response, then complete it so the review
      // aggregates cover every row instead of the visible page only.
      setRows(staged.rows);
      setRows(await loadBatchRows(staged.id));
      toast.success(`Review ${staged.rowCount} SKU siap. Periksa dampaknya sebelum apply.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal stage harga");
    } finally {
      setBusy(false);
    }
  };

  const applyOnce = async () => {
    if (!batch) return;
    setBusy(true);
    try {
      const requestKey = applyKeyRef.current ?? crypto.randomUUID();
      applyKeyRef.current = requestKey;
      const digest = await reviewDigest(rows);
      const response = await fetch(`/api/admin/price-changes/${batch.id}/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestKey,
          ...(digest === null ? {} : { previewDigest: digest }),
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        throw new Error(payload.error ?? "Gagal apply harga");
      }
      applyKeyRef.current = null;
      const applied = payload.data as Batch;
      setBatch(applied);
      setRows(applied.rows);
      setRows(await loadBatchRows(applied.id));

      const halted = haltMessage(applied.haltReason);
      if (halted !== null) toast.error(halted);
      else if (applied.pendingCount > 0) {
        toast.info(`Belum final: ${applied.pendingCount} baris masih pending.`);
      } else if (applied.failedCount > 0) {
        toast.error(`${applied.failedCount} baris gagal.`);
      } else if (applied.appliedCount === 0) {
        toast.info("Tidak ada perubahan harga.");
      } else {
        toast.success(`${applied.appliedCount} baris diterapkan.`);
      }

      if (
        applied.pendingCount === 0 &&
        (applied.state === "applied" || applied.state === "partially_applied")
      ) {
        setSelected(new Map());
        void loadCandidates(appliedSearch, pagination?.page ?? 1);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal apply harga");
    } finally {
      setBusy(false);
    }
  };

  const processed = batch
    ? batch.appliedCount + batch.unchangedCount + batch.failedCount
    : 0;
  const status = batch === null ? null : statusMessage(batch);
  const halted = batch === null ? null : haltMessage(batch.haltReason);
  const acceptedCount = rows.filter(
    (row) =>
      row.preview.warnings.filter((warning) => !INFORMATIONAL_WARNINGS.has(warning))
        .length === 0
  ).length;
  const errorCount = rows.length - acceptedCount;
  let increaseTotal = 0;
  let decreaseTotal = 0;
  for (const row of rows) {
    const delta = Number(row.preview.delta ?? 0);
    if (!Number.isFinite(delta)) continue;
    if (delta > 0) increaseTotal += delta;
    else if (delta < 0) decreaseTotal += -delta;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Bulk harga</CardTitle>
          <CardDescription>
            Pilih SKU dari hasil pencarian. Pilihan bertahan saat berpindah
            halaman atau mengganti kata kunci; checkbox header hanya memilih
            baris pada halaman yang sedang tampil.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={submitSearch} className="flex flex-wrap gap-2">
            <Input
              data-testid="bulk-search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Cari SKU atau nama produk"
              aria-label="Cari SKU atau nama produk"
              className="max-w-sm"
            />
            <Button type="submit" variant="outline" disabled={loadingCandidates}>
              {loadingCandidates ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Search className="h-4 w-4" />
              )}
              Cari SKU
            </Button>
          </form>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-medium" data-testid="bulk-selection-count">
              Terpilih: {selected.size} SKU
            </p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setSelected(new Map())}
              disabled={selected.size === 0}
            >
              Bersihkan pilihan
            </Button>
          </div>

          {appliedSearch === "" ? (
            <p className="text-sm text-muted-foreground">
              Masukkan kata kunci SKU atau nama produk untuk mulai memilih.
            </p>
          ) : candidates.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {loadingCandidates ? "Memuat SKU…" : "Tidak ada SKU yang cocok."}
            </p>
          ) : (
            <div className="rounded-md border">
              <Table data-testid="bulk-candidate-table">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox
                        data-testid="bulk-select-page"
                        aria-label="Pilih halaman ini"
                        checked={
                          allOnPageSelected ? true : someOnPageSelected ? "indeterminate" : false
                        }
                        disabled={selectable.length === 0}
                        onCheckedChange={(checked) => togglePage(checked === true)}
                      />
                    </TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead>Produk</TableHead>
                    <TableHead>Variant</TableHead>
                    <TableHead>Base</TableHead>
                    <TableHead>Efektif</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {candidates.map((candidate) => (
                    <TableRow key={candidate.variantId}>
                      <TableCell>
                        <Checkbox
                          aria-label={`Pilih SKU ${candidate.sku}`}
                          checked={selected.has(candidate.variantId)}
                          disabled={candidate.basePrice === null}
                          onCheckedChange={(checked) => toggleRow(candidate, checked === true)}
                        />
                      </TableCell>
                      <TableCell className="font-mono text-xs">{candidate.sku}</TableCell>
                      <TableCell className="text-sm">{candidate.productName}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {candidate.variantLabel ?? "—"}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {rupiah(candidate.basePrice)}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {rupiah(candidate.effectiveUnitPrice)}
                      </TableCell>
                      <TableCell>
                        {candidate.basePrice === null ? (
                          <Badge variant="destructive">source tidak valid</Badge>
                        ) : candidate.markdownActive ? (
                          <Badge variant="destructive">Markdown aktif</Badge>
                        ) : candidate.storedTarget ? (
                          <Badge variant="secondary">Fallback</Badge>
                        ) : (
                          <Badge variant="outline">Tanpa target</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              {pagination === null
                ? "Belum ada hasil."
                : `Halaman ${pagination.page} dari ${Math.max(pagination.totalPages, 1)} · ${pagination.total} SKU`}
            </p>
            <div className="flex gap-2">
              <Button
                data-testid="bulk-prev-page"
                type="button"
                variant="outline"
                size="sm"
                disabled={
                  loadingCandidates || pagination === null || pagination.page <= 1
                }
                onClick={() =>
                  pagination !== null && void loadCandidates(appliedSearch, pagination.page - 1)
                }
              >
                Sebelumnya
              </Button>
              <Button
                data-testid="bulk-next-page"
                type="button"
                variant="outline"
                size="sm"
                disabled={
                  loadingCandidates ||
                  pagination === null ||
                  pagination.page >= pagination.totalPages
                }
                onClick={() =>
                  pagination !== null && void loadCandidates(appliedSearch, pagination.page + 1)
                }
              >
                Berikutnya
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Aksi untuk SKU terpilih</CardTitle>
          <CardDescription>
            Satu aksi diterapkan ke seluruh SKU terpilih. Shortcut persen dihitung
            server dari Base Price terbaru lalu dibekukan menjadi target fixed saat
            stage; target fixed tidak memakai harga Markdown yang sedang aktif.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant={action === "set_price" ? "default" : "outline"}
              aria-pressed={action === "set_price"}
              onClick={() => setAction("set_price")}
            >
              Set harga
            </Button>
            <Button
              type="button"
              variant={action === "restore_base" ? "default" : "outline"}
              aria-pressed={action === "restore_base"}
              onClick={() => setAction("restore_base")}
            >
              Restore Markdown
            </Button>
          </div>

          {action === "set_price" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="bulk-target">Target fixed per SKU (Rp)</Label>
                <Input
                  id="bulk-target"
                  data-testid="bulk-target"
                  inputMode="numeric"
                  value={target}
                  onChange={(event) => {
                    setTarget(event.target.value.replace(/[^0-9]/g, ""));
                    setPercent("");
                  }}
                  placeholder="150000"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="bulk-percent">Diskon (%) dari base</Label>
                <Input
                  id="bulk-percent"
                  data-testid="bulk-percent"
                  inputMode="decimal"
                  value={percent}
                  onChange={(event) => {
                    setPercent(event.target.value.replace(/[^0-9.]/g, ""));
                    setTarget("");
                  }}
                  placeholder="20"
                />
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Markdown terbaru akan dilepas. SKU tanpa Markdown aktif menjadi
              tanpa perubahan dan tidak membuat revision.
            </p>
          )}

          <div className="space-y-1">
            <Label htmlFor="bulk-reason">Alasan (opsional)</Label>
            <Input
              id="bulk-reason"
              value={reason}
              maxLength={500}
              onChange={(event) => setReason(event.target.value)}
              placeholder="mis. clearance akhir musim"
            />
          </div>

          <Button
            type="button"
            data-testid="bulk-stage"
            onClick={() => void stage()}
            disabled={selected.size === 0 || !canEdit || busy}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Stage {selected.size} SKU untuk review
          </Button>
          {!canEdit && (
            <p className="text-xs text-muted-foreground">
              Anda hanya memiliki akses lihat untuk harga.
            </p>
          )}
        </CardContent>
      </Card>

      {batch !== null && (
        <Card>
          <CardHeader className="flex-row flex-wrap items-start justify-between gap-3 space-y-0">
            <div>
              <CardTitle>Review &amp; hasil bulk</CardTitle>
              <CardDescription>
                Angka di bawah berasal dari server. Data source dibaca ulang saat
                apply; satu klik apply hanya memproses satu chunk.
              </CardDescription>
            </div>
            <div className="flex flex-col items-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowBatchId((current) => !current)}
              >
                Buka batch
              </Button>
              {showBatchId && (
                <p className="font-mono text-xs text-muted-foreground">{batch.id}</p>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1" data-testid="bulk-review-counts">
              {rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">Memuat baris review…</p>
              ) : (
                <>
                  <p className="text-sm font-medium">
                    {batch.rowCount} baris · {acceptedCount} diterima · {errorCount} error
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Total dampak: naik {rupiah(String(increaseTotal))} · turun{" "}
                    {rupiah(String(decreaseTotal))}
                  </p>
                </>
              )}
            </div>

            {(processed > 0 || halted !== null) && status !== null && (
              <div
                data-testid="bulk-status"
                className={`space-y-1 rounded-md border p-3 text-sm ${
                  halted !== null || status.tone === "error"
                    ? "border-destructive/40 bg-destructive/10 text-destructive"
                    : status.tone === "success"
                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-900"
                      : "border-sky-500/40 bg-sky-500/10 text-sky-900"
                }`}
              >
                <p>{status.text}</p>
                {halted !== null && <p className="font-medium">{halted}</p>}
              </div>
            )}

            {rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">Memuat baris batch…</p>
            ) : (
              <div className="max-h-[32rem] overflow-auto rounded-md border">
                <Table data-testid="bulk-review-table">
                  <TableHeader>
                    <TableRow>
                      <TableHead>SKU</TableHead>
                      <TableHead>Variant</TableHead>
                      <TableHead>Base (stage)</TableHead>
                      <TableHead>Efektif kini</TableHead>
                      <TableHead>Target</TableHead>
                      <TableHead>Dampak</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="font-mono text-xs">{row.inputSku}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {row.preview.variantLabel ?? "—"}
                        </TableCell>
                        <TableCell className="tabular-nums">
                          {rupiah(row.preview.sourceUnitPrice)}
                        </TableCell>
                        <TableCell className="tabular-nums">
                          {rupiah(row.preview.effectiveUnitPriceBefore)}
                        </TableCell>
                        <TableCell className="tabular-nums">
                          {row.action === "restore_base"
                            ? `Lepas Markdown ${rupiah(row.preview.storedTargetBefore)}`
                            : rupiah(row.preview.targetUnitPrice)}
                        </TableCell>
                        <TableCell
                          className={`tabular-nums ${
                            row.preview.direction === "increase"
                              ? "text-amber-600"
                              : row.preview.direction === "decrease"
                                ? "text-emerald-700"
                                : ""
                          }`}
                        >
                          {impactLabel(row.preview)}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {rowStatus(row)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              {batch.pendingCount > 0 && processed === 0 && (
                <Button
                  type="button"
                  data-testid="bulk-apply"
                  onClick={() => void applyOnce()}
                  disabled={busy || !canEdit}
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Apply {batch.rowCount} baris
                </Button>
              )}
              {batch.pendingCount > 0 && processed > 0 && (
                <Button
                  type="button"
                  data-testid="bulk-resume"
                  onClick={() => void applyOnce()}
                  disabled={busy || !canEdit}
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Lanjutkan apply (sisa {batch.pendingCount})
                </Button>
              )}
              {batch.pendingCount === 0 && (
                <p className="text-xs text-muted-foreground">
                  Batch final: {batch.state}. Setiap klik apply maksimal 25 baris
                  atau 5 detik, dan baris final tidak pernah diproses ulang.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

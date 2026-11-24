"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  AlertTriangle,
  Download,
  Loader2,
  MoreHorizontal,
  Search,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { getStatusTone } from "@marketplace/ui/src/lib/status-presentation";
import { getStatusToneClassName } from "@marketplace/ui/src/lib/status-styles";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { InfoHint } from "@/components/ui/info-hint";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/providers/auth-provider";
import { cn } from "@/lib/utils";
import {
  loadBatchRows,
  reviewDigest,
  rupiah,
  type Batch,
  type BatchRow,
  type Candidate,
  type CandidatePage,
  type Pagination,
} from "./price-change-shared";
import {
  PriceChangeDialog,
  type PriceDialogKind,
  type PriceForm,
  type PriceHistory,
} from "./price-change-dialog";
import { PriceChangeExcelClient } from "./price-change-excel-client";
import { PriceRulesGuideButton } from "./price-change-guides";

const PAGE_SIZE = 25;

function useCandidates(
  search: string,
  page: number,
  revision: number,
  markdownStatus = "all",
) {
  const [data, setData] = useState<CandidatePage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let ignore = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({
      search,
      page: String(page),
      limit: String(PAGE_SIZE),
    });
    if (markdownStatus !== "all") params.set("markdownStatus", markdownStatus);
    void (async () => {
      try {
        const response = await fetch(
          `/api/admin/price-changes/candidates?${params}`,
          { cache: "no-store" },
        );
        const payload = await response.json();
        if (!response.ok || !payload.success)
          throw new Error(payload.error ?? "Gagal memuat harga SKU");
        if (!ignore) setData(payload.data as CandidatePage);
      } catch (cause) {
        if (!ignore) {
          setData(null);
          setError(
            cause instanceof Error ? cause.message : "Gagal memuat harga SKU",
          );
        }
      } finally {
        if (!ignore) setLoading(false);
      }
    })();
    return () => {
      ignore = true;
    };
  }, [search, page, revision, markdownStatus]);
  return { data, error, loading };
}

function PageControls({
  pagination,
  busy,
  onPage,
}: {
  pagination: Pagination | undefined;
  busy: boolean;
  onPage: (page: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
      <p>
        {pagination
          ? `Halaman ${pagination.page} dari ${Math.max(1, pagination.totalPages)} · ${pagination.total} SKU`
          : "Memuat jumlah SKU…"}
      </p>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          data-testid="bulk-prev-page"
          aria-label="Halaman sebelumnya"
          disabled={busy || !pagination || pagination.page <= 1}
          onClick={() => pagination && onPage(pagination.page - 1)}
        >
          Sebelumnya
        </Button>
        <Button
          variant="outline"
          size="sm"
          data-testid="bulk-next-page"
          aria-label="Halaman berikutnya"
          disabled={
            busy || !pagination || pagination.page >= pagination.totalPages
          }
          onClick={() => pagination && onPage(pagination.page + 1)}
        >
          Berikutnya
        </Button>
      </div>
    </div>
  );
}

export function PriceChangeClient() {
  const { hasPermission } = useAuth();
  const canEdit = hasPermission("prices", "edit");
  const [view, setView] = useState<"prices" | "import">("prices");
  const [importBatch, setImportBatch] = useState<Batch | null>(null);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [markdownStatus, setMarkdownStatus] = useState("all");
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<Map<string, Candidate>>(new Map());
  const candidates = useCandidates(search, page, revision, markdownStatus);
  const inactive = useCandidates("", 1, revision, "inactive");
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  const [dialog, setDialog] = useState<PriceDialogKind | null>(null);
  const [targets, setTargets] = useState<Candidate[]>([]);
  const [skipped, setSkipped] = useState(0);
  const [form, setForm] = useState<PriceForm>({
    target: "",
    percent: "20",
    reason: "",
  });
  const [batch, setBatch] = useState<Batch | null>(null);
  const [batchRows, setBatchRows] = useState<BatchRow[]>([]);
  const [rowsReady, setRowsReady] = useState(false);
  const [applied, setApplied] = useState(false);
  const [history, setHistory] = useState<PriceHistory | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const focusReturn = useRef<HTMLElement | null>(null);
  const stageReceipt = useRef<{ command: string; key: string } | null>(null);
  const applyKey = useRef<string | null>(null);
  const pendingApply = applied && (batch?.pendingCount ?? 0) > 0;

  // Debounce search input like /admin/products so typing triggers backend search smoothly.
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed === search) return;
    const handle = setTimeout(() => {
      setSearch(trimmed);
      setPage(1);
    }, 300);
    return () => clearTimeout(handle);
  }, [query, search]);

  function rememberFocus() {
    focusReturn.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
  }

  function openAction(
    kind: "manual" | "bulk" | "restore",
    values = [...selected.values()],
  ) {
    if (busy || pendingApply || !canEdit) return;
    const eligible =
      kind === "restore"
        ? values.filter((row) => row.storedTarget !== null)
        : values;
    if (eligible.length === 0) return;
    rememberFocus();
    setTargets(eligible);
    setSkipped(values.length - eligible.length);
    setForm({
      target:
        kind === "manual" && eligible.length === 1
          ? (eligible[0].storedTarget ?? "")
          : "",
      percent: "20",
      reason: "",
    });
    setDialogError(null);
    stageReceipt.current = null;
    setDialog(kind);
  }

  async function openHistory(row: Candidate) {
    if (busy) return;
    rememberFocus();
    setTargets([row]);
    setHistory(null);
    setDialogError(null);
    setDialog("history");
    setBusy(true);
    try {
      const response = await fetch(
        `/api/admin/prices/${encodeURIComponent(row.variantId)}/history?limit=10`,
        { cache: "no-store" },
      );
      const payload = await response.json();
      if (!response.ok || !payload.success)
        throw new Error(payload.error ?? "Gagal memuat riwayat harga");
      setHistory(payload.data as PriceHistory);
    } catch (error) {
      setDialogError(
        error instanceof Error ? error.message : "Gagal memuat riwayat harga",
      );
    } finally {
      setBusy(false);
    }
  }

  async function readRows(next: Batch) {
    setRowsReady(false);
    setBatchRows(next.rows);
    const all = await loadBatchRows(next.id);
    setBatchRows(all);
    setRowsReady(all.length === next.rowCount);
  }

  async function stage() {
    if (busy || !canEdit || targets.length === 0) return;
    if (
      (dialog === "manual" && !form.target) ||
      (dialog === "bulk" && !form.percent)
    ) {
      setDialogError("Isi target harga atau persentase terlebih dahulu.");
      return;
    }
    setBusy(true);
    setDialogError(null);
    try {
      const command = {
        source: targets.length === 1 ? "manual" : "bulk",
        reason: form.reason.trim() || null,
        rows: targets.map((row) =>
          dialog === "restore"
            ? { sku: row.sku, action: "restore_base" }
            : dialog === "bulk"
              ? {
                  sku: row.sku,
                  action: "set_price",
                  discountPercent: form.percent,
                }
              : {
                  sku: row.sku,
                  action: "set_price",
                  targetUnitPrice: form.target,
                },
        ),
      };
      const fingerprint = JSON.stringify(command);
      if (stageReceipt.current?.command !== fingerprint)
        stageReceipt.current = {
          command: fingerprint,
          key: crypto.randomUUID(),
        };
      const response = await fetch("/api/admin/price-changes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...command,
          requestKey: stageReceipt.current.key,
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.success)
        throw new Error(payload.error ?? "Gagal menyiapkan review harga");
      const next = payload.data as Batch;
      setBatch(next);
      setApplied(false);
      applyKey.current = null;
      setDialog("review");
      await readRows(next);
    } catch (error) {
      setDialogError(
        error instanceof Error
          ? error.message
          : "Gagal menyiapkan review harga",
      );
    } finally {
      setBusy(false);
    }
  }

  async function reloadBatch() {
    if (!batch || busy) return;
    setBusy(true);
    setDialogError(null);
    try {
      const response = await fetch(`/api/admin/price-changes/${batch.id}`, {
        cache: "no-store",
      });
      const payload = await response.json();
      if (!response.ok || !payload.success)
        throw new Error(payload.error ?? "Gagal memuat hasil");
      setBatch(payload.data as Batch);
      await readRows(payload.data as Batch);
      refresh();
    } catch (error) {
      setDialogError(
        error instanceof Error ? error.message : "Gagal memuat hasil",
      );
    } finally {
      setBusy(false);
    }
  }

  function receiveImportBatch(next: Batch) {
    setImportBatch(next);
    setSelected((current) => {
      const updated = new Map(current);
      for (const row of next.rows) {
        if (
          !row.variantId ||
          row.actual.sourceUnitPrice === null ||
          (row.state !== "applied" && row.state !== "unchanged")
        )
          continue;
        const previous = updated.get(row.variantId);
        if (previous)
          updated.set(row.variantId, {
            ...previous,
            basePrice: row.actual.sourceUnitPrice,
            effectiveUnitPrice: row.actual.effectiveUnitPrice,
            storedTarget: row.actual.targetUnitPrice,
            markdownActive: row.actual.markdownActive === true,
          });
      }
      return updated;
    });
  }

  async function applyOnce() {
    if (!batch || busy || !canEdit || !rowsReady) return;
    setBusy(true);
    setDialogError(null);
    try {
      const key = applyKey.current ?? crypto.randomUUID();
      applyKey.current = key;
      const digest = await reviewDigest(batchRows);
      // Once a request may have reached the server, retain the pending batch
      // and its receipt even when the response is lost. Closing is not rollback.
      setApplied(true);
      const response = await fetch(
        `/api/admin/price-changes/${batch.id}/apply`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            requestKey: key,
            ...(digest ? { previewDigest: digest } : {}),
          }),
        },
      );
      const payload = await response.json();
      if (!response.ok || !payload.success)
        throw new Error(
          payload.error ??
            "Gagal menerapkan harga; periksa hasil sebelum melanjutkan.",
        );
      applyKey.current = null;
      const next = payload.data as Batch;
      setBatch(next);
      setApplied(true);
      refresh();
      if (
        next.pendingCount === 0 &&
        (next.state === "applied" || next.state === "partially_applied")
      ) {
        setSelected((current) => {
          const remaining = new Map(current);
          for (const row of batchRows)
            if (row.variantId) remaining.delete(row.variantId);
          return remaining;
        });
      }
      await readRows(next);
    } catch (error) {
      setDialogError(
        error instanceof Error
          ? error.message
          : "Gagal menerapkan harga; perubahan yang sudah tersimpan tidak dibatalkan.",
      );
    } finally {
      setBusy(false);
    }
  }

  const rows = candidates.data?.rows ?? [];
  const selectable = rows.filter((row) => row.basePrice !== null);
  const allSelected =
    selectable.length > 0 &&
    selectable.every((row) => selected.has(row.variantId));
  const someSelected = selectable.some((row) => selected.has(row.variantId));
  const noEditReason = !canEdit
    ? "Anda hanya memiliki akses lihat untuk halaman ini."
    : pendingApply
      ? "Selesaikan batch aktif melalui Hasil perubahan."
      : selected.size === 0
        ? "Pilih minimal satu SKU terlebih dahulu."
        : undefined;

  async function exportSelected() {
    if (selected.size === 0 || busy) return;
    setBusy(true);
    try {
      const response = await fetch("/api/admin/price-changes/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ variantIds: [...selected.keys()] }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error ?? "Gagal export SKU");
      }
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "harga-export.xlsx";
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal export SKU");
    } finally {
      setBusy(false);
    }
  }

  function openImportResults() {
    setView("import");
    requestAnimationFrame(() => {
      const results = document.getElementById("excel-results");
      results?.scrollIntoView({ block: "center" });
      results?.focus({ preventScroll: true });
    });
  }

  function toggle(row: Candidate, checked: boolean) {
    setSelected((current) => {
      const next = new Map(current);
      if (checked) next.set(row.variantId, row);
      else next.delete(row.variantId);
      return next;
    });
  }

  function searchSkus(event: FormEvent) {
    event.preventDefault();
    setSearch(query.trim());
    setPage(1);
    refresh();
  }

  const inactiveCount = inactive.data?.pagination.total ?? 0;

  return (
    <div className="min-w-0 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-3xl space-y-1">
          <h1 className="text-2xl font-bold text-foreground">Harga SKU</h1>
          <p className="text-sm text-muted-foreground">
            Atur harga coret per SKU atau import massal dari Excel.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline">Harga global · semua cabang</Badge>
          <PriceRulesGuideButton />
        </div>
      </div>

      {!canEdit && (
        <div className="rounded-md border bg-muted/40 px-4 py-2.5 text-sm text-muted-foreground">
          Anda hanya memiliki akses lihat untuk halaman ini.
        </div>
      )}

      <Tabs
        value={view}
        onValueChange={(value) =>
          setView(value === "import" ? "import" : "prices")
        }
        className="min-w-0 space-y-6"
      >
        <div className="max-w-full overflow-x-auto">
          <TabsList aria-label="Pengelolaan harga">
            <TabsTrigger value="prices">Harga coret</TabsTrigger>
            <TabsTrigger value="import">Import Excel</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent
          value="prices"
          forceMount
          hidden={view !== "prices"}
          className="min-w-0 space-y-4"
        >
          <Card>
            <CardContent className="space-y-4 pt-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <form
                  onSubmit={searchSkus}
                  className="relative min-w-0 flex-1 basis-full sm:max-w-sm sm:basis-auto"
                >
                  <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    type="search"
                    data-testid="bulk-search"
                    aria-label="Cari SKU atau nama produk"
                    placeholder="Cari SKU atau nama produk..."
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    className={cn("pl-9", query ? "pr-9" : "")}
                  />
                  {query && (
                    <button
                      type="button"
                      aria-label="Hapus pencarian"
                      onClick={() => {
                        setQuery("");
                        setSearch("");
                        setPage(1);
                      }}
                      className="absolute right-2.5 top-2.5 rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <X className="h-4 w-4" aria-hidden="true" />
                    </button>
                  )}
                </form>

                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground">Status</span>
                    <Select
                      value={markdownStatus}
                      onValueChange={(value) => {
                        setMarkdownStatus(value);
                        setPage(1);
                      }}
                    >
                      <SelectTrigger
                        id="markdown-status"
                        aria-label="Status harga coret"
                        className="w-44"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Semua</SelectItem>
                        <SelectItem value="configured">Sudah disetup</SelectItem>
                        <SelectItem value="inactive">Target nonaktif</SelectItem>
                        <SelectItem value="unconfigured">Belum disetup</SelectItem>
                      </SelectContent>
                    </Select>
                  </label>

                  {importBatch && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={openImportResults}
                    >
                      Hasil import
                    </Button>
                  )}
                </div>
              </div>

              {inactiveCount > 0 && markdownStatus !== "inactive" && (
                <div
                  role="status"
                  className={cn(
                    "flex flex-wrap items-center justify-between gap-2 rounded-md border px-3.5 py-2 text-sm",
                    getStatusToneClassName("progress"),
                  )}
                >
                  <span className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>
                      <strong>{inactiveCount} SKU</strong> memiliki target nonaktif karena harga dasar Jubelio turun.
                    </span>
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 bg-card text-foreground"
                    onClick={() => {
                      setMarkdownStatus("inactive");
                      setPage(1);
                    }}
                  >
                    Lihat
                  </Button>
                </div>
              )}

              {batch && (
                <div
                  role="status"
                  className={cn(
                    "flex flex-wrap items-center justify-between gap-2 rounded-md border px-3.5 py-2 text-sm",
                    getStatusToneClassName(pendingApply ? "progress" : "info"),
                  )}
                >
                  <span>
                    {pendingApply
                      ? `Ada batch perubahan yang belum selesai (${batch.pendingCount} SKU tersisa).`
                      : `Ringkasan batch perubahan terakhir tersedia (${batch.rowCount} SKU).`}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 bg-card text-foreground"
                    onClick={() => {
                      rememberFocus();
                      setDialogError(null);
                      setDialog("review");
                    }}
                  >
                    {pendingApply ? "Lanjutkan review" : "Hasil perubahan"}
                  </Button>
                </div>
              )}

              {selected.size > 0 && (
                <div
                  role="region"
                  aria-label="Aksi SKU terpilih"
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-muted/40 px-3.5 py-2.5"
                >
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" data-testid="bulk-selection-count">
                      {selected.size} SKU terpilih
                    </Badge>
                    <InfoHint label="Informasi pilihan SKU">
                      Pilihan dipertahankan lintas halaman. Checkbox header hanya memilih SKU pada halaman yang sedang tampil.
                    </InfoHint>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      disabled={busy || pendingApply || !canEdit}
                      title={noEditReason}
                      onClick={() => openAction("manual")}
                    >
                      Ubah nominal
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy || pendingApply || !canEdit}
                      title={noEditReason}
                      onClick={() => openAction("bulk")}
                    >
                      Diskon (%)
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={
                        busy ||
                        pendingApply ||
                        !canEdit ||
                        ![...selected.values()].some(
                          (row) => row.storedTarget !== null,
                        )
                      }
                      onClick={() => openAction("restore")}
                    >
                      Hapus harga coret
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      data-testid="bulk-export"
                      disabled={busy}
                      onClick={() => void exportSelected()}
                    >
                      <Download className="h-4 w-4" aria-hidden="true" />
                      Export Excel
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setSelected(new Map())}
                    >
                      Batal pilih
                    </Button>
                  </div>
                </div>
              )}

              {candidates.error ? (
                <div
                  role="alert"
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive"
                >
                  <span>{candidates.error}</span>
                  <Button size="sm" variant="outline" onClick={refresh}>
                    Coba lagi
                  </Button>
                </div>
              ) : candidates.loading && rows.length === 0 ? (
                <div
                  role="status"
                  className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground"
                >
                  <Loader2 className="h-5 w-5 animate-spin text-primary" aria-hidden="true" />
                  <span>Memuat daftar harga SKU…</span>
                </div>
              ) : (
                <>
                  <div
                    role="region"
                    aria-label="Daftar harga SKU"
                    tabIndex={0}
                    className="relative rounded-md border [&>div]:max-h-[540px] [&>div]:overflow-auto"
                  >
                    <Table
                      aria-label="Harga coret SKU"
                      data-testid="bulk-candidate-table"
                      aria-busy={candidates.loading}
                      className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-muted"
                    >
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-10">
                            <Checkbox
                              data-testid="bulk-select-page"
                              aria-label="Pilih halaman ini"
                              checked={
                                allSelected
                                  ? true
                                  : someSelected
                                    ? "indeterminate"
                                    : false
                              }
                              disabled={
                                candidates.loading || selectable.length === 0
                              }
                              onCheckedChange={(checked) =>
                                setSelected((current) => {
                                  const next = new Map(current);
                                  for (const row of selectable) {
                                    if (checked) next.set(row.variantId, row);
                                    else next.delete(row.variantId);
                                  }
                                  return next;
                                })
                              }
                            />
                          </TableHead>
                          <TableHead>SKU</TableHead>
                          <TableHead>Produk / Varian</TableHead>
                          <TableHead className="text-right">
                            Harga dasar (Jubelio)
                          </TableHead>
                          <TableHead className="text-right">
                            Harga website
                          </TableHead>
                          <TableHead className="text-right">
                            Target tersimpan
                          </TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">Aksi</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody
                        className={cn(
                          candidates.loading ? "opacity-60 transition-opacity" : "",
                        )}
                      >
                        {rows.map((row) => (
                          <TableRow key={row.variantId}>
                            <TableCell>
                              <Checkbox
                                aria-label={`Pilih SKU ${row.sku}`}
                                checked={selected.has(row.variantId)}
                                disabled={
                                  candidates.loading || row.basePrice === null
                                }
                                onCheckedChange={(checked) =>
                                  toggle(row, checked === true)
                                }
                              />
                            </TableCell>
                            <TableCell className="whitespace-nowrap font-mono text-xs">
                              {row.sku}
                            </TableCell>
                            <TableCell className="min-w-44">
                              <span className="font-medium text-foreground">
                                {row.productName}
                              </span>
                              {row.variantLabel && (
                                <span className="block text-xs text-muted-foreground">
                                  {row.variantLabel}
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-right tabular-nums">
                              {rupiah(row.basePrice)}
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-right tabular-nums">
                              <span className="font-medium">
                                {rupiah(row.effectiveUnitPrice)}
                              </span>
                              {row.markdownActive && (
                                <s className="ml-2 text-xs text-muted-foreground">
                                  {rupiah(row.basePrice)}
                                </s>
                              )}
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-right tabular-nums">
                              {row.storedTarget !== null &&
                              !row.markdownActive ? (
                                <s className="text-muted-foreground">
                                  {rupiah(row.storedTarget)}
                                </s>
                              ) : (
                                rupiah(row.storedTarget)
                              )}
                            </TableCell>
                            <TableCell>
                              <StatusBadge
                                tone={getStatusTone(
                                  "markdown",
                                  row.basePrice === null
                                    ? "invalid_source"
                                    : row.markdownActive
                                      ? "active"
                                      : row.storedTarget !== null
                                        ? "inactive_target"
                                        : "absent",
                                )}
                                className="whitespace-nowrap"
                              >
                                {row.basePrice === null
                                  ? "Harga dasar invalid"
                                  : row.markdownActive
                                    ? "Aktif"
                                    : row.storedTarget !== null
                                      ? "Target nonaktif"
                                      : "Belum disetup"}
                              </StatusBadge>
                            </TableCell>
                            <TableCell>
                              <div className="flex justify-end gap-1">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={
                                    busy ||
                                    pendingApply ||
                                    !canEdit ||
                                    row.basePrice === null
                                  }
                                  onClick={() => openAction("manual", [row])}
                                >
                                  Ubah
                                </Button>
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-8 w-8 p-0"
                                      aria-label={`Aksi lainnya untuk ${row.sku}`}
                                      disabled={busy}
                                    >
                                      <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    <DropdownMenuItem
                                      onClick={() => void openHistory(row)}
                                    >
                                      Riwayat harga
                                    </DropdownMenuItem>
                                    {row.storedTarget !== null && (
                                      <DropdownMenuItem
                                        disabled={
                                          busy ||
                                          pendingApply ||
                                          !canEdit ||
                                          row.basePrice === null
                                        }
                                        onClick={() =>
                                          openAction("restore", [row])
                                        }
                                      >
                                        Hapus harga coret
                                      </DropdownMenuItem>
                                    )}
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                        {rows.length === 0 && (
                          <TableRow>
                            <TableCell
                              colSpan={8}
                              className="h-28 text-center text-muted-foreground"
                            >
                              <div className="flex flex-col items-center gap-2">
                                <span>
                                  {search || markdownStatus !== "all"
                                    ? "Tidak ada SKU yang cocok dengan pencarian dan filter."
                                    : "Belum ada SKU produk."}
                                </span>
                                {(search || markdownStatus !== "all") && (
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={() => {
                                      setQuery("");
                                      setSearch("");
                                      setMarkdownStatus("all");
                                      setPage(1);
                                    }}
                                  >
                                    Reset filter
                                  </Button>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                  <PageControls
                    pagination={candidates.data?.pagination}
                    busy={candidates.loading}
                    onPage={setPage}
                  />
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent
          value="import"
          forceMount
          hidden={view !== "import"}
          className="min-w-0 space-y-4"
        >
          {selected.size > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-card px-4 py-3">
              <span className="text-sm font-medium">
                {selected.size} SKU dipilih untuk export
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => void exportSelected()}
              >
                <Download className="h-4 w-4" aria-hidden="true" />
                Export Excel
              </Button>
            </div>
          )}
          <PriceChangeExcelClient
            onBatchChange={receiveImportBatch}
            onApplied={refresh}
          />
        </TabsContent>
      </Tabs>

      <PriceChangeDialog
        kind={dialog}
        targets={targets}
        skipped={skipped}
        form={form}
        onForm={setForm}
        batch={batch}
        rows={batchRows}
        rowsReady={rowsReady}
        applied={applied}
        history={history}
        busy={busy}
        error={dialogError}
        canEdit={canEdit}
        focusReturn={focusReturn}
        onClose={() => setDialog(null)}
        onStage={() => void stage()}
        onApply={() => void applyOnce()}
        onReload={() => void reloadBatch()}
      />
    </div>
  );
}

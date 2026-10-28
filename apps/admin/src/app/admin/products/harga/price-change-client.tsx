"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { Download, Search } from "lucide-react";
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
  prefix,
}: {
  pagination: Pagination | undefined;
  busy: boolean;
  onPage: (page: number) => void;
  prefix: string;
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
          data-testid={`${prefix}-prev-page`}
          aria-label={`${prefix === "bulk" ? "SKU" : "Target nonaktif"} halaman sebelumnya`}
          disabled={busy || !pagination || pagination.page <= 1}
          onClick={() => pagination && onPage(pagination.page - 1)}
        >
          Sebelumnya
        </Button>
        <Button
          variant="outline"
          size="sm"
          data-testid={`${prefix}-next-page`}
          aria-label={`${prefix === "bulk" ? "SKU" : "Target nonaktif"} halaman berikutnya`}
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
  const [inactivePage, setInactivePage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<Map<string, Candidate>>(new Map());
  const candidates = useCandidates(search, page, revision, markdownStatus);
  const inactive = useCandidates("", inactivePage, revision, "inactive");
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
        throw new Error(payload.error ?? "Gagal memuat histori harga");
      setHistory(payload.data as PriceHistory);
    } catch (error) {
      setDialogError(
        error instanceof Error ? error.message : "Gagal memuat histori harga",
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
          : "Gagal menerapkan harga; hasil committed tidak dibatalkan.",
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
    ? "Anda hanya memiliki akses lihat untuk harga."
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

  return (
    <div className="min-w-0 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-3xl space-y-1">
          <h1 className="text-2xl font-bold text-foreground">Harga SKU</h1>
          <p className="text-sm text-muted-foreground">
            Kelola harga coret per SKU atau import dari Excel.
          </p>
        </div>
        <Badge variant="outline">Harga global · semua cabang</Badge>
      </div>
      <Tabs value={view} onValueChange={(value) => setView(value === "import" ? "import" : "prices")} className="min-w-0 space-y-6">
        <div className="max-w-full overflow-x-auto">
          <TabsList aria-label="Pengelolaan harga">
            <TabsTrigger value="prices">Harga coret</TabsTrigger>
            <TabsTrigger value="import">Import &amp; batch</TabsTrigger>
          </TabsList>
        </div>
      <TabsContent value="prices" forceMount hidden={view !== "prices"} className="min-w-0 space-y-6">
        <Card>
          <CardHeader>
            <CardTitle><h2>Harga coret</h2></CardTitle>
            <CardDescription>Periksa perubahan sebelum menerapkan harga baru.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-end gap-3">
              <form
                onSubmit={searchSkus}
                className="flex min-w-0 flex-1 basis-full gap-2 sm:max-w-md sm:basis-auto"
              >
                <div className="relative min-w-0 flex-1">
                  <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    type="search"
                    data-testid="bulk-search"
                    aria-label="Cari SKU atau nama produk"
                    placeholder="Cari SKU atau nama produk"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    className="pl-9"
                  />
                </div>
                <Button variant="outline" type="submit" aria-label="Cari SKU">
                  <Search className="h-4 w-4 sm:hidden" />
                  <span className="hidden sm:inline">Cari SKU</span>
                </Button>
              </form>
              <div className="flex w-full flex-col gap-1.5 sm:w-48">
                <Label htmlFor="markdown-status">Status harga coret</Label>
                <Select
                  value={markdownStatus}
                  onValueChange={(value) => {
                    setMarkdownStatus(value);
                    setPage(1);
                  }}
                >
                  <SelectTrigger id="markdown-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Semua</SelectItem>
                    <SelectItem value="configured">Sudah disetup</SelectItem>
                    <SelectItem value="unconfigured">Belum disetup</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Badge variant="secondary" data-testid="bulk-selection-count">
                Terpilih: {selected.size} SKU
              </Badge>
            </div>
            <div className="flex flex-wrap items-start justify-between gap-3 rounded-md border bg-muted/30 p-3">
              <div role="group" aria-label="Perubahan harga" className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                disabled={
                  busy || pendingApply || !canEdit || selected.size === 0
                }
                title={noEditReason}
                onClick={() => openAction("manual")}
              >
                Ubah manual
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={
                  busy || pendingApply || !canEdit || selected.size === 0
                }
                title={noEditReason}
                onClick={() => openAction("bulk")}
              >
                Ubah massal (% dari base)
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
                Restore terpilih
              </Button>
              {batch && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    rememberFocus();
                    setDialogError(null);
                    setDialog("review");
                  }}
                >
                  Hasil perubahan
                </Button>
              )}
              </div>
              <div role="group" aria-label="File dan pilihan SKU" className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setView("import")}
              >
                Import Excel
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!importBatch}
                title={
                  !importBatch
                    ? "Belum ada batch import pada sesi ini."
                    : undefined
                }
                onClick={openImportResults}
              >
                Hasil import
              </Button>
              <Button
                size="sm"
                variant="outline"
                data-testid="bulk-export"
                disabled={busy || selected.size === 0}
                onClick={() => void exportSelected()}
              >
                <Download className="h-4 w-4" />
                Export terpilih
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={selected.size === 0}
                onClick={() => setSelected(new Map())}
              >
                Bersihkan pilihan
              </Button>
              </div>
            </div>
            {candidates.error ? (
              <div role="alert" className="text-sm text-destructive">
                {candidates.error}{" "}
                <Button size="sm" variant="outline" onClick={refresh}>
                  Coba lagi
                </Button>
              </div>
            ) : (
              <>
                <div
                  role="region"
                  aria-label="Daftar harga SKU"
                  tabIndex={0}
                  className="rounded-md border [&>div]:max-h-[520px] [&>div]:overflow-auto"
                >
                  <Table
                    aria-label="Harga coret SKU"
                    data-testid="bulk-candidate-table"
                    aria-busy={candidates.loading}
                    className="text-xs [&_td]:px-3 [&_td]:py-2 [&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-muted [&_th]:px-3 [&_th]:text-xs"
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
                        <TableHead>Nama / variant</TableHead>
                        <TableHead className="text-right">
                          Base Jubelio
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
                    <TableBody>
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
                          <TableCell className="min-w-40 text-sm">
                            {row.productName}
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
                            <Badge
                              variant={
                                row.basePrice === null ||
                                (row.storedTarget !== null &&
                                  !row.markdownActive)
                                  ? "destructive"
                                  : row.markdownActive
                                    ? "secondary"
                                    : "outline"
                              }
                              className="whitespace-nowrap"
                            >
                              {row.basePrice === null
                                ? "Source tidak valid"
                                : row.markdownActive
                                  ? "Aktif"
                                  : row.storedTarget !== null
                                    ? "Target nonaktif"
                                    : "Tanpa markdown"}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex justify-end gap-1">
                              <Button
                                size="sm"
                                className="h-7 px-2 text-xs"
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
                              <Button
                                size="sm"
                                className="h-7 px-2 text-xs"
                                variant="ghost"
                                disabled={
                                  busy ||
                                  pendingApply ||
                                  !canEdit ||
                                  row.storedTarget === null ||
                                  row.basePrice === null
                                }
                                onClick={() => openAction("restore", [row])}
                              >
                                Restore
                              </Button>
                              <Button
                                size="sm"
                                className="h-7 px-2 text-xs"
                                variant="ghost"
                                disabled={busy}
                                onClick={() => void openHistory(row)}
                              >
                                Riwayat
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                      {rows.length === 0 && (
                        <TableRow>
                          <TableCell
                            colSpan={8}
                            className="h-24 text-center text-muted-foreground"
                          >
                            {candidates.loading
                              ? "Memuat SKU…"
                              : "Tidak ada SKU yang cocok dengan pencarian dan filter."}
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
                  prefix="bulk"
                />
              </>
            )}
            <p className="text-xs text-muted-foreground">
              Pilihan dipertahankan lintas halaman. Checkbox header hanya
              memilih halaman aktif, bukan seluruh hasil pencarian.
            </p>
            <details className="rounded-md border px-4 py-3 text-sm">
              <summary className="cursor-pointer font-medium">Tentang harga coret</summary>
              <div className="mt-3 space-y-2 text-muted-foreground">
                <p>Harga sumber mengikuti Jubelio. Target harga coret berlaku untuk semua cabang, tanpa tanggal akhir.</p>
                <p>Target tetap tersimpan saat harga sumber turun melewatinya, dan aktif kembali jika harga sumber naik di atas target.</p>
                <p>Setiap baris yang berhasil diterapkan langsung berlaku. Satu batch dapat memiliki hasil berhasil, gagal, atau masih tertunda.</p>
              </div>
            </details>
          </CardContent>
        </Card>
        <section aria-label="Target nonaktif">
          <Card>
            <CardHeader>
              <CardTitle><h2>Target nonaktif</h2></CardTitle>
              <CardDescription>
                Harga sumber sama dengan atau lebih rendah dari target. Target tetap tersimpan.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {inactive.error ? (
                <div role="alert" className="text-sm text-destructive">
                  {inactive.error}{" "}
                  <Button variant="outline" size="sm" onClick={refresh}>
                    Coba lagi
                  </Button>
                </div>
              ) : (
                <>
                  <p className="rounded-md border bg-muted/40 p-3 text-sm">
                    {inactive.loading ? (
                      "Memuat target nonaktif…"
                    ) : (
                      <>
                        <strong>{inactive.data?.pagination.total} SKU</strong>{" "}
                        memiliki target tersimpan yang tidak aktif di seluruh
                        katalog.
                      </>
                    )}
                  </p>
                  <div className="rounded-md border [&>div]:max-h-80">
                    <Table
                      aria-label="SKU dengan target nonaktif"
                      aria-busy={inactive.loading}
                      className="text-xs [&_td]:py-2"
                    >
                      <TableHeader>
                        <TableRow>
                          <TableHead>SKU</TableHead>
                          <TableHead className="text-right">
                            Base terbaru
                          </TableHead>
                          <TableHead className="text-right">
                            Target tersimpan
                          </TableHead>
                          <TableHead className="text-right">
                            Harga website
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {inactive.data?.rows.map((row) => (
                          <TableRow key={row.variantId}>
                            <TableCell className="font-mono text-xs">
                              {row.sku}
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-right">
                              {rupiah(row.basePrice)}
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-right">
                              <s className="text-muted-foreground">
                                {rupiah(row.storedTarget)}
                              </s>
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-right font-medium">
                              {rupiah(row.effectiveUnitPrice)}
                            </TableCell>
                          </TableRow>
                        ))}
                        {!inactive.loading &&
                          inactive.data?.rows.length === 0 && (
                            <TableRow>
                              <TableCell
                                colSpan={4}
                                className="text-center text-muted-foreground"
                              >
                                Tidak ada target nonaktif.
                              </TableCell>
                            </TableRow>
                          )}
                      </TableBody>
                    </Table>
                  </div>
                  {(inactive.data?.pagination.totalPages ?? 0) > 1 && (
                    <PageControls
                      pagination={inactive.data?.pagination}
                      busy={inactive.loading}
                      onPage={setInactivePage}
                      prefix="inactive"
                    />
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </section>
      </TabsContent>
      <TabsContent value="import" forceMount hidden={view !== "import"} className="min-w-0 space-y-4">
        {selected.size > 0 ? <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-card px-4 py-3">
          <span className="text-sm font-medium">{selected.size} SKU dipilih untuk export</span>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void exportSelected()}>
            <Download className="h-4 w-4" />Export terpilih
          </Button>
        </div> : null}
        <PriceChangeExcelClient onBatchChange={receiveImportBatch} onApplied={refresh} />
      </TabsContent>
      </Tabs>
      {!canEdit && (
        <p className="text-sm text-muted-foreground">
          Anda hanya memiliki akses lihat untuk harga.
        </p>
      )}
      {pendingApply && (
        <p className="text-sm text-muted-foreground">
          Batch belum selesai. Buka Hasil perubahan untuk melanjutkan sebelum
          membuat perubahan harga baru.
        </p>
      )}
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

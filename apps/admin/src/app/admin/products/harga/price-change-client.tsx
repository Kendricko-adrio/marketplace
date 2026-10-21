"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw, Search, Tag } from "lucide-react";
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

// =========================================================
// Manual Markdown price panel — stage → review → apply + history
// =========================================================
// The browser never computes authoritative money: the percent shortcut is
// resolved server-side against the latest source, and apply re-reads the source
// and current Markdown inside one transaction. The client only renders the
// server's review and result.

type ProductRow = { id: string; name: string; slug: string };

type VariantRow = {
  id: string;
  sku: string;
  color: string | null;
  size: string | null;
  price: string;
  sourcePrice: string;
  storedTarget: string | null;
  markdownActive: boolean;
  markdownRevisionId: string | null;
};

type Preview = {
  inputSku: string;
  action: "set_price" | "restore_base";
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
  rows: BatchRow[];
};

type HistoryEntry = {
  id: string;
  revisionNo: number;
  action: "set_price" | "restore_base";
  targetUnitPrice: string | null;
  sourceUnitPrice: string;
  effectiveUnitPrice: string;
  previousEffectiveUnitPrice: string;
  markdownActive: boolean;
  actorIdentity: string;
  createdAt: string;
};

type History = {
  sku: string;
  current: {
    sourceUnitPrice: string;
    effectiveUnitPrice: string;
    storedTarget: string | null;
    markdownActive: boolean;
  } | null;
  currentVersion: number | null;
  revisions: HistoryEntry[];
};

function rupiah(value: string | null): string {
  if (value === null || value === "") return "—";
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return value;
  return `Rp ${parsed.toLocaleString("id-ID")}`;
}

function percentText(value: string | null): string {
  if (value === null) return "—";
  return `${value}%`;
}

async function reviewDigest(preview: Preview): Promise<string> {
  // Review fingerprint for the audit trail (not an authorization token).
  if (typeof crypto === "undefined" || !crypto.subtle) return "review";
  const bytes = new TextEncoder().encode(JSON.stringify(preview));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function PriceChangeClient() {
  const { hasPermission } = useAuth();
  const canEdit = hasPermission("prices", "edit");

  const [query, setQuery] = useState("");
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [product, setProduct] = useState<{ id: string; name: string } | null>(null);
  const [variants, setVariants] = useState<VariantRow[]>([]);
  const [loadingProduct, setLoadingProduct] = useState(false);
  const [selected, setSelected] = useState<VariantRow | null>(null);

  const [action, setAction] = useState<"set_price" | "restore_base">("set_price");
  const [target, setTarget] = useState("");
  const [percent, setPercent] = useState("");
  const [reason, setReason] = useState("");
  const [batch, setBatch] = useState<Batch | null>(null);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<History | null>(null);

  const loadHistory = useCallback(async (variantId: string) => {
    try {
      const response = await fetch(
        `/api/admin/prices/${encodeURIComponent(variantId)}/history?limit=10`,
        { cache: "no-store" }
      );
      const payload = await response.json();
      if (response.ok && payload.success) setHistory(payload.data as History);
      else setHistory(null);
    } catch {
      setHistory(null);
    }
  }, []);

  const search = async () => {
    setSearching(true);
    try {
      const response = await fetch(
        `/api/admin/products?search=${encodeURIComponent(query)}&limit=10`,
        { cache: "no-store" }
      );
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.error ?? "Gagal");
      setProducts(payload.data as ProductRow[]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal mencari produk");
    } finally {
      setSearching(false);
    }
  };

  const openProduct = async (row: ProductRow) => {
    setLoadingProduct(true);
    setProduct(row);
    setSelected(null);
    setBatch(null);
    setHistory(null);
    try {
      const response = await fetch(`/api/admin/products/${row.id}`, {
        cache: "no-store",
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.error ?? "Gagal");
      setVariants(payload.data.variants as VariantRow[]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal memuat SKU");
    } finally {
      setLoadingProduct(false);
    }
  };

  const pickVariant = (variant: VariantRow) => {
    setSelected(variant);
    setBatch(null);
    setAction("set_price");
    setTarget(variant.storedTarget ?? "");
    setPercent("");
    setReason("");
    void loadHistory(variant.id);
  };

  const stage = async () => {
    if (!selected) return;
    if (action === "set_price" && !target.trim() && !percent.trim()) {
      toast.error("Isi target fixed atau diskon persen.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/admin/price-changes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // A client-generated command key makes a double click / lost response
        // replay the SAME staged batch instead of staging twice.
        body: JSON.stringify({
          requestKey: crypto.randomUUID(),
          reason: reason.trim() || null,
          rows: [
            action === "set_price"
              ? percent.trim()
                ? { sku: selected.sku, action, discountPercent: percent.trim() }
                : {
                    sku: selected.sku,
                    action,
                    targetUnitPrice: target.replace(/[^0-9]/g, ""),
                  }
              : { sku: selected.sku, action },
          ],
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        throw new Error(payload.error ?? "Gagal stage harga");
      }
      setBatch(payload.data as Batch);
      toast.success("Review siap. Periksa dampaknya sebelum apply.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal stage harga");
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!batch) return;
    setBusy(true);
    try {
      const digest = await reviewDigest(batch.rows[0].preview);
      const response = await fetch(`/api/admin/price-changes/${batch.id}/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestKey: crypto.randomUUID(), previewDigest: digest }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        throw new Error(payload.error ?? "Gagal apply harga");
      }
      const applied = payload.data as Batch;
      setBatch(applied);
      const row = applied.rows[0];
      if (row.state === "applied") toast.success("Markdown diterapkan.");
      else if (row.state === "unchanged") toast.info("Tidak ada perubahan harga.");
      else toast.error(`Baris gagal: ${row.resultCode ?? "UNKNOWN"}`);
      if (selected) {
        void loadHistory(selected.id);
        const detail = await fetch(`/api/admin/products/${product?.id}`, {
          cache: "no-store",
        });
        const detailPayload = await detail.json();
        if (detail.ok && detailPayload.success) {
          setVariants(detailPayload.data.variants as VariantRow[]);
        }
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal apply harga");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (products.length === 0 && query === "") void search();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const preview = batch?.rows[0]?.preview;
  const result = batch?.rows[0];

  return (
    <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
      <Card>
        <CardHeader>
          <CardTitle>Pilih SKU</CardTitle>
          <CardDescription>
            Cari produk, lalu pilih SKU yang ingin diberi target Markdown.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void search();
              }}
              placeholder="Cari nama atau slug produk"
              aria-label="Cari produk"
            />
            <Button
              type="button"
              variant="outline"
              aria-label="Cari produk"
              onClick={() => void search()}
              disabled={searching}
            >
              {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            </Button>
          </div>

          {products.length > 0 && (
            <div className="max-h-48 overflow-auto rounded-md border">
              {products.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => void openProduct(row)}
                  className={`flex w-full items-center justify-between border-b px-3 py-2 text-left text-sm last:border-b-0 hover:bg-muted ${
                    product?.id === row.id ? "bg-muted" : ""
                  }`}
                >
                  <span>{row.name}</span>
                  <span className="text-xs text-muted-foreground">{row.slug}</span>
                </button>
              ))}
            </div>
          )}

          {product && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">SKU — {product.name}</h3>
              {loadingProduct ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Memuat SKU…
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>SKU</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead>Efektif</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {variants.map((variant) => (
                      <TableRow key={variant.id}>
                        <TableCell className="font-mono text-xs">{variant.sku}</TableCell>
                        <TableCell>{rupiah(variant.sourcePrice)}</TableCell>
                        <TableCell>{rupiah(variant.price)}</TableCell>
                        <TableCell>
                          {variant.markdownActive ? (
                            <Badge variant="destructive">Markdown aktif</Badge>
                          ) : variant.storedTarget ? (
                            <Badge variant="secondary">Fallback</Badge>
                          ) : (
                            <Badge variant="outline">Tanpa target</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            type="button"
                            size="sm"
                            variant={selected?.id === variant.id ? "default" : "outline"}
                            onClick={() => pickVariant(variant)}
                          >
                            Pilih
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Stage perubahan</CardTitle>
            <CardDescription>
              {selected ? `SKU ${selected.sku}` : "Pilih SKU terlebih dahulu."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <Button
                type="button"
                variant={action === "set_price" ? "default" : "outline"}
                onClick={() => setAction("set_price")}
                disabled={!selected}
              >
                Set target
              </Button>
              <Button
                type="button"
                variant={action === "restore_base" ? "default" : "outline"}
                onClick={() => setAction("restore_base")}
                disabled={!selected}
              >
                Restore base
              </Button>
            </div>

            {action === "set_price" ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="target">Target fixed (Rp)</Label>
                  <Input
                    id="target"
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
                  <Label htmlFor="percent">atau diskon (%)</Label>
                  <Input
                    id="percent"
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
                Restore melepas Markdown terbaru dan memakai harga sumber
                terbaru. Tidak ada revision bila memang belum ada Markdown.
              </p>
            )}

            <div className="space-y-1">
              <Label htmlFor="reason">Alasan (opsional)</Label>
              <Input
                id="reason"
                value={reason}
                maxLength={500}
                onChange={(event) => setReason(event.target.value)}
                placeholder="mis. promo akhir pekan"
              />
            </div>

            <Button
              type="button"
              onClick={() => void stage()}
              disabled={!selected || !canEdit || busy}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Tag className="h-4 w-4" />}
              Stage untuk review
            </Button>
            {!canEdit && (
              <p className="text-xs text-muted-foreground">
                Anda hanya memiliki akses lihat untuk harga.
              </p>
            )}
          </CardContent>
        </Card>

        {preview && (
          <Card>
            <CardHeader>
              <CardTitle>Review</CardTitle>
              <CardDescription>
                Data source dibaca saat stage; apply memakai source terbaru di
                dalam transaksi.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <dl className="grid grid-cols-2 gap-2">
                <div>
                  <dt className="text-muted-foreground">Source (saat stage)</dt>
                  <dd className="font-medium">{rupiah(preview.sourceUnitPrice)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Harga efektif kini</dt>
                  <dd className="font-medium">{rupiah(preview.effectiveUnitPriceBefore)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Target</dt>
                  <dd className="font-medium">
                    {preview.action === "restore_base" ? "Restore base" : rupiah(preview.targetUnitPrice)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Efektif setelah</dt>
                  <dd className="font-medium">{rupiah(preview.effectiveUnitPriceAfter)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Dampak</dt>
                  <dd className={`font-medium ${preview.direction === "increase" ? "text-amber-600" : ""}`}>
                    {preview.direction === "increase"
                      ? `Naik ${rupiah(String(Math.abs(Number(preview.delta))))} (${percentText(
                          preview.percent?.replace("-", "") ?? null
                        )})`
                      : preview.direction === "decrease"
                        ? `Turun ${rupiah(String(Math.abs(Number(preview.delta))))} (${percentText(
                            preview.percent?.replace("-", "") ?? null
                          )})`
                        : preview.direction === "same"
                          ? "Tidak berubah"
                          : "Tidak diketahui"}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Markdown saat ini</dt>
                  <dd className="font-medium">
                    {preview.storedTargetBefore
                      ? `${rupiah(preview.storedTargetBefore)} (${preview.markdownActiveBefore ? "aktif" : "fallback"})`
                      : "Tidak ada"}
                  </dd>
                </div>
              </dl>
              {preview.warnings.length > 0 && (
                <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-800">
                  {preview.warnings.map((warning) => (
                    <p key={warning}>{warning}</p>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <Button type="button" onClick={() => void apply()} disabled={busy || !canEdit}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Apply
                </Button>
                <Button type="button" variant="outline" onClick={() => setBatch(null)} disabled={busy}>
                  Batal
                </Button>
              </div>
              {result && result.state !== "pending" && (
                <p className="text-xs text-muted-foreground">
                  Hasil: {result.state} ({result.resultCode ?? "—"})
                  {result.appliedRevisionId ? ` · revision ${result.appliedRevisionId.slice(0, 8)}` : ""}
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {history && (
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle>Histori harga</CardTitle>
                <CardDescription>
                  {history.sku} · versi saat ini {history.currentVersion ?? "—"}
                </CardDescription>
              </div>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => selected && void loadHistory(selected.id)}
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
            </CardHeader>
            <CardContent>
              {history.revisions.length === 0 ? (
                <p className="text-sm text-muted-foreground">Belum ada revision.</p>
              ) : (
                <Table>
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
                    {history.revisions.map((revision) => (
                      <TableRow key={revision.id}>
                        <TableCell>{revision.revisionNo}</TableCell>
                        <TableCell>{revision.action === "set_price" ? "Set" : "Restore"}</TableCell>
                        <TableCell>{rupiah(revision.sourceUnitPrice)}</TableCell>
                        <TableCell>{rupiah(revision.targetUnitPrice)}</TableCell>
                        <TableCell>{rupiah(revision.effectiveUnitPrice)}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {new Date(revision.createdAt).toLocaleString("id-ID")}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

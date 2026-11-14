"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Plus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { getStatusTone } from "@marketplace/ui/src/lib/status-presentation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/providers/auth-provider";
import type { DiscountOfferSummaryDto, ListDiscountOffersResult } from "@/lib/discounts-administration";
import { DiscountCreateDialog } from "./discount-create-dialog";

const STATE_LABEL: Record<string, string> = {
  draft: "Draft",
  enabled: "Aktif",
  paused: "Dijeda",
  archived: "Diarsipkan",
};

const KIND_LABEL: Record<string, string> = {
  public: "Kupon publik",
  manual_only: "Kode promo",
};

function rupiah(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  return `Rp ${BigInt(value).toLocaleString("id-ID")}`;
}

function benefitLabel(offer: DiscountOfferSummaryDto): string {
  const live = offer.liveRevision;
  if (live) {
    if (live.kind === "shipping") return `Subsidi ongkir, maks ${rupiah(live.capAmount)}`;
    if (live.kind === "percentage_goods") {
      return `${Number(live.rate)}% barang${live.capAmount === null ? "" : `, maks ${rupiah(live.capAmount)}`}`;
    }
    return live.fixedAmount === null ? "—" : `Nominal ${rupiah(live.fixedAmount)}`;
  }
  const draft = offer.draftSummary;
  if (!draft?.kind) return "Belum diisi";
  if (draft.kind === "shipping") return `Subsidi ongkir, maks ${rupiah(draft.capAmount)}`;
  if (draft.kind === "percentage_goods") {
    return `${Number(draft.rate)}% barang${draft.capAmount === null ? "" : `, maks ${rupiah(draft.capAmount)}`}`;
  }
  return draft.fixedAmount === null ? "Belum diisi" : `Nominal ${rupiah(draft.fixedAmount)}`;
}

/** Sisa kuota/budget live; Offer yang belum publish tidak diklaim dapat dipakai. */
function RemainingCell(props: { offer: DiscountOfferSummaryDto; metric: "quota" | "budget" }) {
  const { offer } = props;
  if (!offer.liveRevision) {
    return <span className="text-muted-foreground">Belum berlaku</span>;
  }
  const bound = props.metric === "quota" ? offer.quotaCount : offer.budgetAmount;
  const summary = offer.capacitySummary;
  if (bound === null) return <span className="text-muted-foreground">Tanpa batas</span>;
  if (!summary) return <span className="text-muted-foreground">Perlu review</span>;
  if (props.metric === "quota") {
    return (
      <span className="whitespace-nowrap">
        {summary.availableCount === null ? "Tanpa batas" : summary.availableCount}
        <span className="ml-1 text-xs text-muted-foreground">dari {bound}</span>
      </span>
    );
  }
  return (
    <span className="whitespace-nowrap">
      {summary.availableAmount === null ? "Tanpa batas" : rupiah(summary.availableAmount)}
      <span className="ml-1 text-xs text-muted-foreground">dari {rupiah(offer.budgetAmount)}</span>
    </span>
  );
}

export function DiscountsListClient() {
  const { hasPermission } = useAuth();
  const canEdit = hasPermission("discounts", "edit");
  const [activationKind, setActivationKind] = useState("all");
  const [stateFilter, setStateFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<ListDiscountOffersResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams({ page: String(page), limit: "10" });
      if (activationKind !== "all") params.set("activationKind", activationKind);
      if (stateFilter !== "all") params.set("state", stateFilter);
      try {
        const response = await fetch(`/api/admin/discounts?${params}`, { signal });
        const body = (await response.json()) as ListDiscountOffersResult & {
          success?: boolean;
          error?: string;
        };
        if (!response.ok || !body.success) throw new Error(body.error ?? "Gagal memuat diskon");
        setResult(body);
      } catch (caught) {
        if (signal?.aborted) return;
        setError(caught instanceof Error ? caught.message : "Gagal memuat diskon");
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [activationKind, page, stateFilter]
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const totalPages = result?.pagination.totalPages ?? 1;
  const filtered = activationKind !== "all" || stateFilter !== "all";

  return (
    <Card className="min-w-0">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <CardTitle>
            <h2>Daftar diskon</h2>
          </CardTitle>
          {canEdit ? (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Buat diskon
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Jenis</span>
            <Select
              value={activationKind}
              onValueChange={(value) => {
                setPage(1);
                setActivationKind(value);
              }}
            >
              <SelectTrigger className="w-40" aria-label="Filter jenis promo">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua jenis</SelectItem>
                <SelectItem value="public">Kupon publik</SelectItem>
                <SelectItem value="manual_only">Kode promo</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Status</span>
            <Select
              value={stateFilter}
              onValueChange={(value) => {
                setPage(1);
                setStateFilter(value);
              }}
            >
              <SelectTrigger className="w-40" aria-label="Filter status promo">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua status</SelectItem>
                {Object.entries(STATE_LABEL).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        </div>

        {error ? (
          <div role="alert" className="rounded-md border border-destructive/40 p-3 text-sm text-destructive">
            Gagal memuat diskon
            <Button className="ml-2" size="sm" variant="outline" onClick={() => void load()}>
              Coba lagi
            </Button>
          </div>
        ) : loading ? (
          <p role="status" className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Memuat diskon…
          </p>
        ) : !result?.data.length ? (
          <p className="py-8 text-sm text-muted-foreground">
            {filtered ? "Tidak ada diskon sesuai filter." : "Belum ada diskon."}
          </p>
        ) : (
          <div className="max-w-full overflow-x-auto rounded-md border">
            <Table aria-label="Daftar diskon">
              <TableHeader>
                <TableRow>
                  <TableHead>Nama diskon</TableHead>
                  <TableHead>Jenis</TableHead>
                  <TableHead>Potongan</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Sisa kuota</TableHead>
                  <TableHead>Sisa budget</TableHead>
                  <TableHead className="text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.data.map((offer) => (
                  <TableRow key={offer.id}>
                    <TableCell className="min-w-40 font-medium">
                      {offer.displayName ?? "Diskon tanpa nama"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {KIND_LABEL[offer.activationKind] ?? offer.activationKind}
                    </TableCell>
                    <TableCell className="min-w-40">{benefitLabel(offer)}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1">
                        <StatusBadge tone={getStatusTone("offer", offer.state)}>
                          {STATE_LABEL[offer.state] ?? offer.state}
                        </StatusBadge>
                        {offer.liveRevision && offer.draftRevisionId ? (
                          <Badge variant="secondary">Ada draft</Badge>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell>
                      <RemainingCell offer={offer} metric="quota" />
                    </TableCell>
                    <TableCell>
                      <RemainingCell offer={offer} metric="budget" />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button asChild variant="outline" size="sm">
                        <Link href={`/admin/discounts/${offer.id}`}>Kelola</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
          <span>
            Halaman {page} dari {totalPages}
            {result ? ` · ${result.pagination.total} diskon` : ""}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1 || loading || !!error}
              onClick={() => setPage(page - 1)}
            >
              Sebelumnya
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages || loading || !!error}
              onClick={() => setPage(page + 1)}
            >
              Berikutnya
            </Button>
          </div>
        </div>
      </CardContent>

      <DiscountCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => {
          setCreateOpen(false);
          setActivationKind("all");
          setStateFilter("all");
          setPage(1);
        }}
      />
    </Card>
  );
}

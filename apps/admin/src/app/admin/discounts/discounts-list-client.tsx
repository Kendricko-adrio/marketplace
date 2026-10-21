"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Tag } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
// Discount Offer list — safe summary projection
// =========================================================
// The server owns authorization and the response shape; this client only draws
// affordances from the policy mirror. Creating a draft uses a client-generated
// request key so a double click / lost response replays the same Offer.

interface OfferSummary {
  id: string;
  key: string;
  activationKind: string;
  state: string;
  version: number;
  draftVersion: number;
  policyVersion: number;
  perClientLimit: number;
  quotaCount: number | null;
  budgetAmount: string | null;
  updatedAt: string;
  liveRevision: {
    id: string;
    name: string | null;
    minSubtotal: string | null;
    startAt: string | null;
    endAt: string | null;
    fixedAmount: string | null;
  } | null;
  draftRevisionId: string | null;
}

interface ListResponse {
  success?: boolean;
  data?: OfferSummary[];
  pagination?: { page: number; limit: number; total: number; totalPages: number };
  error?: string;
  code?: string;
}

const STATE_LABEL: Record<string, string> = {
  draft: "Draft",
  enabled: "Aktif",
  paused: "Dijeda",
  archived: "Diarsipkan",
};

function stateVariant(state: string): "default" | "secondary" | "outline" | "destructive" {
  if (state === "enabled") return "default";
  if (state === "paused") return "outline";
  if (state === "archived") return "destructive";
  return "secondary";
}

function rupiah(value: string | null): string {
  if (value === null) return "—";
  return `Rp ${Number(value).toLocaleString("id-ID")}`;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function DiscountsListClient() {
  const router = useRouter();
  const { hasPermission } = useAuth();
  const canEdit = hasPermission("discounts", "edit");

  const [offers, setOffers] = useState<OfferSummary[]>([]);
  const [stateFilter, setStateFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), limit: "10" });
      if (stateFilter !== "all") params.set("state", stateFilter);
      const response = await fetch(`/api/admin/discounts?${params.toString()}`);
      const body = (await response.json()) as ListResponse;
      if (!response.ok || !body.success) {
        setError(body.error ?? "Gagal memuat daftar diskon");
        return;
      }
      setOffers(body.data ?? []);
      setTotalPages(body.pagination?.totalPages ?? 1);
    } catch {
      setError("Gagal memuat daftar diskon");
    } finally {
      setLoading(false);
    }
  }, [page, stateFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  async function createDraft() {
    if (creating) return;
    setCreating(true);
    try {
      const response = await fetch("/api/admin/discounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestKey: crypto.randomUUID(),
          activationKind: "public",
        }),
      });
      const body = (await response.json()) as {
        success?: boolean;
        data?: { id?: string };
        error?: string;
      };
      if (!response.ok || !body.success || !body.data?.id) {
        toast.error(body.error ?? "Gagal membuat draft diskon");
        return;
      }
      toast.success("Draft diskon dibuat");
      router.push(`/admin/discounts/${body.data.id}`);
    } catch {
      toast.error("Gagal membuat draft diskon");
    } finally {
      setCreating(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Tag className="h-5 w-5" />
            Offer publik
          </CardTitle>
          <CardDescription>
            Hanya Offer fixed-goods publik. Percentage, subsidi ongkir, dan kode
            manual belum didukung pada slice ini.
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={stateFilter}
            onValueChange={(value) => {
              setPage(1);
              setStateFilter(value);
            }}
          >
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Semua status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua status</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="enabled">Aktif</SelectItem>
              <SelectItem value="paused">Dijeda</SelectItem>
              <SelectItem value="archived">Diarsipkan</SelectItem>
            </SelectContent>
          </Select>
          {canEdit ? (
            <Button onClick={() => void createDraft()} disabled={creating}>
              {creating ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Plus className="mr-2 h-4 w-4" />
              )}
              Buat draft
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        {loading ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Memuat offer…
          </div>
        ) : offers.length === 0 ? (
          <p className="py-8 text-sm text-muted-foreground">
            Belum ada Offer diskon. Buat draft untuk mulai menyusun terms.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nama / terms live</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Benefit</TableHead>
                  <TableHead>Kapasitas</TableHead>
                  <TableHead>Draft</TableHead>
                  <TableHead>Diperbarui</TableHead>
                  <TableHead className="text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {offers.map((offer) => (
                  <TableRow key={offer.id}>
                    <TableCell className="font-medium">
                      {offer.liveRevision?.name ?? "Draft belum lengkap"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={stateVariant(offer.state)}>
                        {STATE_LABEL[offer.state] ?? offer.state}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {offer.liveRevision?.fixedAmount
                        ? rupiah(offer.liveRevision.fixedAmount)
                        : "—"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {offer.quotaCount !== null
                        ? `${offer.quotaCount} pemakaian`
                        : offer.budgetAmount !== null
                          ? rupiah(offer.budgetAmount)
                          : "Belum ada batas"}
                    </TableCell>
                    <TableCell>
                      {offer.draftRevisionId ? (
                        <Badge variant="secondary">Ada draft</Badge>
                      ) : (
                        <span className="text-sm text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(offer.updatedAt)}
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

        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Halaman {page} dari {totalPages}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1 || loading}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              Sebelumnya
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages || loading}
              onClick={() => setPage((current) => current + 1)}
            >
              Berikutnya
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

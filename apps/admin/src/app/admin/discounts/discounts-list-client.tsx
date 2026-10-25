"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/providers/auth-provider";
import type { DiscountOfferSummaryDto, ListDiscountOffersResult } from "@/lib/discounts-administration";

type Kind = "public" | "manual_only";
const STATE_LABEL: Record<string, string> = { draft: "Draft", enabled: "Aktif", paused: "Dijeda", archived: "Diarsipkan" };
const CODE_STATE_LABEL: Record<string, string> = { active: "Aktif", inactive: "Nonaktif", archived: "Diarsipkan" };
function rupiah(value: string): string { return `Rp ${BigInt(value).toLocaleString("id-ID")}`; }
function benefitLabel(revision: DiscountOfferSummaryDto["liveRevision"]): string {
  if (!revision) return "Belum dipublish";
  if (revision.kind === "shipping") return `Subsidi ongkir, maks ${rupiah(revision.capAmount!)}`;
  if (revision.kind === "percentage_goods") return `${Number(revision.rate)}% barang${revision.capAmount === null ? "" : `, maks ${rupiah(revision.capAmount)}`}`;
  return revision.fixedAmount === null ? "Tidak tersedia" : `Nominal barang ${rupiah(revision.fixedAmount)}`;
}
function CapacityCell({ offer, money }: { offer: DiscountOfferSummaryDto; money?: boolean }) {
  const summary = offer.capacitySummary;
  if (!summary) return <span className="text-muted-foreground">Tidak tersedia · perlu review</span>;
  if (offer.quotaCount === null && offer.budgetAmount === null) return <span className="text-muted-foreground">Belum disetel · belum dapat publish</span>;
  const available = money ? summary.availableAmount : summary.availableCount;
  const bound = money ? offer.budgetAmount : offer.quotaCount;
  const consumed = money ? rupiah(summary.consumedAmount) : summary.consumedCount;
  const held = money ? rupiah(summary.heldAmount) : summary.heldCount;
  return <div className="space-y-1 whitespace-nowrap text-xs">
    <p className="text-sm font-medium text-foreground">{available === null ? "Tidak dibatasi" : `Tersedia ${money ? rupiah(String(available)) : available}`}</p>
    <p className="text-muted-foreground">Batas {bound === null ? "—" : money ? rupiah(String(bound)) : bound}</p>
    <p className="text-muted-foreground">Terpakai {consumed} · Ditahan {held}</p>
  </div>;
}

export function DiscountsListClient() {
  const router = useRouter();
  const { hasPermission } = useAuth();
  const canEdit = hasPermission("discounts", "edit");
  const [kind, setKind] = useState<Kind>("public");
  const [stateFilter, setStateFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<ListDiscountOffersResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ page: String(page), limit: "10", activationKind: kind });
    if (stateFilter !== "all") params.set("state", stateFilter);
    void (async () => {
      try {
        const response = await fetch(`/api/admin/discounts?${params}`, { signal: controller.signal });
        const body = await response.json() as ListDiscountOffersResult & { success?: boolean; error?: string };
        if (!response.ok || !body.success) throw new Error(body.error ?? "Gagal memuat daftar promo");
        if (active) setResult(body);
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : "Gagal memuat daftar promo");
      } finally { if (active) setLoading(false); }
    })();
    return () => { active = false; controller.abort(); };
  }, [kind, page, stateFilter]);

  async function createDraft() {
    if (creating) return;
    setCreating(true);
    try {
      const response = await fetch("/api/admin/discounts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestKey: crypto.randomUUID(), activationKind: kind }),
      });
      const body = await response.json() as { success?: boolean; data?: { id: string }; error?: string };
      if (!response.ok || !body.success || !body.data) throw new Error(body.error ?? "Gagal membuat draft promo");
      toast.success("Draft promo dibuat");
      router.push(`/admin/discounts/${body.data.id}`);
    } catch (caught) { toast.error(caught instanceof Error ? caught.message : "Gagal membuat draft promo"); }
    finally { setCreating(false); }
  }

  const totalPages = result?.pagination.totalPages ?? 1;
  return <Card className="min-w-0">
    <CardHeader>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <CardTitle><h2>Daftar promo</h2></CardTitle>
        {canEdit ? <Button onClick={() => void createDraft()} disabled={creating}>
          {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}Buat draft
        </Button> : null}
      </div>
    </CardHeader>
    <CardContent className="min-w-0 space-y-4">
      <Tabs value={kind} onValueChange={(value) => { setPage(1); setKind(value as Kind); }}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="max-w-full overflow-x-auto">
          <TabsList aria-label="Jalur promo">
            <TabsTrigger value="public">Kupon publik ({result?.countsByActivationKind.public ?? "—"})</TabsTrigger>
            <TabsTrigger value="manual_only">Kode promo ({result?.countsByActivationKind.manual_only ?? "—"})</TabsTrigger>
          </TabsList>
          </div>
          <Select value={stateFilter} onValueChange={(value) => { setPage(1); setStateFilter(value); }}>
            <SelectTrigger className="w-40" aria-label="Filter status promo"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua status</SelectItem>
              {Object.entries(STATE_LABEL).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <p className="my-4 text-xs text-muted-foreground">Kuota dan budget berlaku global, bukan reservasi kuota.</p>
        <TabsContent value={kind} className="min-w-0 space-y-4">
          {error ? <p role="alert" className="rounded-md border border-destructive/40 p-3 text-sm text-destructive">{error}</p>
            : loading ? <p role="status" className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Memuat promo…</p>
            : !result?.data.length ? <p className="py-8 text-sm text-muted-foreground">Belum ada {kind === "public" ? "kupon publik" : "kode promo"} pada filter ini.</p>
            : <div className="max-w-full overflow-x-auto rounded-md border">
              <Table aria-label="Daftar promo">
                <TableHeader><TableRow>
                  {["Nama promo / identitas", "Jalur", "Benefit", "Status", "Revision live", "Kuota tersedia", "Budget tersedia", "Kode", "Aksi"].map((label) => <TableHead key={label} className={label === "Aksi" ? "sticky right-0 z-10 border-l bg-card text-right" : undefined}>{label}</TableHead>)}
                </TableRow></TableHeader>
                <TableBody>{result.data.map((offer) => <TableRow key={offer.id}>
                  <TableCell className="min-w-40 font-medium">{offer.liveRevision?.name ?? "Draft belum dipublish"}<p className="mt-1 font-mono text-xs font-normal text-muted-foreground">ID {offer.key.slice(0, 8)}</p>{offer.draftRevisionId ? <Badge className="mt-1" variant="secondary">Ada draft</Badge> : null}</TableCell>
                  <TableCell>{offer.activationKind === "public" ? "Kupon publik" : "Kode promo"}</TableCell>
                  <TableCell className="min-w-40">{benefitLabel(offer.liveRevision)}</TableCell>
                  <TableCell><Badge variant={offer.state === "enabled" ? "default" : "outline"}>{STATE_LABEL[offer.state]}</Badge></TableCell>
                  <TableCell className="whitespace-nowrap">{offer.liveRevision ? `Revision ${offer.liveRevision.revisionNo}` : "Belum dipublish"}</TableCell>
                  <TableCell><CapacityCell offer={offer} /></TableCell>
                  <TableCell><CapacityCell offer={offer} money /></TableCell>
                  <TableCell>{offer.codes.length ? <div className="space-y-1 text-xs"><p>{offer.codeCount} kode · disamarkan</p>{offer.codes.map((code) => <p key={code.id} className="whitespace-nowrap font-mono">{code.maskedCode} · {CODE_STATE_LABEL[code.state]}</p>)}</div> : "—"}</TableCell>
                  <TableCell className="sticky right-0 z-10 border-l bg-card text-right"><Button asChild variant="outline" size="sm"><Link href={`/admin/discounts/${offer.id}`}>Kelola</Link></Button></TableCell>
                </TableRow>)}</TableBody>
              </Table>
            </div>}
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
            <span>Halaman {page} dari {totalPages}</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1 || loading || !!error} onClick={() => setPage(page - 1)}>Sebelumnya</Button>
              <Button variant="outline" size="sm" disabled={page >= totalPages || loading || !!error} onClick={() => setPage(page + 1)}>Berikutnya</Button>
            </div>
          </div>
        </TabsContent>
      </Tabs>
      <details className="rounded-md border px-4 py-3 text-sm">
        <summary className="cursor-pointer font-medium text-foreground">Tentang promo</summary>
        <div className="mt-3 space-y-2 text-muted-foreground">
          <p>Kupon publik dipilih customer di checkout; kode promo dimasukkan manual.</p>
          <p>Satu promo memiliki satu benefit dan satu jalur. Kupon barang, kode promo, dan subsidi ongkir memakai satu slot promosi per order; harga coret tetap berlaku di luar slot tersebut.</p>
          <p>Simpan draft, review perubahan, lalu publish. Menyimpan draft tidak mengubah promo yang sedang aktif.</p>
          <p>Ditahan adalah kapasitas yang dicadangkan untuk order. Ketersediaan bukan jaminan kuota saat checkout.</p>
        </div>
      </details>
    </CardContent>
  </Card>;
}

"use client";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { DELIVERY_STAGE_LABELS, type DeliveryStage } from "@/lib/delivery-workflow";
import { useAuth } from "@/providers/auth-provider";
const KINDS = { all: "Semua kendala", settlement: "Settlement tertahan", packing: "Packing gagal", booking: "Booking ambigu", shipment: "Kendala pengiriman" };
type Row = { orderId: string; kind: string; stage: DeliveryStage; paymentStatus: string; serviceName?: string | null; destinationSummary?: string | null };
export default function DeliveryFollowUpPage() { return <Suspense fallback={<p>Memuat tindak lanjut…</p>}><FollowUp /></Suspense>; }
function FollowUp() {
  const router = useRouter(); const query = useSearchParams();
  const { policyStatus, hasPermission } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [pagination, setPagination] = useState({ page: 1, total: 0, baseTotal: 0, totalPages: 0 });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const currentUrl = `/admin/orders/follow-up?${query}`;
  function change(key: string, value: string) {
    const next = new URLSearchParams(query.toString()); if (value) next.set(key, value); else next.delete(key);
    if (key !== "page") next.delete("page"); router.replace(`/admin/orders/follow-up?${next}`);
  }
  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true); setError("");
      try {
        const response = await fetch(`/api/admin/orders/follow-up?${query}`); const body = await response.json();
        if (!response.ok || !body.success) throw new Error("read failed");
        if (active) {
          setRows(body.data); setPagination(body.pagination);
          if (Number(query.get("page") ?? 1) !== body.pagination.page) { const next = new URLSearchParams(query.toString()); next.set("page", String(body.pagination.page)); router.replace(`/admin/orders/follow-up?${next}`); }
        }
      } catch { if (active) { setRows([]); setError("Daftar tindak lanjut belum berhasil dimuat."); } }
      finally { if (active) setLoading(false); }
    }
    void load(); return () => { active = false; };
  }, [query, router]);
  if (policyStatus !== "ready" || !hasPermission("orders", "view")) return null;
  return <div className="min-w-0 max-w-5xl space-y-4">
    <Button variant="ghost" onClick={() => { const previous = query.get("returnTo"); router.push(previous && /^\/admin\/orders(?:\?|$)/.test(previous) ? previous : "/admin/orders"); }}>Back to Orders</Button>
    <h1 className="text-2xl font-bold">Tindak lanjut pengiriman</h1>
    <div className="flex flex-wrap gap-3">
      <label className="grid gap-1 text-sm">Jenis Kendala<select aria-label="Jenis Kendala" className="h-9 rounded-md border px-3" value={query.get("kind") ?? "all"} onChange={(event) => change("kind", event.target.value)}>{Object.entries(KINDS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label className="grid gap-1 text-sm">Tahap delivery<select aria-label="Tahap delivery" className="h-9 rounded-md border px-3" value={query.get("stage") ?? ""} onChange={(event) => change("stage", event.target.value)}><option value="">Semua tahap</option>{DELIVERY_STAGE_LABELS.map((label) => <option key={label}>{label}</option>)}</select></label>
    </div>
    <p role="status">{loading ? "Memuat tindak lanjut…" : `${pagination.total} hasil dari ${pagination.baseTotal} tanpa batas tanggal`}</p>
    {error && <p role="alert">{error}</p>}
    {!loading && rows.length === 0 && <p>Tidak ada tindak lanjut yang cocok. Sesuaikan jenis kendala atau tahap.</p>}
    {rows.map((row) => <article key={row.orderId} className="space-y-2 rounded-lg border bg-card p-4"><p className="text-xs text-muted-foreground">{KINDS[row.kind as keyof typeof KINDS]} · {row.paymentStatus}</p><h2 className="font-semibold">{row.stage.label}</h2><p>{row.stage.guidance}</p>{row.serviceName && <p className="text-sm text-muted-foreground">{row.serviceName}</p>}{row.destinationSummary && <p className="text-sm text-muted-foreground">{row.destinationSummary}</p>}<Link className="text-teal-800 underline" href={`/admin/orders/${row.orderId}?returnTo=${encodeURIComponent(currentUrl)}#special-handling`}>Buka detail pesanan</Link></article>)}
    <div className="flex flex-wrap items-center gap-3"><Button variant="outline" disabled={pagination.page <= 1 || loading} onClick={() => change("page", String(pagination.page - 1))}>Previous</Button><span>Halaman {pagination.page} / {Math.max(1, pagination.totalPages)}</span><Button variant="outline" disabled={pagination.page >= pagination.totalPages || loading} onClick={() => change("page", String(pagination.page + 1))}>Next</Button></div>
  </div>;
}

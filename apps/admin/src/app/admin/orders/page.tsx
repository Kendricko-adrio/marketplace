"use client";

import { Suspense, useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/providers/auth-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DELIVERY_STAGE_LABELS, type DeliveryStage } from "@/lib/delivery-workflow";

type Row = { id: string; createdAt: string; status: string; paymentStatus: string; total: string; fulfillmentMethod: string; customer: { name: string }; branch: { name: string } | null; stage?: DeliveryStage; stockNeedsReview?: boolean };
const QUEUES = { actionable: "Perlu dikerjakan", followup: "Tindak lanjut", monitoring: "Monitoring", completed: "Selesai", all: "Semua delivery" };
const STATUS = { pending_payment: "Pending Payment", processing: "Processing", ready_for_pickup: "Ready for Pickup", completed: "Completed", cancelled: "Cancelled", failed_payment: "Payment Failed" };
const selectClass = "h-9 max-w-full rounded-md border bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-teal-700";

export default function AdminOrdersPage() {
  return <Suspense fallback={<p>Memuat pesanan…</p>}><OrdersList /></Suspense>;
}
function OrdersList() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const query = useSearchParams();
  const { policy, policyStatus, hasPermission } = useAuth();
  const tab = query.get("tab") ?? "delivery";
  const queue = query.get("queue") ?? "actionable";
  const page = Number(query.get("page") ?? 1);
  const [rows, setRows] = useState<Row[]>([]);
  const [pagination, setPagination] = useState({ total: 0, baseTotal: 0, totalPages: 0, page: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [branches, setBranches] = useState<Array<{ id: string; name: string }>>([]);
  const allScope = policy?.grants.some((grant) => grant.module === "orders" && grant.action === "view" && grant.scope === "all_branches") || policy?.role.key === "system_owner";
  const currentUrl = `/admin/orders${query.toString() ? `?${query}` : ""}`;
  function change(key: string, value: string) {
    const next = new URLSearchParams(query.toString());
    if (value) next.set(key, value); else next.delete(key);
    if (key !== "page") next.delete("page");
    if (key === "tab") { next.delete("stage"); next.delete("status"); next.delete("queue"); }
    if (key === "queue" && value === "followup") {
      router.push(`/admin/orders/follow-up?returnTo=${encodeURIComponent(currentUrl)}`);
      return;
    }
    startTransition(() => router.replace(`/admin/orders?${next}`));
  }
  useEffect(() => {
    if (!allScope || !hasPermission("branches", "view")) return;
    let active = true;
    fetch("/api/admin/branches?limit=100").then((response) => response.json()).then((body) => { if (active && body.success) setBranches(body.data); }).catch(() => {});
    return () => { active = false; };
  }, [allScope, hasPermission]);
  useEffect(() => {
    let active = true;
    const params = new URLSearchParams(query.toString());
    params.delete("tab");
    if (tab !== "all") params.set("fulfillment", tab);
    if (tab === "delivery") params.set("queue", queue);
    params.set("limit", "20");
    async function load() {
      setLoading(true); setError("");
      try {
        const response = await fetch(`/api/admin/orders?${params}`);
        const body = await response.json();
        if (!response.ok || !body.success) throw new Error("read failed");
        if (!active) return;
        setRows(body.data); setPagination({ ...body.pagination, baseTotal: body.pagination.baseTotal ?? body.pagination.total });
        if (body.pagination.page !== page) {
          const next = new URLSearchParams(query.toString()); next.set("page", String(body.pagination.page)); router.replace(`/admin/orders?${next}`);
        }
      } catch { if (active) { setRows([]); setError("Daftar belum berhasil dimuat. Muat ulang halaman."); } }
      finally { if (active) setLoading(false); }
    }
    void load();
    return () => { active = false; };
  }, [query, tab, queue, page, router]);
  if (policyStatus !== "ready" || !hasPermission("orders", "view")) return null;
  return <div className="min-w-0 space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-2xl font-bold">Orders</h2><Link className="text-sm text-teal-800 underline" href={`/admin/orders/follow-up?returnTo=${encodeURIComponent(currentUrl)}`}>Tindak lanjut pengiriman</Link></div>
    <div role="tablist" aria-label="Jenis pesanan" className="flex gap-2">{[["delivery", "Delivery"], ["pickup", "Pickup"], ["all", "Semua"]].map(([key, label]) => <Button key={key} role="tab" aria-selected={tab === key} variant={tab === key ? "default" : "outline"} onClick={() => change("tab", key)}>{label}</Button>)}</div>
    <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-4">
      {tab === "delivery" && <><label className="grid gap-1 text-xs font-medium">Pekerjaan delivery<select aria-label="Pekerjaan delivery" className={selectClass} value={queue} onChange={(event) => change("queue", event.target.value)}>{Object.entries(QUEUES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label className="grid gap-1 text-xs font-medium">Tahap delivery<select aria-label="Tahap delivery" className={selectClass} value={query.get("stage") ?? ""} onChange={(event) => change("stage", event.target.value)}><option value="">Semua tahap</option>{DELIVERY_STAGE_LABELS.map((label) => <option key={label}>{label}</option>)}</select></label></>}
      {tab !== "delivery" && <label className="grid gap-1 text-xs font-medium">Status order<select aria-label="Status order" className={selectClass} value={query.get("status") ?? ""} onChange={(event) => change("status", event.target.value)}><option value="">Semua status</option>{Object.entries(STATUS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>}
      <label className="grid gap-1 text-xs font-medium">Cari pesanan<Input aria-label="Cari pesanan" placeholder="ID, customer, phone" value={query.get("search") ?? ""} onChange={(event) => change("search", event.target.value)} /></label>
      {allScope && <label className="grid gap-1 text-xs font-medium">Cabang<select aria-label="Cabang" className={selectClass} value={query.get("branchId") ?? ""} onChange={(event) => change("branchId", event.target.value)}><option value="">Semua cabang</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>}
      {[["from", "Tanggal order dari"], ["to", "Tanggal order sampai"], ...(tab === "pickup" ? [["pickupFrom", "Tanggal pickup dari"], ["pickupTo", "Tanggal pickup sampai"]] : [])].map(([key, label]) => <label key={key} className="grid gap-1 text-xs font-medium">{label}<Input aria-label={label} type="date" className="w-40" value={query.get(key) ?? ""} onChange={(event) => change(key, event.target.value)} /></label>)}
    </div>
    {(query.get("from") || query.get("to")) && <p className="text-sm text-amber-800">Tanggal pembuatan {query.get("from") ?? "awal"} – {query.get("to") ?? "sekarang"} mempersempit hasil. Order lama yang belum selesai dapat tersembunyi. Bukan penilaian SLA.</p>}
    <p role="status" className="text-sm text-muted-foreground">{loading ? "Memuat pesanan…" : `${pagination.total} hasil dari ${pagination.baseTotal} tanpa batas tanggal · 20 per halaman`}</p>
    {error && <p role="alert">{error}</p>}
    <div className="min-w-0 max-w-full overflow-x-auto rounded-md border bg-card">
      <Table className="min-w-[760px]">
        <TableHeader>
          <TableRow>
            {["Referensi / tanggal", "Customer", "Asal kirim", "Payment", tab === "delivery" ? "Tahap delivery" : "Status", "Langkah berikutnya", "Detail"].map((label) => <TableHead key={label}>{label}</TableHead>)}
          </TableRow>
        </TableHeader>
        <TableBody>
          {!loading && rows.length === 0 ? (
            <TableRow><TableCell colSpan={7} className="h-24 text-center">Tidak ada pesanan yang cocok. Sesuaikan pekerjaan, tahap, pencarian atau tanggal.</TableCell></TableRow>
          ) : rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell><span className="font-mono font-semibold">#{row.id.slice(0, 8)}</span><div className="mt-1 text-xs text-muted-foreground">{new Date(row.createdAt).toLocaleDateString("id-ID")}</div></TableCell>
              <TableCell>{row.customer.name}</TableCell>
              <TableCell>{row.branch?.name ?? "Belum tersedia"}</TableCell>
              <TableCell><Badge variant="outline">{row.paymentStatus}</Badge></TableCell>
              <TableCell><Badge variant="outline">{row.stage?.label ?? STATUS[row.status as keyof typeof STATUS] ?? row.status}</Badge>{row.stockNeedsReview && <span className="block text-xs text-amber-800">Stock review</span>}</TableCell>
              <TableCell className="max-w-64">{row.stage?.guidance ?? (row.status === "ready_for_pickup" ? "Verifikasi pickup setelah customer hadir." : "Lihat detail pesanan.")}</TableCell>
              <TableCell><Link aria-disabled={isPending || loading} onClick={(event) => { if (isPending || loading) event.preventDefault(); }} className="text-teal-800 underline focus-visible:outline-2" href={`/admin/orders/${row.id}?returnTo=${encodeURIComponent(currentUrl)}`}>Lihat detail</Link>{row.fulfillmentMethod === "pickup" && row.status === "ready_for_pickup" && hasPermission("orders", "edit") && <Link className="block text-teal-800 underline" href={`/admin/orders/${row.id}?verify=1&returnTo=${encodeURIComponent(currentUrl)}`}>Verifikasi Pickup</Link>}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
    <div className="flex flex-wrap items-center gap-3"><Button variant="outline" disabled={page <= 1 || loading} onClick={() => change("page", String(page - 1))}>Previous</Button><span>Halaman {pagination.page} / {Math.max(1, pagination.totalPages)}</span><Button variant="outline" disabled={page >= pagination.totalPages || loading} onClick={() => change("page", String(page + 1))}>Next</Button></div>
  </div>;
}

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ClientAddressInput, ClientAddressView } from "@/lib/client-addresses";
import type { RegionLevel, ShipmentRegion } from "@/lib/shipment-regions";

const blank: ClientAddressInput = { recipientName: "", phone: "", fullAddress: "", provinceId: "", cityId: "", districtId: "", areaId: "", postalCode: "", isDefault: false };
const levels: RegionLevel[] = ["provinces", "cities", "districts", "areas"];
const names = ["Provinsi", "Kota/Kabupaten", "Kecamatan", "Kelurahan/Area"];
const fields = ["provinceId", "cityId", "districtId", "areaId"] as const;

function RegionPicker({ index, value, parentId, onChange }: { index: number; value: string; parentId?: string; onChange: (id: string, postal?: string) => void }) {
  const [options, setOptions] = useState<ShipmentRegion[]>([]);
  const [loading, setLoading] = useState(index === 0 || Boolean(parentId));
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    if (index > 0 && !parentId) return () => controller.abort();
    fetch(`/api/shipment/regions?level=${levels[index]}${parentId ? `&parentId=${encodeURIComponent(parentId)}` : ""}`, { signal: controller.signal })
      .then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(); return body.data as ShipmentRegion[]; })
      .then((data) => { if (!controller.signal.aborted) setOptions(data); })
      .catch(() => { if (!controller.signal.aborted) setError(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [index, parentId, retry]);
  return <div className="space-y-2">
    <Label htmlFor={fields[index]}>{names[index]}</Label>
    <Select value={value} disabled={loading || (index > 0 && !parentId) || error} onValueChange={(id) => onChange(id, options.find((row) => row.id === id)?.postalCode)}>
      <SelectTrigger id={fields[index]}><SelectValue placeholder={loading ? "Memuat wilayah…" : `Pilih ${names[index]}`} /></SelectTrigger>
      <SelectContent>{options.map((row) => <SelectItem key={row.id} value={row.id}>{row.name}</SelectItem>)}</SelectContent>
    </Select>
    {error && <Button type="button" variant="outline" onClick={() => { setError(false); setLoading(true); setRetry((r) => r + 1); }}>Coba lagi</Button>}
  </div>;
}

export default function AddressBookPage() {
  const [rows, setRows] = useState<ClientAddressView[]>([]);
  const [input, setInput] = useState<ClientAddressInput>(blank);
  const [editing, setEditing] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  async function load() {
    setLoading(true);
    try {
      const response = await fetch("/api/addresses"); const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setRows(body.data);
    } catch { setError("Buku alamat belum tersedia. Coba lagi."); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  async function mutation(path: string, method: string, body?: ClientAddressInput) {
    setBusy(true); setError("");
    try {
      const response = await fetch(path, { method, headers: { "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error);
      await load();
      return true;
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Alamat belum dapat disimpan."); return false; }
    finally { setBusy(false); }
  }
  const ready = input.recipientName.trim() && input.phone.trim() && input.fullAddress.trim() && input.areaId && input.postalCode;
  return <main className="container mx-auto max-w-4xl px-4 py-10">
    <Link href="/account" className="text-sm text-muted-foreground">← Akun saya</Link>
    <div className="my-6 flex items-center justify-between gap-4"><div><p className="text-xs uppercase tracking-widest text-muted-foreground">Tujuan pengiriman</p><h1 className="text-3xl font-semibold">Buku alamat</h1><p className="mt-2 text-sm text-muted-foreground">Alamat penerima milik Anda. Perubahan tidak mengubah pesanan yang sudah dibuat.</p></div><Button onClick={() => { setEditing(null); setInput({ ...blank }); setShowForm(true); }}>Tambah alamat</Button></div>
    {error && <div role="alert" className="mb-5 rounded border border-destructive p-4 text-sm">{error}<Button variant="ghost" onClick={() => void load()}>Coba lagi</Button></div>}
    {showForm && <form className="mb-8 space-y-5 rounded-xl border bg-card p-6" onSubmit={async (event) => { event.preventDefault(); if (await mutation(editing ? `/api/addresses/${editing}` : "/api/addresses", editing ? "PATCH" : "POST", input)) setShowForm(false); }}>
      <h2 className="text-xl font-medium">{editing ? "Edit alamat" : "Alamat baru"}</h2>
      <div className="grid gap-5 sm:grid-cols-2">{([ ["recipientName", "Nama Penerima"], ["phone", "Nomor Telepon"] ] as const).map(([key, label]) => <div className="space-y-2" key={key}><Label htmlFor={key}>{label}</Label><Input id={key} required value={input[key]} onChange={(event) => setInput((prev) => ({ ...prev, [key]: event.target.value }))} /></div>)}
      {fields.map((field, index) => <RegionPicker key={`${field}:${index > 0 ? input[fields[index - 1]] : "root"}`} index={index} value={input[field]} parentId={index > 0 ? input[fields[index - 1]] : undefined} onChange={(id, postal) => setInput((prev) => { const next = { ...prev, [field]: id, postalCode: postal ?? "" }; for (let n = index + 1; n < fields.length; n++) next[fields[n]] = ""; return next; })} />)}
      <div className="space-y-2"><Label htmlFor="postalCode">Kode Pos</Label><Input id="postalCode" value={input.postalCode} readOnly /></div></div>
      <div className="space-y-2"><Label htmlFor="fullAddress">Alamat Lengkap</Label><Input id="fullAddress" required value={input.fullAddress} placeholder="Jalan, nomor rumah, unit, dan patokan" onChange={(event) => setInput((prev) => ({ ...prev, fullAddress: event.target.value }))} /></div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={input.isDefault} onChange={(event) => setInput((prev) => ({ ...prev, isDefault: event.target.checked }))} />Jadikan alamat utama</label>
      <div className="flex gap-3"><Button disabled={busy || !ready}>Simpan alamat</Button><Button type="button" variant="outline" onClick={() => setShowForm(false)}>Batal</Button></div>
    </form>}
    {loading ? <p>Memuat alamat…</p> : <div className="grid gap-4 sm:grid-cols-2">{rows.map((row) => <article key={row.id} className="flex flex-col rounded-xl border bg-card p-6">
      <h2 className="font-semibold">{row.recipientName}{row.isDefault && <span className="ml-3 text-xs text-primary">Utama</span>}</h2>
      <p className="mt-2 text-sm">{row.phone}</p><p className="mt-3">{row.fullAddress}</p><p className="mt-1 text-sm text-muted-foreground">{[row.area, row.district, row.city, row.province, row.postalCode].filter(Boolean).join(", ")}</p>
      <div className="mt-5 flex flex-wrap gap-2">{!row.isDefault && <Button variant="outline" disabled={busy} onClick={() => void mutation(`/api/addresses/${row.id}/default`, "POST")}>Jadikan utama</Button>}<Button variant="outline" disabled={busy} onClick={() => { setEditing(row.id); setInput({ recipientName: row.recipientName, phone: row.phone, fullAddress: row.fullAddress, provinceId: row.provinceId, cityId: row.cityId, districtId: row.districtId, areaId: row.areaId, postalCode: row.postalCode, isDefault: row.isDefault }); setShowForm(true); }}>Edit</Button><Button variant="ghost" disabled={busy} onClick={() => void mutation(`/api/addresses/${row.id}`, "DELETE")}>Hapus</Button></div>
    </article>)}{rows.length === 0 && <p className="text-muted-foreground">Belum ada alamat tersimpan.</p>}</div>}
  </main>;
}

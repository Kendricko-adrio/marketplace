"use client";

import { useEffect, useState } from "react";
import type { RegionLevel, ShipmentRegion } from "@marketplace/db/src/shipment-regions";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";

export type DayHours = { open: string; close: string } | null;

export type OperatingHours = {
  monday?: DayHours;
  tuesday?: DayHours;
  wednesday?: DayHours;
  thursday?: DayHours;
  friday?: DayHours;
  saturday?: DayHours;
  sunday?: DayHours;
};

export interface BranchFormData {
  name: string;
  code: string;
  city: string;
  address: string;
  latitude: string;
  longitude: string;
  operatingHours: OperatingHours;
  googleMapsUrl: string;
  status: "aktif" | "nonaktif";
  // Shipment hierarchy is required; sender details remain optional on save.
  shippingPhone: string;
  shippingAddress: string;
  shippingPostalCode: string;
  shippingAreaId: string;
  shippingProvinceId: string;
  shippingCityId: string;
  shippingDistrictId: string;
}

interface BranchFormProps {
  mode: "create" | "edit";
  initialData?: BranchFormData;
  regionConfigured?: boolean;
  onSubmit: (data: BranchFormData) => Promise<void>;
}

const DAY_KEYS = [
  { key: "monday", label: "Senin" },
  { key: "tuesday", label: "Selasa" },
  { key: "wednesday", label: "Rabu" },
  { key: "thursday", label: "Kamis" },
  { key: "friday", label: "Jumat" },
  { key: "saturday", label: "Sabtu" },
  { key: "sunday", label: "Minggu" },
] as const;

const REGION_SELECTORS = [
  { level: "provinces", field: "shippingProvinceId", label: "Provinsi Pengiriman" },
  { level: "cities", field: "shippingCityId", label: "Kota/Kabupaten Pengiriman" },
  { level: "districts", field: "shippingDistrictId", label: "Kecamatan Pengiriman" },
  { level: "areas", field: "shippingAreaId", label: "Kelurahan/Desa Pengiriman" },
] as const;

function useRegionOptions(level: RegionLevel, parentId?: string, generation = 0) {
  const [retry, setRetry] = useState(0);
  const key = `${level}:${parentId ?? ""}:${generation}:${retry}`;
  const enabled = level === "provinces" || !!parentId;
  const [result, setResult] = useState<{ key: string; options: ShipmentRegion[]; error: boolean } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let ignore = false;
    const controller = new AbortController();
    async function load() {
      try {
        const query = new URLSearchParams({ level, ...(parentId ? { parentId } : {}) });
        const response = await fetch(`/api/admin/shipment/regions?${query}`, { signal: controller.signal });
        const body = await response.json();
        if (!response.ok || !body.success || !Array.isArray(body.data)) throw new Error("Unavailable");
        if (!ignore) setResult({ key, options: body.data, error: false });
      } catch {
        if (!ignore) setResult({ key, options: [], error: true });
      }
    }
    void load();
    return () => { ignore = true; controller.abort(); };
  }, [enabled, level, parentId, key]);
  const current = result?.key === key ? result : null;
  return { options: enabled ? current?.options ?? [] : [], loading: enabled && !current, error: enabled && !!current?.error, retry: () => setRetry((n) => n + 1) };
}

export default function BranchForm({
  mode,
  initialData,
  regionConfigured,
  onSubmit,
}: BranchFormProps) {
  const [formData, setFormData] = useState<BranchFormData>(
    initialData ?? {
      name: "",
      code: "",
      city: "",
      address: "",
      latitude: "",
      longitude: "",
      operatingHours: {
        monday: { open: "09:00", close: "21:00" },
        tuesday: { open: "09:00", close: "21:00" },
        wednesday: { open: "09:00", close: "21:00" },
        thursday: { open: "09:00", close: "21:00" },
        friday: { open: "09:00", close: "21:00" },
        saturday: { open: "09:00", close: "21:00" },
        sunday: null,
      },
      googleMapsUrl: "",
      status: "aktif",
      shippingPhone: "",
      shippingAddress: "",
      shippingPostalCode: "",
      shippingAreaId: "",
      shippingProvinceId: "",
      shippingCityId: "",
      shippingDistrictId: "",
    }
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [regionGenerations, setRegionGenerations] = useState([0, 0, 0, 0]);
  const provinces = useRegionOptions("provinces");
  const cities = useRegionOptions("cities", formData.shippingProvinceId, regionGenerations[1]);
  const districts = useRegionOptions("districts", formData.shippingCityId, regionGenerations[2]);
  const areas = useRegionOptions("areas", formData.shippingDistrictId, regionGenerations[3]);
  const lookups = [provinces, cities, districts, areas];
  const selectedArea = areas.options.find((area) => area.id === formData.shippingAreaId);
  const regionReady = REGION_SELECTORS.every(({ field }, i) =>
    !lookups[i].loading && !lookups[i].error && lookups[i].options.some((option) => option.id === formData[field])
  ) && !!selectedArea?.postalCode && selectedArea.postalCode === formData.shippingPostalCode;
  const legacy = mode === "edit" && (regionConfigured === false || !initialData?.shippingProvinceId || !initialData.shippingCityId || !initialData.shippingDistrictId || !initialData.shippingAreaId || !initialData.shippingPostalCode);

  function changeRegion(index: number, value: string) {
    // A → B → A is a new request, not permission to reuse A's cached options.
    setRegionGenerations((previous) => previous.map((generation, i) => i > index ? generation + 1 : generation));
    setFormData((previous) => {
      const next = { ...previous, [REGION_SELECTORS[index].field]: value, shippingPostalCode: "" };
      for (let i = index + 1; i < REGION_SELECTORS.length; i++) next[REGION_SELECTORS[i].field] = "";
      if (index === 3) next.shippingPostalCode = areas.options.find((option) => option.id === value)?.postalCode ?? "";
      return next;
    });
  }

  function updateField<K extends keyof BranchFormData>(
    key: K,
    value: BranchFormData[K]
  ) {
    setFormData((prev) => ({ ...prev, [key]: value }));
  }

  function updateDayHours(
    dayKey: keyof OperatingHours,
    field: "open" | "close",
    value: string
  ) {
    setFormData((prev) => {
      const current = prev.operatingHours[dayKey];
      if (!current) return prev;
      return {
        ...prev,
        operatingHours: {
          ...prev.operatingHours,
          [dayKey]: { ...current, [field]: value },
        },
      };
    });
  }

  function toggleDayOpen(dayKey: keyof OperatingHours, open: boolean) {
    setFormData((prev) => ({
      ...prev,
      operatingHours: {
        ...prev.operatingHours,
        [dayKey]: open ? { open: "09:00", close: "21:00" } : null,
      },
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!regionReady || submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      await onSubmit({
        ...formData,
        code: formData.code.toUpperCase(),
      });
      toast.success(
        mode === "create"
          ? "Cabang berhasil dibuat"
          : "Perubahan cabang tersimpan"
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Terjadi kesalahan";
      setError(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      {error && (
        <div className="bg-destructive/10 text-destructive text-sm p-3 rounded-md">
          {error}
        </div>
      )}

      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Informasi Cabang</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="name">Nama Cabang</Label>
            <Input
              id="name"
              value={formData.name}
              onChange={(e) => updateField("name", e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="code">Kode Cabang</Label>
            <Input
              id="code"
              value={formData.code}
              onChange={(e) => updateField("code", e.target.value.toUpperCase())}
              placeholder="cth. JKT-01"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="city">Kota</Label>
            <Input
              id="city"
              value={formData.city}
              onChange={(e) => updateField("city", e.target.value)}
              required
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="address">Alamat</Label>
            <Textarea
              id="address"
              rows={3}
              value={formData.address}
              onChange={(e) => updateField("address", e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="latitude">Latitude (koordinat manual)</Label>
            <Input
              id="latitude"
              type="text"
              inputMode="decimal"
              placeholder="-6.1944"
              value={formData.latitude}
              onChange={(e) => updateField("latitude", e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="longitude">Longitude (koordinat manual)</Label>
            <Input
              id="longitude"
              type="text"
              inputMode="decimal"
              placeholder="106.8229"
              value={formData.longitude}
              onChange={(e) => updateField("longitude", e.target.value)}
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="googleMapsUrl">Link Google Maps (opsional)</Label>
            <Input
              id="googleMapsUrl"
              type="url"
              placeholder="https://www.google.com/maps/..."
              value={formData.googleMapsUrl}
              onChange={(e) => updateField("googleMapsUrl", e.target.value)}
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="status">Status</Label>
            <div className="flex items-center gap-3 rounded-lg border p-3">
              <Switch
                id="status"
                checked={formData.status === "aktif"}
                onCheckedChange={(checked) =>
                  updateField("status", checked ? "aktif" : "nonaktif")
                }
              />
              <Label
                htmlFor="status"
                className="font-normal cursor-pointer text-sm"
              >
                {formData.status === "aktif"
                  ? "Cabang aktif (tampil di toko)"
                  : "Cabang nonaktif (tidak tampil di toko)"}
              </Label>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Asal Pengiriman</h3>
        <p className="text-sm text-muted-foreground">Wilayah Shipment wajib dipilih untuk semua cabang. Tidak mengubah kota atau alamat umum cabang.</p>
        {legacy && <p role="status" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">Wilayah pengiriman cabang belum lengkap. Lengkapi pilihan sebelum menyimpan perubahan.</p>}
        <div className="grid gap-4 sm:grid-cols-2">
          {REGION_SELECTORS.map(({ field, label }, index) => {
            const lookup = lookups[index];
            const value = formData[field];
            const parentExists = index === 0 || !!formData[REGION_SELECTORS[index - 1].field];
            const missing = !!value && !lookup.loading && !lookup.error && !lookup.options.some((option) => option.id === value);
            return <div key={field} className="space-y-2">
              <Label htmlFor={field}>{label}</Label>
              <select id={field} required value={value} disabled={submitting || !parentExists || lookup.loading || lookup.error}
                className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm disabled:opacity-50"
                onChange={(event) => changeRegion(index, event.target.value)}>
                <option value="">{lookup.loading ? "Memuat wilayah…" : "Pilih wilayah"}</option>
                {value && !lookup.options.some((option) => option.id === value) && <option value={value}>Pilihan tersimpan perlu diverifikasi</option>}
                {lookup.options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
              </select>
              {missing && <p role="alert" className="text-destructive text-sm">Wilayah tersimpan tidak tersedia. Pilih ulang wilayah ini.</p>}
              {lookup.error && <div role="alert" className="text-destructive text-sm">Gagal memuat wilayah. <Button type="button" variant="outline" size="sm" onClick={lookup.retry}>Coba lagi — {label}</Button></div>}
            </div>;
          })}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="shippingPhone">Telepon Pengirim</Label>
            <Input
              id="shippingPhone"
              type="tel"
              inputMode="tel"
              placeholder="021999888777"
              value={formData.shippingPhone}
              onChange={(e) => updateField("shippingPhone", e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="shippingPostalCode">Kode Pos Asal Kirim</Label>
            <Input
              id="shippingPostalCode"
              type="text"
              inputMode="numeric"
              placeholder="Pilih kelurahan terlebih dahulu"
              value={formData.shippingPostalCode}
              readOnly
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="shippingAddress">Alamat Asal Kirim</Label>
            <Textarea
              id="shippingAddress"
              rows={2}
              placeholder="Alamat lengkap pengirim untuk pickup kurir"
              value={formData.shippingAddress}
              onChange={(e) => updateField("shippingAddress", e.target.value)}
            />
          </div>

        </div>
        <p className="text-sm text-muted-foreground">
          Kode pos berasal dari kelurahan Shipment. Nama cabang dipakai sebagai nama pengirim.
          Telepon dan alamat pengirim boleh kosong saat menyimpan, tetapi wajib untuk delivery.
          {selectedArea && selectedArea.postalCode !== formData.shippingPostalCode && " Kode pos tersimpan sudah tidak cocok. Pilih ulang kelurahan sebelum menyimpan."}
        </p>
      </div>

      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Jam Operasional</h3>
        <div className="space-y-3">
          {DAY_KEYS.map(({ key, label }) => {
            const hours = formData.operatingHours[key] ?? null;
            const isOpen = hours !== null;
            return (
              <div
                key={key}
                className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-lg border p-3"
              >
                <div className="flex items-center gap-3 w-40">
                  <Switch
                    checked={isOpen}
                    onCheckedChange={(checked) => toggleDayOpen(key, checked)}
                  />
                  <Label className="font-medium">{label}</Label>
                </div>
                {isOpen ? (
                  <div className="flex items-center gap-2 flex-1">
                    <Input
                      type="time"
                      value={hours.open}
                      onChange={(e) =>
                        updateDayHours(key, "open", e.target.value)
                      }
                      className="w-32"
                    />
                    <span className="text-muted-foreground">s/d</span>
                    <Input
                      type="time"
                      value={hours.close}
                      onChange={(e) =>
                        updateDayHours(key, "close", e.target.value)
                      }
                      className="w-32"
                    />
                  </div>
                ) : (
                  <span className="text-sm text-muted-foreground">Libur</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex items-center justify-end gap-2">
        <Button type="submit" disabled={submitting || !regionReady}>
          {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          {mode === "create" ? "Buat Cabang" : "Simpan Perubahan"}
        </Button>
      </div>
    </form>
  );
}
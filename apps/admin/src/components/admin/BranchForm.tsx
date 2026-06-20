"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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
}

interface BranchFormProps {
  mode: "create" | "edit";
  initialData?: BranchFormData;
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

const STATUS_OPTIONS: { value: BranchFormData["status"]; label: string }[] = [
  { value: "aktif", label: "Aktif" },
  { value: "nonaktif", label: "Nonaktif" },
];

export default function BranchForm({
  mode,
  initialData,
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
    }
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    setError(null);
    setSubmitting(true);
    try {
      await onSubmit({
        ...formData,
        code: formData.code.toUpperCase(),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Terjadi kesalahan");
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
          <div className="space-y-2">
            <Label htmlFor="status">Status</Label>
            <Select
              value={formData.status}
              onValueChange={(value) =>
                updateField("status", value as BranchFormData["status"])
              }
            >
              <SelectTrigger id="status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
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
        <Button type="submit" disabled={submitting}>
          {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          {mode === "create" ? "Buat Cabang" : "Simpan Perubahan"}
        </Button>
      </div>
    </form>
  );
}
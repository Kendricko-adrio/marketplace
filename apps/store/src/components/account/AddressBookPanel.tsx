"use client";

import { useEffect, useState } from "react";
import { Loader2, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ReadOnlyInput } from "@/components/ui/read-only-input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ClientAddressInput, ClientAddressView } from "@/lib/client-addresses";
import type { RegionLevel, ShipmentRegion } from "@/lib/shipment-regions";

const blank: ClientAddressInput = {
  recipientName: "",
  phone: "",
  fullAddress: "",
  provinceId: "",
  cityId: "",
  districtId: "",
  areaId: "",
  postalCode: "",
  isDefault: false,
};

const levels: RegionLevel[] = ["provinces", "cities", "districts", "areas"];
const names = ["Provinsi", "Kota/Kabupaten", "Kecamatan", "Kelurahan/Area"];
const fields = ["provinceId", "cityId", "districtId", "areaId"] as const;

function RegionPicker({
  index,
  value,
  parentId,
  onChange,
}: {
  index: number;
  value: string;
  parentId?: string;
  onChange: (id: string, postal?: string) => void;
}) {
  const [options, setOptions] = useState<ShipmentRegion[]>([]);
  const [loading, setLoading] = useState(index === 0 || Boolean(parentId));
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    if (index > 0 && !parentId) return () => controller.abort();
    fetch(
      `/api/shipment/regions?level=${levels[index]}${parentId ? `&parentId=${encodeURIComponent(parentId)}` : ""}`,
      { signal: controller.signal }
    )
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error();
        return body.data as ShipmentRegion[];
      })
      .then((data) => {
        if (!controller.signal.aborted) setOptions(data);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [index, parentId, retry]);

  return (
    <div className="space-y-2">
      <Label htmlFor={fields[index]} required>
        {names[index]}
      </Label>
      <Select
        value={value}
        disabled={loading || (index > 0 && !parentId) || error}
        onValueChange={(id) =>
          onChange(id, options.find((row) => row.id === id)?.postalCode)
        }
      >
        <SelectTrigger id={fields[index]} aria-required="true">
          <SelectValue
            placeholder={loading ? "Memuat wilayah…" : `Pilih ${names[index]}`}
          />
        </SelectTrigger>
        <SelectContent>
          {options.map((row) => (
            <SelectItem key={row.id} value={row.id}>
              {row.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setError(false);
            setLoading(true);
            setRetry((r) => r + 1);
          }}
        >
          Coba lagi
        </Button>
      )}
    </div>
  );
}

export function AddressBookPanel() {
  const [rows, setRows] = useState<ClientAddressView[]>([]);
  const [input, setInput] = useState<ClientAddressInput>(blank);
  const [editing, setEditing] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/addresses");
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setRows(body.data);
    } catch {
      setError("Buku alamat belum tersedia. Coba lagi.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function mutation(
    path: string,
    method: string,
    body?: ClientAddressInput
  ) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(path, {
        method,
        headers: { "content-type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      await load();
      return true;
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Alamat belum dapat disimpan."
      );
      return false;
    } finally {
      setBusy(false);
    }
  }

  const ready =
    input.recipientName.trim() &&
    input.phone.trim() &&
    input.fullAddress.trim() &&
    input.areaId &&
    input.postalCode;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Buku Alamat</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Alamat penerima milik Anda. Perubahan tidak mengubah pesanan yang
            sudah dibuat.
          </p>
        </div>
        <Button
          className="self-start shrink-0"
          onClick={() => {
            setEditing(null);
            setInput({ ...blank });
            setShowForm(true);
          }}
        >
          Tambah Alamat
        </Button>
      </div>

      {error && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/50 bg-destructive/5 p-4 text-sm text-destructive"
        >
          <span>{error}</span>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            Coba lagi
          </Button>
        </div>
      )}

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">
              {editing ? "Edit alamat" : "Alamat baru"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-5"
              onSubmit={async (event) => {
                event.preventDefault();
                if (
                  await mutation(
                    editing ? `/api/addresses/${editing}` : "/api/addresses",
                    editing ? "PATCH" : "POST",
                    input
                  )
                ) {
                  setShowForm(false);
                }
              }}
            >
              {/* Legenda bintang: penanda wajib harus punya arti tertulis. Kode Pos tidak
                  bertanda bintang karena terkunci dan terisi otomatis dari Kelurahan/Area. */}
              <p className="text-xs text-muted-foreground">
                <span aria-hidden="true">*</span> Wajib diisi
              </p>

              <div className="grid gap-5 sm:grid-cols-2">
                {(
                  [
                    ["recipientName", "Nama Penerima"],
                    ["phone", "Nomor Telepon"],
                  ] as const
                ).map(([key, label]) => (
                  <div className="space-y-2" key={key}>
                    <Label htmlFor={key} required>
                      {label}
                    </Label>
                    <Input
                      id={key}
                      required
                      value={input[key]}
                      onChange={(event) =>
                        setInput((prev) => ({
                          ...prev,
                          [key]: event.target.value,
                        }))
                      }
                    />
                  </div>
                ))}

                {fields.map((field, index) => (
                  <RegionPicker
                    key={`${field}:${index > 0 ? input[fields[index - 1]] : "root"}`}
                    index={index}
                    value={input[field]}
                    parentId={index > 0 ? input[fields[index - 1]] : undefined}
                    onChange={(id, postal) =>
                      setInput((prev) => {
                        const next = {
                          ...prev,
                          [field]: id,
                          postalCode: postal ?? "",
                        };
                        for (let n = index + 1; n < fields.length; n++) {
                          next[fields[n]] = "";
                        }
                        return next;
                      })
                    }
                  />
                ))}

                <div className="space-y-2">
                  <Label htmlFor="postalCode">Kode Pos</Label>
                  <ReadOnlyInput
                    id="postalCode"
                    value={input.postalCode}
                    hint="Terisi otomatis dari Kelurahan/Area."
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="fullAddress" required>
                  Alamat Lengkap
                </Label>
                <Input
                  id="fullAddress"
                  required
                  value={input.fullAddress}
                  placeholder="Jalan, nomor rumah, unit, dan patokan"
                  onChange={(event) =>
                    setInput((prev) => ({
                      ...prev,
                      fullAddress: event.target.value,
                    }))
                  }
                />
              </div>

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={input.isDefault}
                  onChange={(event) =>
                    setInput((prev) => ({
                      ...prev,
                      isDefault: event.target.checked,
                    }))
                  }
                />
                Jadikan alamat utama
              </label>

              <div className="flex flex-wrap gap-3">
                <Button disabled={busy || !ready}>Simpan alamat</Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowForm(false)}
                >
                  Batal
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm">Memuat alamat…</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
          <MapPin className="h-12 w-12" />
          <p className="text-base">Belum ada alamat tersimpan.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {rows.map((row) => (
            <Card key={row.id} className="flex flex-col">
              <CardContent className="flex h-full flex-col justify-between p-6">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-semibold">{row.recipientName}</h2>
                    {row.isDefault && (
                      <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
                        Utama
                      </span>
                    )}
                  </div>
                  <p className="mt-2 text-sm">{row.phone}</p>
                  <p className="mt-3 text-sm">{row.fullAddress}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {[
                      row.area,
                      row.district,
                      row.city,
                      row.province,
                      row.postalCode,
                    ]
                      .filter(Boolean)
                      .join(", ")}
                  </p>
                </div>
                <div className="mt-5 flex flex-wrap gap-2">
                  {!row.isDefault && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        void mutation(`/api/addresses/${row.id}/default`, "POST")
                      }
                    >
                      Jadikan utama
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      setEditing(row.id);
                      setInput({
                        recipientName: row.recipientName,
                        phone: row.phone,
                        fullAddress: row.fullAddress,
                        provinceId: row.provinceId,
                        cityId: row.cityId,
                        districtId: row.districtId,
                        areaId: row.areaId,
                        postalCode: row.postalCode,
                        isDefault: row.isDefault,
                      });
                      setShowForm(true);
                    }}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      void mutation(`/api/addresses/${row.id}`, "DELETE")
                    }
                  >
                    Hapus
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

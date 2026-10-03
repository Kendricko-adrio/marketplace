"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { DeliveryQuoteService } from "@/lib/delivery-quote";
import type { ClientAddressInput } from "@/lib/client-addresses";
import type { RegionLevel, ShipmentRegion } from "@/lib/shipment-regions";
import { Input } from "@/components/ui/input";

// =========================================================
// DeliveryQuotePanel — the checkout step-2 delivery block (ticket 03):
// address combobox + "Periksa ongkir" + service list (vendor `rates`,
// never `final_rates`) + ongkir/PPN/total for the SELECTED service.
//
// Fail-closed + stale-proof: changing the address/items key clears the
// selection and the money immediately, then AUTO-fetches a new quote with an
// AbortController + request generation (a late response never overwrites a
// newer one). A failed or empty quote never shows money — it offers
// "Coba lagi" (explicit retry) while the pickup method stays available.
// Money is only for the SELECTED service; list rows show the service name
// (the per-service ongkir belongs to the selected summary, per the ticket
// contract that money clears with every change).
// =========================================================

const QUOTE_ENDPOINT = "/api/checkout/delivery-quote";

export interface DeliveryAddressPreview {
  id: string;
  recipientName: string;
  phone: string;
  fullAddress: string;
  postalCode: string;
}
type AddressOption = DeliveryAddressPreview & { regionReady: boolean };

export interface DeliveryQuotePanelProps {
  /** Owned selected cart-item ids for the quote request. */
  itemIds: string[];
  /**
   * Changes whenever the quoted input changes (items, quantities, prices,
   * branch) — the stale quote selection and money are dropped immediately.
   */
  itemsKey: string;
  onServiceChange: (service: DeliveryQuoteService | null) => void;
  onPendingChange: (pending: boolean) => void;
  /** Emits the chosen destination (the approval body + ticket-04 state). */
  onAddressChange?: (addressId: string | null) => void;
  onAddressSelected?: (address: DeliveryAddressPreview | null) => void;
  onNewAddressChange?: (address: ClientAddressInput | null) => void;
  onSaveAddressChange?: (save: boolean) => void;
  initialAddressId?: string | null;
  initialNewAddress?: ClientAddressInput | null;
  initialSaveAddress?: boolean;
  /**
   * Ticket-04 reprice sync: after a 409 DELIVERY_REPRICE_REQUIRED the page
   * pushes the FRESH quote list plus the matched (re-approved) service; the
   * panel re-renders the fresh money and, when the approved service
   * vanished, clears the selection (the reselect contract).
   */
  repriceSync?: {
    services: DeliveryQuoteService[];
    selected: DeliveryQuoteService | null;
  } | null;
}

type QuotePhase = "idle" | "loading" | "ready" | "error";
const emptyAddress: ClientAddressInput = {
  recipientName: "", phone: "", fullAddress: "", provinceId: "", cityId: "",
  districtId: "", areaId: "", postalCode: "", isDefault: false,
};
const regionLevels: RegionLevel[] = ["provinces", "cities", "districts", "areas"];
const regionFields = ["provinceId", "cityId", "districtId", "areaId"] as const;
const regionLabels = ["Provinsi", "Kota/Kabupaten", "Kecamatan", "Kelurahan/Area"];

function CheckoutRegion({ index, parentId, value, onPick }: {
  index: number; parentId?: string; value: string; onPick: (value: string, postalCode?: string) => void;
}) {
  const [options, setOptions] = useState<ShipmentRegion[]>([]);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    if (index > 0 && !parentId) return () => controller.abort();
    fetch(`/api/shipment/regions?level=${regionLevels[index]}${parentId ? `&parentId=${encodeURIComponent(parentId)}` : ""}`, { signal: controller.signal })
      .then(async (res) => { if (!res.ok) throw new Error("Region unavailable"); return res.json(); })
      .then((body) => { if (!controller.signal.aborted) { setOptions(body.data); setError(false); } })
      .catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [index, parentId, retry]);
  return <div className="space-y-1">
    <Label htmlFor={`checkout-${regionFields[index]}`}>{regionLabels[index]}</Label>
    <select id={`checkout-${regionFields[index]}`} className="h-10 w-full rounded-md border bg-background px-3 text-sm"
      value={value} disabled={(index > 0 && !parentId) || error} onChange={(event) => {
        const id = event.target.value;
        onPick(id, options.find((row) => row.id === id)?.postalCode);
      }}>
      <option value="">Pilih {regionLabels[index]}</option>
      {options.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
    </select>
    {error && <Button type="button" variant="outline" size="sm" onClick={() => setRetry((n) => n + 1)}>Coba lagi wilayah</Button>}
  </div>;
}

export default function DeliveryQuotePanel({
  itemIds,
  itemsKey,
  onServiceChange,
  onPendingChange,
  onAddressChange,
  onAddressSelected,
  onNewAddressChange,
  onSaveAddressChange,
  initialAddressId,
  initialNewAddress,
  initialSaveAddress,
  repriceSync,
}: DeliveryQuotePanelProps) {
  const [addresses, setAddresses] = useState<AddressOption[] | null>(null);
  const [newMode, setNewMode] = useState(Boolean(initialNewAddress));
  const [newAddress, setNewAddress] = useState<ClientAddressInput>(initialNewAddress ?? emptyAddress);
  const [saveAddress, setSaveAddress] = useState(initialSaveAddress ?? false);
  const [addressLoadError, setAddressLoadError] = useState(false);
  const [addressRetry, setAddressRetry] = useState(0);
  const [addressId, setAddressId] = useState<string | null>(initialAddressId ?? null);
  const userSelectedAddress = useRef(Boolean(initialAddressId));
  const [services, setServices] = useState<DeliveryQuoteService[] | null>(null);
  const [selected, setSelected] = useState<DeliveryQuoteService | null>(null);
  const [phase, setPhase] = useState<QuotePhase>("idle");
  const [error, setError] = useState<string | null>(null);
  // Request generation + AbortController so a slow/stale quote can never
  // overwrite a newer one (address/items changed mid-flight).
  const generationRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  // Fetch the customer's owned address book once (addresses only from the
  // protected API). No money is trusted from anywhere here — the panel only
  // sends {itemIds, addressId}.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/addresses");
        const data = await res.json();
        if (!res.ok || !data.success || !Array.isArray(data.data)) {
          throw new Error("Address list unavailable");
        }
        if (!cancelled) {
          const rows = data.data as Array<Record<string, unknown>>;
          setAddresses(rows.map((row) => ({
            id: String(row.id),
            recipientName: String(row.recipientName ?? ""),
            phone: String(row.phone ?? ""),
            fullAddress: String(row.fullAddress ?? ""),
            postalCode: String(row.postalCode ?? ""),
            regionReady: Boolean(row.provinceId && row.cityId && row.districtId && row.areaId && row.postalCode),
          })));
          setAddressLoadError(false);
          if (!userSelectedAddress.current) {
            const defaultAddress = rows.find((row) => row.isDefault === true && row.provinceId && row.cityId && row.districtId && row.areaId && row.postalCode);
            if (defaultAddress) {
              const id = String(defaultAddress.id);
              setAddressId(id);
              onAddressChange?.(id);
            }
          }
        }
      } catch {
        if (!cancelled) setAddressLoadError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [onAddressChange, addressRetry]);

  const readyNewAddress = newMode && Boolean(newAddress.recipientName.trim() && newAddress.phone.trim() &&
    newAddress.fullAddress.trim() && newAddress.provinceId && newAddress.cityId &&
    newAddress.districtId && newAddress.areaId && newAddress.postalCode);
  const destinationKey = newMode ? JSON.stringify(newAddress) : addressId;
  useEffect(() => {
    onAddressSelected?.(newMode
      ? readyNewAddress ? { id: "", recipientName: newAddress.recipientName, phone: newAddress.phone,
        fullAddress: newAddress.fullAddress, postalCode: newAddress.postalCode } : null
      : addresses?.find((address) => address.id === addressId) ?? null);
    onNewAddressChange?.(readyNewAddress ? newAddress : null);
    onSaveAddressChange?.(newMode && saveAddress);
  }, [addresses, addressId, newMode, newAddress, readyNewAddress, saveAddress, onAddressSelected, onNewAddressChange, onSaveAddressChange]);

  const runQuote = useCallback(
    async (generation: number, destination: { addressId: string } | { newAddress: ClientAddressInput } | null) => {
      if (!destination || itemIds.length === 0) return;
      onServiceChange(null);
      onPendingChange(true);
      setPhase("loading");
      setError(null);
      setSelected(null);
      const abort = new AbortController();
      abortRef.current?.abort();
      abortRef.current = abort;
      try {
        const res = await fetch(QUOTE_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ itemIds, ...destination }),
          signal: abort.signal,
        });
        const data = (await res.json()) as {
          success: boolean;
          data?: { services?: DeliveryQuoteService[] };
          error?: string;
        };
        // A stale response (older generation) is discarded without rendering.
        if (abortRef.current !== abort || generation !== generationRef.current) return;
        if (!data.success || !data.data?.services?.length) {
          setServices(null);
          setSelected(null);
          setPhase("error");
          setError(data.error || "Periksa ongkir gagal. Coba lagi.");
        } else {
          setServices(data.data.services ?? []);
          setSelected(null);
          setPhase("ready");
          setError(null);
        }
      } catch {
        if (abort.signal.aborted || abortRef.current !== abort) return;
        setServices(null);
        setSelected(null);
        setPhase("error");
        setError("Periksa ongkir gagal. Coba lagi.");
      } finally {
        if (abortRef.current === abort && generation === generationRef.current) {
          abortRef.current = null;
          onPendingChange(false);
        }
      }
    },
    [itemIds, onPendingChange, onServiceChange]
  );

  // The quote key: destination address + everything that changes the server
  // request (items, quantities, prices, branch). Any change clears the
  // selection and the money (no stale pricing), then re-quotes.
  useEffect(() => {
    const destination = newMode ? readyNewAddress ? { newAddress } : null : addressId ? { addressId } : null;
    if (!destination || itemIds.length === 0) {
      // Nothing quoted yet — clear money + selection for this fingerprint.
      generationRef.current += 1;
      setServices(null);
      setSelected(null);
      setPhase("idle");
      setError(null);
      onServiceChange(null);
      onPendingChange(false);
      return;
    }
    generationRef.current += 1;
    setServices(null);
    setSelected(null);
    onServiceChange(null);
    void runQuote(generationRef.current, destination);
    return () => {
      abortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- itemsKey is intentionally part of the requote key
  }, [destinationKey, newMode, readyNewAddress, itemsKey, itemIds.length]);

  function pickService(service: DeliveryQuoteService) {
    setSelected(service);
    setPhase("ready");
    onServiceChange(service);
  }

  // Ticket-04 reprice sync: render the FRESH services + the matched approved
  // service (or clear the selection when the service vanished — the reselect
  // contract). The page's deliveryService stays authoritative for money.
  useEffect(() => {
    if (!repriceSync) return;
    const freshList = repriceSync.services;
    setServices(freshList.length > 0 ? freshList : null);
    setSelected(repriceSync.selected);
    if (repriceSync.selected) onServiceChange(repriceSync.selected);
    if (freshList.length === 0) {
      setPhase("error");
      setError("Layanan yang disetujui tidak tersedia. Pilih layanan lain atau coba lagi.");
    } else {
      setPhase("ready");
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sync only on the reprice push
  }, [repriceSync]);
  return (
    <section aria-label="Quote Pengiriman" className="space-y-4">
      <div>
        <Label htmlFor="deliveryAddress" className="mb-1.5 block">
          Alamat Pengiriman
        </Label>
        <Select
          value={newMode ? "new" : addressId ?? ""}
          onValueChange={(value) => {
            userSelectedAddress.current = true;
            setNewMode(false);
            setAddressId(value);
            onAddressChange?.(value);
          }}
        >
          <SelectTrigger
            id="deliveryAddress"
            aria-label="Alamat Pengiriman"
            className="w-full"
          >
            <SelectValue placeholder="Pilih alamat pengiriman" />
          </SelectTrigger>
          <SelectContent>
            {newMode && <SelectItem value="new">Alamat baru</SelectItem>}
            {(addresses ?? []).map((address) => (
              <SelectItem key={address.id} value={address.id} disabled={!address.regionReady}>
                {address.fullAddress}
                {address.recipientName ? ` · ${address.recipientName}` : ""}
                {!address.regionReady ? " · Perbarui wilayah di Buku Alamat" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {addressLoadError && (
          <p role="alert" className="mt-1.5 text-sm text-destructive">
            Alamat belum dapat dimuat. <Button type="button" variant="link" className="h-auto p-0" onClick={() => setAddressRetry((n) => n + 1)}>Coba lagi</Button>
          </p>
        )}
        <Button type="button" variant="link" className="mt-1 px-0" onClick={() => {
          userSelectedAddress.current = true;
          setNewMode(true);
          setAddressId(null);
          onAddressChange?.(null);
        }}>Gunakan alamat baru</Button>
        {newMode && <div className="mt-3 grid gap-3 rounded-lg border p-4 sm:grid-cols-2">
          <div><Label htmlFor="checkout-recipient">Nama Penerima</Label><Input id="checkout-recipient" value={newAddress.recipientName} onChange={(e) => setNewAddress((prev) => ({ ...prev, recipientName: e.target.value }))} /></div>
          <div><Label htmlFor="checkout-phone">Telepon Penerima</Label><Input id="checkout-phone" value={newAddress.phone} onChange={(e) => setNewAddress((prev) => ({ ...prev, phone: e.target.value }))} /></div>
          {regionFields.map((field, index) => <CheckoutRegion key={`${field}:${index > 0 ? newAddress[regionFields[index - 1]] : "root"}`}
            index={index} value={newAddress[field]} parentId={index > 0 ? newAddress[regionFields[index - 1]] : undefined}
            onPick={(id, postalCode) => setNewAddress((prev) => {
              const next = { ...prev, [field]: id, postalCode: postalCode ?? "" };
              for (let n = index + 1; n < regionFields.length; n++) next[regionFields[n]] = "";
              return next;
            })} />)}
          <div><Label htmlFor="checkout-postal">Kode Pos</Label><Input id="checkout-postal" value={newAddress.postalCode} readOnly /></div>
          <div className="sm:col-span-2"><Label htmlFor="checkout-street">Alamat Lengkap</Label><Input id="checkout-street" value={newAddress.fullAddress} placeholder="Jalan, nomor rumah, unit, dan patokan" onChange={(e) => setNewAddress((prev) => ({ ...prev, fullAddress: e.target.value }))} /></div>
          <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={saveAddress} onChange={(e) => {
            setSaveAddress(e.target.checked);
            if (!e.target.checked) setNewAddress((prev) => ({ ...prev, isDefault: false }));
          }} />Simpan alamat</label>
          {saveAddress && <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={newAddress.isDefault} onChange={(e) => setNewAddress((prev) => ({ ...prev, isDefault: e.target.checked }))} />Jadikan alamat utama</label>}
        </div>}
        {addresses && addresses.length === 0 && !addressLoadError && !newMode && (
          <p className="mt-1.5 text-sm text-muted-foreground">
            Belum ada alamat tersimpan. Tambahkan alamat di akun Anda.
          </p>
        )}
      </div>

      {phase === "loading" && (
        <div className="flex items-center gap-2 rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Memeriksa ongkir ke
          layanan pengiriman...
        </div>
      )}

      {phase === "error" && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <p className="text-destructive">{error}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Anda tetap dapat beralih ke pengambilan di cabang.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => void runQuote((generationRef.current += 1), newMode ? readyNewAddress ? { newAddress } : null : addressId ? { addressId } : null)}
          >
            Coba lagi
          </Button>
        </div>
      )}

      {phase === "ready" && services !== null && (
        <div className="space-y-2">
          {services.map((service) => (
            <button
              key={`${service.courierId}-${service.serviceId}`}
              type="button"
              onClick={() => pickService(service)}
              className={`w-full rounded-lg border p-3 text-left text-sm transition-colors ${
                selected?.serviceId === service.serviceId
                  ? "border-primary bg-primary/5"
                  : "hover:bg-muted/40"
              }`}
            >
              <span className="font-medium">{service.name}</span>
              {service.validEta && (
                <span className="ml-2 text-xs text-muted-foreground">
                  ETA {service.validEta.from} – {service.validEta.to}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {selected && (
        <div className="space-y-2 rounded-lg border bg-muted/30 p-4 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Ongkos Kirim</span>
            <span>
              Rp {Number(selected.shippingCost).toLocaleString("id-ID")}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">
              PPN ({selected.pricing.ppnRatePercent}%)
            </span>
            <span>
              Rp {Number(selected.pricing.ppnAmount).toLocaleString("id-ID")}
            </span>
          </div>
          <div className="flex justify-between font-medium">
            <span>Total ( barang + ongkir + PPN )</span>
            <span>
              Rp {Number(selected.pricing.total).toLocaleString("id-ID")}
            </span>
          </div>
        </div>
      )}

      <div className="flex justify-end">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            const destination = newMode ? readyNewAddress ? { newAddress } : null : addressId ? { addressId } : null;
            if (!destination) return;
            generationRef.current += 1;
            void runQuote(generationRef.current, destination);
          }}
          disabled={phase === "loading" || (newMode ? !readyNewAddress : !addressId) || itemIds.length === 0}
        >
          {phase === "loading" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            "Periksa ongkir"
          )}
        </Button>
      </div>
    </section>
  );
}
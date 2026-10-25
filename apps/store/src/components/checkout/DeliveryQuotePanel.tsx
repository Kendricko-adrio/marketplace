"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, Truck } from "lucide-react";
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
import {
  DELIVERY_CATEGORY_FILTERS,
  formatDeliveryEta,
  getDeliveryOptionsPage,
  type DeliveryCategoryFilter,
} from "@/lib/delivery-options";
import type { ClientAddressInput } from "@/lib/client-addresses";
import type { RegionLevel, ShipmentRegion } from "@/lib/shipment-regions";
import { Input } from "@/components/ui/input";
import { ReadOnlyInput } from "@/components/ui/read-only-input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// =========================================================
// DeliveryQuotePanel — the checkout step-1 delivery block:
// address combobox + "Periksa ongkir" + service list (vendor `rates`,
// never `final_rates`). Selected-service PPN/total live in the page summary.
// The page hides, rather than unmounts, this panel during contact/review.
//
// Fail-closed + stale-proof: changing the address/items key clears the
// selection and the money immediately, then AUTO-fetches a new quote with an
// AbortController + request generation (a late response never overwrites a
// newer one). A failed or empty quote never shows money — it offers
// "Coba lagi" (explicit retry) while the pickup method stays available.
// Display current per-service ongkir and arrival dates in a compact, five-row
// paginated picker. Only an explicitly selected service updates the checkout
// summary. Category/page navigation preserves selection; new quotes reset to
// all categories, page one. Category groups come from provider metadata only.
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

/** Satu-satunya definisi "alamat siap dipakai" untuk draft maupun alamat terpakai. */
function isCompleteAddress(address: ClientAddressInput | null): boolean {
  return Boolean(
    address &&
      address.recipientName.trim() &&
      address.phone.trim() &&
      address.fullAddress.trim() &&
      address.provinceId &&
      address.cityId &&
      address.districtId &&
      address.areaId &&
      address.postalCode
  );
}

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
  // Alamat baru hidup sebagai DRAFT di modal sampai customer menekan
  // "Gunakan alamat ini"; hanya alamat terpakai yang ikut quote.
  const [appliedNewAddress, setAppliedNewAddress] = useState<ClientAddressInput | null>(initialNewAddress ?? null);
  const [saveAddress, setSaveAddress] = useState(initialSaveAddress ?? false);
  const [addressModalOpen, setAddressModalOpen] = useState(false);
  const [draftAddress, setDraftAddress] = useState<ClientAddressInput>(initialNewAddress ?? emptyAddress);
  const [draftSaveAddress, setDraftSaveAddress] = useState(initialSaveAddress ?? false);
  const [addressLoadError, setAddressLoadError] = useState(false);
  const [addressRetry, setAddressRetry] = useState(0);
  const [addressId, setAddressId] = useState<string | null>(initialAddressId ?? null);
  const userSelectedAddress = useRef(Boolean(initialAddressId));
  const [services, setServices] = useState<DeliveryQuoteService[] | null>(null);
  const [selected, setSelected] = useState<DeliveryQuoteService | null>(null);
  const [page, setPage] = useState(1);
  const [category, setCategory] = useState<DeliveryCategoryFilter>("all");
  const serviceGroupName = useId();
  const serviceOptionsId = useId();
  const newAddressDialogId = useId();
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

  const readyNewAddress = isCompleteAddress(appliedNewAddress);
  const draftReady = isCompleteAddress(draftAddress);
  const destinationKey = readyNewAddress && appliedNewAddress ? JSON.stringify(appliedNewAddress) : addressId;
  const destination = readyNewAddress && appliedNewAddress
    ? { newAddress: appliedNewAddress }
    : addressId
      ? { addressId }
      : null;
  useEffect(() => {
    onAddressSelected?.(readyNewAddress && appliedNewAddress
      ? { id: "", recipientName: appliedNewAddress.recipientName, phone: appliedNewAddress.phone,
        fullAddress: appliedNewAddress.fullAddress, postalCode: appliedNewAddress.postalCode }
      : (addresses?.find((address) => address.id === addressId) ?? null));
    onNewAddressChange?.(readyNewAddress ? appliedNewAddress : null);
    onSaveAddressChange?.(readyNewAddress && saveAddress);
  }, [addresses, addressId, appliedNewAddress, readyNewAddress, saveAddress, onAddressSelected, onNewAddressChange, onSaveAddressChange]);

  function openAddressModal() {
    setDraftAddress(appliedNewAddress ?? emptyAddress);
    setDraftSaveAddress(saveAddress);
    setAddressModalOpen(true);
  }

  function applyDraftAddress() {
    if (!draftReady) return;
    userSelectedAddress.current = true;
    setAppliedNewAddress(draftAddress);
    setSaveAddress(draftSaveAddress);
    setAddressId(null);
    onAddressChange?.(null);
    setAddressModalOpen(false);
  }

  const runQuote = useCallback(
    async (generation: number, destination: { addressId: string } | { newAddress: ClientAddressInput } | null) => {
      if (!destination || itemIds.length === 0) return;
      onServiceChange(null);
      onPendingChange(true);
      setPhase("loading");
      setPage(1);
      setCategory("all");
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
    setPage(1);
    setCategory("all");
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
  }, [destinationKey, readyNewAddress, itemsKey, itemIds.length]);

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
    setPage(1);
    setCategory("all");
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

  const optionsPage = getDeliveryOptionsPage(services ?? [], page, category);
  const selectedOnPage = optionsPage.options.some((service) =>
    selected?.courierId === service.courierId && selected?.serviceId === service.serviceId
  );

  return (
    <section aria-label="Quote Pengiriman" className="space-y-4">
      <div>
        <h3 className="mb-3 text-base font-semibold">Alamat Pengiriman</h3>
        {addresses === null && !addressLoadError && (
          <p role="status" className="mb-3 text-sm text-muted-foreground">Memuat alamat tersimpan…</p>
        )}
        {addresses && addresses.length === 0 && !addressLoadError && !readyNewAddress && (
          <div className="mb-3 rounded-lg border bg-muted/30 p-4">
            <p className="text-sm font-medium">Belum ada alamat tersimpan.</p>
            <p className="mt-1 text-sm text-muted-foreground">Tambahkan alamat pengiriman lewat tombol di bawah.</p>
          </div>
        )}
        {addresses && addresses.length > 0 && <Select
          value={addressId ?? ""}
          onValueChange={(value) => {
            userSelectedAddress.current = true;
            setAppliedNewAddress(null);
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
            {(addresses ?? []).map((address) => (
              <SelectItem key={address.id} value={address.id} disabled={!address.regionReady}>
                {address.fullAddress}
                {address.recipientName ? ` · ${address.recipientName}` : ""}
                {!address.regionReady ? " · Perbarui wilayah di Buku Alamat" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>}
        {addressLoadError && (
          <p role="alert" className="mt-1.5 text-sm text-destructive">
            Alamat belum dapat dimuat. <Button type="button" variant="link" className="h-auto p-0" onClick={() => setAddressRetry((n) => n + 1)}>Coba lagi</Button>
          </p>
        )}
        <Button
          type="button"
          variant="outline"
          className="mt-3 w-full sm:w-auto"
          aria-haspopup="dialog"
          aria-expanded={addressModalOpen}
          aria-controls={newAddressDialogId}
          onClick={openAddressModal}
        >
          <span aria-hidden="true" className="text-lg leading-none">+</span>
          Gunakan alamat baru
        </Button>
        {readyNewAddress && appliedNewAddress && (
          <div role="group" aria-label="Alamat baru terpakai" className="mt-4 rounded-lg border bg-muted/30 p-4 text-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Alamat pengiriman baru</p>
                <p className="break-words font-medium">{appliedNewAddress.recipientName}</p>
                <p className="break-words">{appliedNewAddress.phone}</p>
                <p className="break-words">{appliedNewAddress.fullAddress}</p>
                <p className="break-words text-muted-foreground">Kode pos {appliedNewAddress.postalCode}</p>
                <p className="text-xs text-muted-foreground">
                  {saveAddress ? "Akan disimpan di buku alamat." : "Tidak disimpan di buku alamat."}
                </p>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={openAddressModal}>
                Ubah alamat
              </Button>
            </div>
          </div>
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
            onClick={() => void runQuote((generationRef.current += 1), destination)}
          >
            Coba lagi
          </Button>
        </div>
      )}

      {phase === "ready" && services !== null && (
        <div className="space-y-3">
          <fieldset className="min-w-0" aria-label="Pilih pengiriman">
            <legend className="mb-1 flex items-center gap-2 text-base font-semibold">
              <Truck className="h-4 w-4 text-primary" aria-hidden="true" />
              Pilih pengiriman
            </legend>
            <p className="mb-2 text-xs text-muted-foreground">
              Diurutkan dari ongkir termurah{category !== "all" ? " di kategori ini" : ""}
            </p>
            <div
              role="group"
              aria-label="Kategori pengiriman"
              className="mb-3 flex max-w-full gap-1.5 overflow-x-auto p-1"
            >
              {DELIVERY_CATEGORY_FILTERS.map((filter) => {
                const count = optionsPage.categoryCounts[filter.id];
                const active = category === filter.id;
                return (
                  <button
                    key={filter.id}
                    type="button"
                    aria-label={filter.label}
                    aria-pressed={active}
                    aria-controls={serviceOptionsId}
                    disabled={count === 0}
                    title={count === 0 ? "Tidak tersedia untuk alamat ini" : undefined}
                    onClick={() => {
                      setCategory(filter.id);
                      setPage(1);
                    }}
                    className={`inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 py-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40 ${
                      active
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground"
                    }`}
                  >
                    {filter.label}
                    <span aria-hidden="true" className={`tabular-nums ${active ? "opacity-80" : "opacity-60"}`}>
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
            <div id={serviceOptionsId} className="overflow-hidden rounded-xl border bg-background">
              {optionsPage.options.map((service) => {
                const isSelected = selected?.courierId === service.courierId &&
                  selected?.serviceId === service.serviceId;
                return (
                  <label
                    key={`${service.courierId}-${service.serviceId}`}
                    className={`relative flex cursor-pointer items-start gap-3 border-b p-3.5 text-sm transition-colors last:border-b-0 focus-within:z-10 focus-within:ring-2 focus-within:ring-inset focus-within:ring-primary ${
                      isSelected
                        ? "bg-primary/5 shadow-[inset_3px_0_0_var(--primary)]"
                        : "hover:bg-muted/40"
                    }`}
                  >
                    <input
                      type="radio"
                      name={serviceGroupName}
                      value={`${service.courierId}-${service.serviceId}`}
                      checked={isSelected}
                      onChange={() => pickService(service)}
                      className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-start justify-between gap-3">
                        <span className="min-w-0 break-words font-semibold">{service.name}</span>
                        <span className="shrink-0 font-semibold tabular-nums">
                          Rp {service.shippingCost.toLocaleString("id-ID")}
                        </span>
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="text-xs leading-relaxed text-muted-foreground">
                          {formatDeliveryEta(service.validEta)}
                        </span>
                        {service.shippingCost === optionsPage.cheapestCost && (
                          <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                            Termurah
                          </span>
                        )}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground" role="status">
              {optionsPage.start}–{optionsPage.end} dari {optionsPage.total} layanan
            </p>
            {optionsPage.pageCount > 1 && (
              <nav aria-label="Pagination kurir" className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label="Halaman kurir sebelumnya"
                  disabled={optionsPage.page === 1}
                  onClick={() => setPage(optionsPage.page - 1)}
                >
                  <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                </Button>
                <span className="px-2 text-xs tabular-nums" aria-label={`Halaman ${optionsPage.page} dari ${optionsPage.pageCount}`}>
                  {optionsPage.page} / {optionsPage.pageCount}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label="Halaman kurir berikutnya"
                  disabled={optionsPage.page === optionsPage.pageCount}
                  onClick={() => setPage(optionsPage.page + 1)}
                >
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </Button>
              </nav>
            )}
          </div>
          {selected && !selectedOnPage && (
            <p className="rounded-lg bg-primary/5 px-3 py-2 text-xs font-medium text-primary" role="status">
              Terpilih: {selected.name}
            </p>
          )}
        </div>
      )}

      <div className="space-y-3 border-t pt-4">
        <p className="text-sm text-muted-foreground" role="status">
          {!destination
            ? "Pilih alamat tersimpan atau gunakan alamat baru untuk melihat ongkir."
            : selected
              ? "Layanan pengiriman sudah dipilih. Klik Lanjut untuk melanjutkan ke pembayaran."
              : "Pilih layanan pengiriman sebelum melanjutkan."}
        </p>
        <Button
          type="button"
          variant="outline"
          className="w-full sm:w-auto"
          onClick={() => {
            if (!destination) return;
            generationRef.current += 1;
            void runQuote(generationRef.current, destination);
          }}
          disabled={phase === "loading" || !destination || itemIds.length === 0}
        >
          {phase === "loading" ? (
            <><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Memeriksa ongkir…</>
          ) : (
            "Periksa ongkir"
          )}
        </Button>
      </div>
      <Dialog open={addressModalOpen} onOpenChange={setAddressModalOpen}>
        <DialogContent id={newAddressDialogId} className="max-h-[90dvh] gap-0 overflow-hidden p-0 sm:max-w-2xl">
          <div className="flex max-h-[90dvh] min-h-0 flex-col">
          <DialogHeader className="p-6 pb-3">
            <DialogTitle>Alamat baru</DialogTitle>
            <DialogDescription>
              Lengkapi alamat penerima, lalu tekan “Gunakan alamat ini” untuk menghitung ongkir ke alamat tersebut.
            </DialogDescription>
          </DialogHeader>
          {/* Body scrolls; aksi utama tetap terlihat di footer (mobile 390px). */}
          <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-4">
            <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2"><Label htmlFor="checkout-recipient">Nama Penerima</Label><Input id="checkout-recipient" autoComplete="shipping name" value={draftAddress.recipientName} onChange={(e) => setDraftAddress((prev) => ({ ...prev, recipientName: e.target.value }))} /></div>
            <div className="space-y-2"><Label htmlFor="checkout-phone">Telepon Penerima</Label><Input id="checkout-phone" type="tel" autoComplete="shipping tel" value={draftAddress.phone} onChange={(e) => setDraftAddress((prev) => ({ ...prev, phone: e.target.value }))} /></div>
            {regionFields.map((field, index) => <CheckoutRegion key={`${field}:${index > 0 ? draftAddress[regionFields[index - 1]] : "root"}`}
              index={index} value={draftAddress[field]} parentId={index > 0 ? draftAddress[regionFields[index - 1]] : undefined}
              onPick={(id, postalCode) => setDraftAddress((prev) => {
                const next = { ...prev, [field]: id, postalCode: postalCode ?? "" };
                for (let n = index + 1; n < regionFields.length; n++) next[regionFields[n]] = "";
                return next;
              })} />)}
            <div className="space-y-2"><Label htmlFor="checkout-postal">Kode Pos</Label><ReadOnlyInput id="checkout-postal" value={draftAddress.postalCode} hint="Terisi otomatis dari Kelurahan/Area." /></div>
            <div className="space-y-2 sm:col-span-2"><Label htmlFor="checkout-street">Alamat Lengkap</Label><Input id="checkout-street" value={draftAddress.fullAddress} placeholder="Jalan, nomor rumah, unit, dan patokan" onChange={(e) => setDraftAddress((prev) => ({ ...prev, fullAddress: e.target.value }))} /></div>
            <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={draftSaveAddress} onChange={(e) => {
              setDraftSaveAddress(e.target.checked);
              if (!e.target.checked) setDraftAddress((prev) => ({ ...prev, isDefault: false }));
            }} />Simpan alamat</label>
            {draftSaveAddress && <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={draftAddress.isDefault} onChange={(e) => setDraftAddress((prev) => ({ ...prev, isDefault: e.target.checked }))} />Jadikan alamat utama</label>}
            </div>
          </div>
          <DialogFooter className="gap-2 border-t p-6 pt-4">
            {!draftReady && (
              <p className="mr-auto self-center text-xs text-muted-foreground">
                Lengkapi nama, telepon, wilayah, dan alamat untuk memakai alamat ini.
              </p>
            )}
            <Button type="button" variant="outline" onClick={() => setAddressModalOpen(false)}>Batal</Button>
            <Button type="button" onClick={applyDraftAddress} disabled={!draftReady}>Gunakan alamat ini</Button>
          </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
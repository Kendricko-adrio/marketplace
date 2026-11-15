"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, RefreshCw, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import type { ClientAddressView } from "@/lib/client-addresses";
import CheckoutAddressCard from "./CheckoutAddressCard";
import CheckoutAddressDialog from "./CheckoutAddressDialog";

// =========================================================
// DeliveryQuotePanel — the checkout step-1 delivery block:
// stored-address picker + full destination card + Tambah/Ubah alamat + refresh
// ongkir di header + service list (vendor `rates`, never `final_rates`).
// Selected-service PPN/total live in the page summary. The page hides, rather
// than unmounts, this panel during contact/review.
//
// Kontrak alamat: tujuan pengiriman HANYA berupa `addressId` milik customer.
// Panel tidak membuat alamat sendiri — create/edit berjalan lewat modal
// (CheckoutAddressDialog) yang menulis API alamat, lalu card memakai
// `ClientAddressView` hasil server. Tidak ada mode sekali pakai atau
// save-intent di quote/review/place-order.
//
// Fail-closed + stale-proof: changing the destination (including an edit that
// keeps the same id) clears the selection and the money immediately, then
// AUTO-fetches a new quote with an AbortController + request generation (a late
// response never overwrites a newer one). A failed or empty quote never shows
// money — it offers "Coba lagi" (explicit retry) while the pickup method stays
// available.
// =========================================================

const QUOTE_ENDPOINT = "/api/checkout/delivery-quote";

/** Canonical stored-address data the card/form need; `id` is a book row id. */
export type DeliveryAddressPreview = ClientAddressView;

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
  /** Emits the chosen stored destination id (the approval body). */
  onAddressChange?: (addressId: string | null) => void;
  /** Emits the full stored destination so the page can check the contact. */
  onAddressSelected?: (address: DeliveryAddressPreview | null) => void;
  /**
   * True while an address create/edit is still unresolved. The page must not
   * offer "Lanjut" (or submit a delivery order) in that state.
   */
  onAddressPendingChange?: (pending: boolean) => void;
  initialAddressId?: string | null;
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

interface AddressEditorState {
  open: boolean;
  mode: "create" | "edit";
  initial: ClientAddressView | null;
  trigger: HTMLButtonElement | null;
}

/** Alamat lama tanpa rantai wilayah tidak bisa di-quote dan tidak dipilih diam-diam. */
function regionReady(address: ClientAddressView): boolean {
  return Boolean(
    address.provinceId &&
      address.cityId &&
      address.districtId &&
      address.areaId &&
      address.postalCode
  );
}

export default function DeliveryQuotePanel({
  itemIds,
  itemsKey,
  onServiceChange,
  onPendingChange,
  onAddressChange,
  onAddressSelected,
  onAddressPendingChange,
  initialAddressId,
  repriceSync,
}: DeliveryQuotePanelProps) {
  const [addresses, setAddresses] = useState<ClientAddressView[] | null>(null);
  const [addressLoadError, setAddressLoadError] = useState(false);
  const [addressRetry, setAddressRetry] = useState(0);
  const [addressId, setAddressId] = useState<string | null>(initialAddressId ?? null);
  const userSelectedAddress = useRef(Boolean(initialAddressId));
  // Alamat yang dibuat/diubah di sesi panel ini — batas aksi "Ubah alamat" (D3).
  const [sessionAddressIds, setSessionAddressIds] = useState<string[]>([]);
  const [addressBusy, setAddressBusy] = useState(false);
  const [addressStatus, setAddressStatus] = useState<string | null>(null);
  const [editor, setEditor] = useState<AddressEditorState>({
    open: false,
    mode: "create",
    initial: null,
    trigger: null,
  });
  const [services, setServices] = useState<DeliveryQuoteService[] | null>(null);
  const [selected, setSelected] = useState<DeliveryQuoteService | null>(null);
  const [page, setPage] = useState(1);
  const [category, setCategory] = useState<DeliveryCategoryFilter>("all");
  const serviceGroupName = useId();
  const serviceOptionsId = useId();
  const [phase, setPhase] = useState<QuotePhase>("idle");
  const [error, setError] = useState<string | null>(null);
  // Alamat berubah = quote/pilihan/acknowledgement lama tidak berlaku; customer
  // diminta memilih layanan lagi tanpa dialog rutin.
  const [destinationNotice, setDestinationNotice] = useState(false);
  const previousDestinationKey = useRef<string | null>(null);
  const hadSelection = useRef(false);
  // Request generation + AbortController so a slow/stale quote can never
  // overwrite a newer one (address/items changed mid-flight).
  const generationRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  // Fetch the customer's owned address book (addresses only from the protected
  // API). No money is trusted from anywhere here — the panel only sends
  // {itemIds, addressId}, and the list is re-read after every mutation.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/addresses", { cache: "no-store" });
        const data = await res.json();
        if (!res.ok || !data.success || !Array.isArray(data.data)) {
          throw new Error("Address list unavailable");
        }
        if (!cancelled) {
          const rows = data.data as ClientAddressView[];
          setAddresses(rows);
          setAddressLoadError(false);
          if (!userSelectedAddress.current) {
            const defaultAddress = rows.find(
              (row) => row.isDefault === true && regionReady(row)
            );
            if (defaultAddress) setAddressId(defaultAddress.id);
          }
        }
      } catch {
        if (!cancelled) setAddressLoadError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [addressRetry]);

  const selectedAddress =
    addresses?.find((address) => address.id === addressId) ?? null;

  useEffect(() => {
    onAddressSelected?.(selectedAddress);
    onAddressChange?.(selectedAddress?.id ?? null);
  }, [selectedAddress, onAddressSelected, onAddressChange]);

  useEffect(() => {
    onAddressPendingChange?.(addressBusy);
  }, [addressBusy, onAddressPendingChange]);

  // Invalidation key menyertakan ISI alamat: edit yang mempertahankan id yang
  // sama tetap harus membuang layanan/review/ongkir lama.
  const destinationKey = selectedAddress
    ? JSON.stringify([
        selectedAddress.id,
        selectedAddress.recipientName,
        selectedAddress.phone,
        selectedAddress.fullAddress,
        selectedAddress.provinceId,
        selectedAddress.cityId,
        selectedAddress.districtId,
        selectedAddress.areaId,
        selectedAddress.postalCode,
      ])
    : null;
  const destination = selectedAddress ? { addressId: selectedAddress.id } : null;

  const runQuote = useCallback(
    async (generation: number, target: { addressId: string } | null) => {
      if (!target || itemIds.length === 0) return;
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
          body: JSON.stringify({ itemIds, ...target }),
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

  // The quote key: destination address content + everything that changes the
  // server request (items, quantities, prices, branch). Any change clears the
  // selection and the money (no stale pricing), then re-quotes.
  useEffect(() => {
    setPage(1);
    setCategory("all");
    const destinationChanged = previousDestinationKey.current !== destinationKey;
    previousDestinationKey.current = destinationKey;
    if (destinationChanged && hadSelection.current) setDestinationNotice(true);
    hadSelection.current = false;
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
  }, [destinationKey, itemsKey, itemIds.length]);

  function pickService(service: DeliveryQuoteService) {
    hadSelection.current = true;
    setDestinationNotice(false);
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

  function openCreateAddress(trigger: HTMLButtonElement | null) {
    setEditor({ open: true, mode: "create", initial: null, trigger });
  }

  function openEditAddress(address: ClientAddressView, trigger: HTMLButtonElement | null) {
    setEditor({ open: true, mode: "edit", initial: address, trigger });
  }

  /** Tombol pemicu = elemen yang sedang fokus (klik maupun Enter/Space). */
  function currentTrigger(): HTMLButtonElement | null {
    const active = document.activeElement;
    return active instanceof HTMLButtonElement ? active : null;
  }

  /**
   * Simpan/ubah sukses: pilih ID hasil server, pakai `ClientAddressView` yang
   * dikembalikan sebagai sumber card, lalu rekonsiliasi daftar dari server
   * tanpa mengembalikan pilihan/data ke respons lama.
   */
  function handleAddressSaved(address: ClientAddressView, kind: "created" | "updated") {
    userSelectedAddress.current = true;
    setSessionAddressIds((ids) =>
      ids.includes(address.id) ? ids : [...ids, address.id]
    );
    setAddresses((rows) => {
      const rest = (rows ?? []).filter((row) => row.id !== address.id);
      const next = [address, ...rest];
      return address.isDefault
        ? next.map((row) =>
            row.id === address.id || !row.isDefault ? row : { ...row, isDefault: false }
          )
        : next;
    });
    setAddressId(address.id);
    setAddressLoadError(false);
    setAddressStatus(kind === "created" ? "Alamat disimpan." : "Alamat diperbarui.");
    setEditor((current) => ({ ...current, open: false }));
    setAddressRetry((n) => n + 1);
  }

  const optionsPage = getDeliveryOptionsPage(services ?? [], page, category);
  const selectedOnPage = optionsPage.options.some(
    (service) =>
      selected?.courierId === service.courierId &&
      selected?.serviceId === service.serviceId
  );
  const canEditSelected = Boolean(
    selectedAddress && sessionAddressIds.includes(selectedAddress.id)
  );

  return (
    <section aria-label="Quote Pengiriman" className="space-y-4">
      <div>
        <h3 className="mb-3 text-base font-semibold">Alamat Pengiriman</h3>
        {addresses === null && !addressLoadError && (
          <p role="status" className="mb-3 text-sm text-muted-foreground">
            Memuat alamat tersimpan…
          </p>
        )}
        {addressLoadError && (
          <p role="alert" className="mb-3 text-sm text-destructive">
            Alamat belum dapat dimuat.{" "}
            <Button
              type="button"
              variant="link"
              className="h-auto p-0"
              onClick={() => setAddressRetry((n) => n + 1)}
            >
              Coba lagi
            </Button>
          </p>
        )}
        {addresses && addresses.length === 0 && !addressLoadError && (
          <div className="mb-3 rounded-lg border bg-muted/30 p-4">
            <p className="text-sm font-medium">Belum ada alamat tersimpan.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Tambahkan alamat pengiriman untuk melanjutkan.
            </p>
          </div>
        )}
        {addresses && addresses.length > 0 && !addressLoadError && (
          <Select
            value={addressId ?? ""}
            onValueChange={(value) => {
              userSelectedAddress.current = true;
              setAddressId(value);
            }}
          >
            <SelectTrigger
              id="deliveryAddress"
              aria-label="Alamat Pengiriman"
              className="checkout-prompt h-auto min-h-10 w-full items-start py-2 text-left"
            >
              <SelectValue placeholder="Pilih alamat pengiriman" />
            </SelectTrigger>
            {/* Daftar alamat panjang: penerima dan alamat membungkus, tinggi
                popup dibatasi viewport, dan alasan disabled tertulis. */}
            <SelectContent className="max-h-[min(20rem,var(--radix-select-content-available-height))] w-[min(32rem,calc(100vw-2rem))] min-w-[var(--radix-select-trigger-width)]">
              {addresses.map((address) => (
                <SelectItem
                  key={address.id}
                  value={address.id}
                  disabled={!regionReady(address)}
                  className="items-start py-2 pr-2"
                >
                  <span className="min-w-0 space-y-0.5 whitespace-normal break-words">
                    <span className="block font-medium">
                      {address.recipientName || "Nama penerima belum diisi"}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {address.fullAddress}
                    </span>
                    {!regionReady(address) && (
                      <span className="block text-xs font-medium text-amber-700 dark:text-amber-300">
                        Wilayah belum lengkap — perbarui di Buku Alamat
                      </span>
                    )}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {selectedAddress && (
          <CheckoutAddressCard
            address={selectedAddress}
            onEdit={
              canEditSelected
                ? () => openEditAddress(selectedAddress, currentTrigger())
                : undefined
            }
          />
        )}
        <Button
          type="button"
          variant="outline"
          className="mt-3 w-full sm:w-auto"
          aria-haspopup="dialog"
          aria-expanded={editor.open}
          onClick={(event) => openCreateAddress(event.currentTarget)}
        >
          <span aria-hidden="true" className="text-lg leading-none">
            +
          </span>
          Tambah alamat
        </Button>
        {addressStatus && (
          <p role="status" className="mt-2 text-sm text-muted-foreground">
            {addressStatus}
          </p>
        )}
      </div>

      {destinationNotice && (
        <p
          role="status"
          className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm font-medium text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-100"
        >
          Tujuan berubah. Pilih layanan pengiriman kembali.
        </p>
      )}

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
            <legend className="mb-1 flex w-full items-center justify-between gap-3 text-base font-semibold">
              <span className="flex items-center gap-2">
                <Truck className="h-4 w-4 text-primary" aria-hidden="true" />
                Pilih pengiriman
              </span>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="shrink-0"
                aria-label="Perbarui ongkir"
                title="Perbarui ongkir"
                disabled={!destination || itemIds.length === 0}
                onClick={() => {
                  if (!destination) return;
                  void runQuote((generationRef.current += 1), destination);
                }}
              >
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
              </Button>
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
                    <span
                      aria-hidden="true"
                      className={`tabular-nums ${active ? "opacity-80" : "opacity-60"}`}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
            <div id={serviceOptionsId} className="overflow-hidden rounded-xl border bg-background">
              {optionsPage.options.map((service) => {
                const isSelected =
                  selected?.courierId === service.courierId &&
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
                <span
                  className="px-2 text-xs tabular-nums"
                  aria-label={`Halaman ${optionsPage.page} dari ${optionsPage.pageCount}`}
                >
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
            <p
              className="rounded-lg bg-primary/5 px-3 py-2 text-xs font-medium text-primary"
              role="status"
            >
              Terpilih: {selected.name}
            </p>
          )}
        </div>
      )}

      <CheckoutAddressDialog
        open={editor.open}
        mode={editor.mode}
        initialAddress={editor.initial}
        triggerElement={editor.trigger}
        onOpenChange={(next) => setEditor((current) => ({ ...current, open: next }))}
        onBusyChange={setAddressBusy}
        onSaved={handleAddressSaved}
      />
    </section>
  );
}

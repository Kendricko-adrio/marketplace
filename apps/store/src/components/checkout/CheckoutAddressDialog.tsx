"use client";

import { useEffect, useId, useRef, useState, type Ref } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ReadOnlyInput } from "@/components/ui/read-only-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ClientAddressInput, ClientAddressView } from "@/lib/client-addresses";
import type { RegionLevel, ShipmentRegion } from "@/lib/shipment-regions";

/**
 * CheckoutAddressDialog — satu form cohesive untuk menambah DAN mengoreksi
 * alamat dari checkout. Komponen ini hanya adapter browser ke API alamat
 * existing (`POST /api/addresses`, `PATCH /api/addresses/{id}`); tidak ada
 * import DB/persistence dan tidak ada quote di dalamnya.
 *
 * Kontrak yang dijaga:
 * - Draft hanya hidup di modal. Tidak ada ID/card sukses palsu sebelum server
 *   mengembalikan `ClientAddressView`.
 * - Satu konfirmasi = satu `Idempotency-Key`; retry setelah respons tidak pasti
 *   memakai key + body yang SAMA (tidak ada UUID baru diam-diam).
 * - Penutupan modal tidak berarti write server dibatalkan: setelah status tidak
 *   pasti, "Tutup" tidak mengklaim Batal, dan edit memakai "Periksa alamat"
 *   (GET) alih-alih mengulang PATCH otomatis.
 * - Validasi kontak checkout (8–15 digit) diperiksa di sini supaya create tidak
 *   berhasil lalu ditolak saat "Lanjut"; aturan global Buku Alamat tidak diubah.
 */
export interface CheckoutAddressDialogProps {
  open: boolean;
  mode: "create" | "edit";
  initialAddress: ClientAddressView | null;
  triggerElement: HTMLButtonElement | null;
  onOpenChange(open: boolean): void;
  onBusyChange(busy: boolean): void;
  onSaved(address: ClientAddressView, kind: "created" | "updated"): void;
}

type Phase = "idle" | "saving" | "checking" | "unknown" | "error" | "conflict" | "missing";

interface DraftErrors {
  recipientName?: string;
  phone?: string;
  fullAddress?: string;
  region?: string;
  postalCode?: string;
}

const regionLevels: RegionLevel[] = ["provinces", "cities", "districts", "areas"];
const regionFields = ["provinceId", "cityId", "districtId", "areaId"] as const;
const regionLabels = ["Provinsi", "Kota/Kabupaten", "Kecamatan", "Kelurahan/Area"];

const CHECKOUT_PHONE_DIGITS = { min: 8, max: 15 };

function emptyDraft(): ClientAddressInput {
  return {
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
}

function draftOf(address: ClientAddressView): ClientAddressInput {
  return {
    recipientName: address.recipientName,
    phone: address.phone,
    fullAddress: address.fullAddress,
    provinceId: address.provinceId,
    cityId: address.cityId,
    districtId: address.districtId,
    areaId: address.areaId,
    postalCode: address.postalCode,
    isDefault: address.isDefault,
  };
}

/** Destination identity used by the edit "Periksa alamat" reconciliation. */
function sameDestination(stored: ClientAddressView, draft: ClientAddressInput): boolean {
  return (
    stored.recipientName === draft.recipientName.trim() &&
    stored.phone === draft.phone.trim() &&
    stored.fullAddress === draft.fullAddress.trim() &&
    stored.provinceId === draft.provinceId &&
    stored.cityId === draft.cityId &&
    stored.districtId === draft.districtId &&
    stored.areaId === draft.areaId &&
    stored.postalCode === draft.postalCode
  );
}

function validateDraft(draft: ClientAddressInput): DraftErrors {
  const errors: DraftErrors = {};
  const recipientName = draft.recipientName.trim();
  if (!recipientName) errors.recipientName = "Nama penerima wajib diisi.";
  else if (recipientName.length > 120)
    errors.recipientName = "Nama penerima maksimal 120 karakter.";
  const phone = draft.phone.trim();
  if (!phone) errors.phone = "Nomor telepon wajib diisi.";
  else if (!/^[0-9+()\-\s]{5,25}$/.test(phone)) errors.phone = "Nomor telepon tidak valid.";
  else {
    const digits = phone.replace(/\D/g, "").length;
    if (digits < CHECKOUT_PHONE_DIGITS.min || digits > CHECKOUT_PHONE_DIGITS.max)
      errors.phone = `Nomor telepon penerima harus berisi ${CHECKOUT_PHONE_DIGITS.min}–${CHECKOUT_PHONE_DIGITS.max} angka.`;
  }
  const fullAddress = draft.fullAddress.trim();
  if (!fullAddress) errors.fullAddress = "Alamat lengkap wajib diisi.";
  else if (fullAddress.length > 500)
    errors.fullAddress = "Alamat lengkap maksimal 500 karakter.";
  if (!draft.provinceId || !draft.cityId || !draft.districtId || !draft.areaId)
    errors.region = "Lengkapi provinsi, kota/kabupaten, kecamatan, dan kelurahan/area.";
  if (!draft.postalCode) errors.postalCode = "Kode pos belum tersedia dari wilayah yang dipilih.";
  else if (!/^\d{3,10}$/.test(draft.postalCode)) errors.postalCode = "Kode pos tidak valid.";
  return errors;
}

function CheckoutRegion({
  index,
  parentId,
  value,
  disabled,
  triggerRef,
  onPick,
}: {
  index: number;
  parentId?: string;
  value: string;
  disabled: boolean;
  triggerRef?: Ref<HTMLButtonElement>;
  onPick: (value: string, postalCode?: string) => void;
}) {
  const [options, setOptions] = useState<ShipmentRegion[]>([]);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    if (index > 0 && !parentId) {
      setOptions([]);
      return () => controller.abort();
    }
    fetch(
      `/api/shipment/regions?level=${regionLevels[index]}${parentId ? `&parentId=${encodeURIComponent(parentId)}` : ""}`,
      { signal: controller.signal }
    )
      .then(async (res) => {
        if (!res.ok) throw new Error("Region unavailable");
        return res.json();
      })
      .then((body) => {
        if (!controller.signal.aborted) {
          setOptions(body.data);
          setError(false);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [index, parentId, retry]);
  return (
    <div className="space-y-1">
      <Label
        id={`checkout-${regionFields[index]}-label`}
        htmlFor={`checkout-${regionFields[index]}`}
        required
      >
        {regionLabels[index]}
      </Label>
      <Select
        value={value}
        disabled={disabled || (index > 0 && !parentId) || error}
        onValueChange={(id) =>
          onPick(id, options.find((row) => row.id === id)?.postalCode)
        }
      >
        <SelectTrigger
          id={`checkout-${regionFields[index]}`}
          ref={triggerRef}
          className="checkout-prompt"
          aria-labelledby={`checkout-${regionFields[index]}-label`}
          aria-required="true"
        >
          <SelectValue placeholder={`Pilih ${regionLabels[index]}`} />
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
        <div className="space-y-1">
          <p className="text-xs text-destructive">Wilayah belum dapat dimuat.</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setRetry((n) => n + 1)}
          >
            Coba lagi wilayah
          </Button>
        </div>
      )}
    </div>
  );
}

export default function CheckoutAddressDialog({
  open,
  mode,
  initialAddress,
  triggerElement,
  onOpenChange,
  onBusyChange,
  onSaved,
}: CheckoutAddressDialogProps) {
  const [draft, setDraft] = useState<ClientAddressInput>(emptyDraft);
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const [phase, setPhase] = useState<Phase>("idle");
  const [errors, setErrors] = useState<DraftErrors>({});
  const [summary, setSummary] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const recipientRef = useRef<HTMLInputElement | null>(null);
  const phoneRef = useRef<HTMLInputElement | null>(null);
  const streetRef = useRef<HTMLInputElement | null>(null);
  const provinceRef = useRef<HTMLButtonElement | null>(null);
  const previousOpen = useRef(false);
  const descriptionId = useId();

  // Satu konfirmasi menghasilkan satu key; hanya penutupan sukses/awal modal
  // yang memulai key baru, bukan retry dari status yang belum pasti.
  useEffect(() => {
    if (open && !previousOpen.current) {
      setDraft(
        mode === "edit" && initialAddress ? draftOf(initialAddress) : emptyDraft()
      );
      setRequestKey(crypto.randomUUID());
      setPhase("idle");
      setErrors({});
      setSummary(null);
      setNotice(null);
    }
    previousOpen.current = open;
  }, [open, mode, initialAddress]);

  const inFlight = phase === "saving" || phase === "checking";
  const unresolved = phase === "unknown";

  useEffect(() => {
    // Hanya dialog yang terbuka boleh menahan langkah berikutnya; setelah
    // ditutup, status "tidak pasti" tetap terlihat di modal saat dibuka lagi.
    onBusyChange(open && (inFlight || unresolved));
  }, [open, inFlight, unresolved, onBusyChange]);

  function close() {
    // Saving/checking: close is held (not a rollback). Unknown: close is allowed
    // but never claims the write was cancelled.
    if (inFlight) return;
    onOpenChange(false);
  }

  function focusFirstError(next: DraftErrors) {
    if (next.recipientName) recipientRef.current?.focus();
    else if (next.phone) phoneRef.current?.focus();
    else if (next.region) provinceRef.current?.focus();
    else if (next.fullAddress) streetRef.current?.focus();
  }

  function applyServerValidation(message: string | null) {
    setNotice(message);
    setPhase("error");
  }

  async function submit() {
    const next = validateDraft(draft);
    setErrors(next);
    if (Object.keys(next).length > 0) {
      setSummary(
        next.phone && Object.keys(next).length === 1
          ? null
          : "Lengkapi nama, telepon, wilayah, dan alamat."
      );
      setNotice(null);
      focusFirstError(next);
      return;
    }
    setErrors({});
    setSummary(null);
    setNotice(null);
    setPhase("saving");
    const payload: ClientAddressInput = {
      recipientName: draft.recipientName.trim(),
      phone: draft.phone.trim(),
      fullAddress: draft.fullAddress.trim(),
      provinceId: draft.provinceId,
      cityId: draft.cityId,
      districtId: draft.districtId,
      areaId: draft.areaId,
      postalCode: draft.postalCode,
      isDefault: draft.isDefault,
    };
    const target =
      mode === "create" ? "/api/addresses" : `/api/addresses/${initialAddress?.id ?? ""}`;
    try {
      const response = await fetch(target, {
        method: mode === "create" ? "POST" : "PATCH",
        headers:
          mode === "create"
            ? { "Content-Type": "application/json", "Idempotency-Key": requestKey }
            : { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (response.status === 409) {
        setPhase("conflict");
        return;
      }
      if (response.status === 404) {
        setPhase("missing");
        return;
      }
      const body = await response.json().catch(() => null);
      if (
        response.ok &&
        body?.success &&
        body.data &&
        typeof body.data.id === "string"
      ) {
        onSaved(body.data as ClientAddressView, mode === "create" ? "created" : "updated");
        setPhase("idle");
        onOpenChange(false);
        return;
      }
      if (response.status >= 500) {
        // The write may already have committed before the failure was reported.
        setPhase("unknown");
        return;
      }
      applyServerValidation(
        body?.error ?? "Periksa alamat dan wilayah yang dipilih."
      );
    } catch {
      setPhase("unknown");
    }
  }

  /** Edit reconciliation: read the same row back instead of repeating a write. */
  async function checkStoredAddress() {
    setPhase("checking");
    setNotice(null);
    try {
      const response = await fetch("/api/addresses", { cache: "no-store" });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.success || !Array.isArray(body.data)) {
        setPhase("unknown");
        return;
      }
      const stored =
        (body.data as ClientAddressView[]).find(
          (row) => row.id === initialAddress?.id
        ) ?? null;
      if (!stored) {
        setPhase("missing");
        return;
      }
      if (sameDestination(stored, draft)) {
        onSaved(stored, "updated");
        setPhase("idle");
        onOpenChange(false);
        return;
      }
      setDraft(draftOf(stored));
      setPhase("idle");
      setSummary("Alamat tersimpan masih berbeda. Periksa lalu simpan perubahan.");
    } catch {
      setPhase("unknown");
    }
  }

  /** Kelengkapan form (bukan validasi penuh): tombol utama menunggu field wajib. */
  const complete = Boolean(
    draft.recipientName.trim() &&
      draft.phone.trim() &&
      draft.fullAddress.trim() &&
      draft.provinceId &&
      draft.cityId &&
      draft.districtId &&
      draft.areaId &&
      draft.postalCode
  );

  const title = mode === "create" ? "Alamat baru" : "Ubah alamat";
  const description =
    mode === "create"
      ? "Alamat akan disimpan ke Buku Alamat dan digunakan untuk pengiriman."
      : "Perubahan disimpan ke Buku Alamat. Ongkir akan diperiksa ulang.";
  const disabled = inFlight || unresolved;
  const primaryLabel =
    phase === "saving"
      ? "Menyimpan alamat…"
      : phase === "checking"
        ? "Memeriksa alamat…"
        : unresolved
          ? mode === "create"
            ? "Coba simpan lagi"
            : "Periksa alamat"
          : mode === "create"
            ? "Simpan dan gunakan"
            : "Simpan perubahan";

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          close();
          return;
        }
        onOpenChange(next);
      }}
    >
      <DialogContent
        closeButtonSize="comfortable"
        aria-describedby={descriptionId}
        className="max-h-[90dvh] gap-0 overflow-hidden p-0 sm:max-w-2xl"
        onEscapeKeyDown={(event) => {
          if (inFlight) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (inFlight) event.preventDefault();
        }}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          recipientRef.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          // Fokus kembali ke tombol pembuka, bukan hilang ke body.
          event.preventDefault();
          triggerElement?.focus();
        }}
      >
        <div className="flex max-h-[90dvh] min-h-0 flex-col">
          <DialogHeader className="p-6 pb-3">
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription id={descriptionId}>{description}</DialogDescription>
          </DialogHeader>
          {/* Body scrolls; aksi utama tetap terlihat di footer (mobile 390px). */}
          <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-4">
            <p className="mb-3 text-xs text-muted-foreground">
              <span aria-hidden="true">*</span> Wajib diisi
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="checkout-recipient" required>
                  Nama Penerima
                </Label>
                <Input
                  id="checkout-recipient"
                  ref={recipientRef}
                  required
                  disabled={disabled}
                  autoComplete="shipping name"
                  value={draft.recipientName}
                  aria-invalid={Boolean(errors.recipientName)}
                  aria-describedby={
                    errors.recipientName ? "checkout-recipient-error" : undefined
                  }
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, recipientName: e.target.value }))
                  }
                />
                {errors.recipientName && (
                  <p id="checkout-recipient-error" className="text-xs text-destructive">
                    {errors.recipientName}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="checkout-phone" required>
                  Telepon Penerima
                </Label>
                <Input
                  id="checkout-phone"
                  ref={phoneRef}
                  required
                  disabled={disabled}
                  type="tel"
                  autoComplete="shipping tel"
                  value={draft.phone}
                  aria-invalid={Boolean(errors.phone)}
                  aria-describedby={errors.phone ? "checkout-phone-error" : undefined}
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, phone: e.target.value }))
                  }
                />
                {errors.phone && (
                  <p id="checkout-phone-error" className="text-xs text-destructive">
                    {errors.phone}
                  </p>
                )}
              </div>
              {regionFields.map((field, index) => (
                <CheckoutRegion
                  key={`${field}:${index > 0 ? draft[regionFields[index - 1]] : "root"}`}
                  index={index}
                  value={draft[field]}
                  disabled={disabled}
                  triggerRef={index === 0 ? provinceRef : undefined}
                  parentId={index > 0 ? draft[regionFields[index - 1]] : undefined}
                  onPick={(id, postalCode) =>
                    setDraft((prev) => {
                      // Pergantian wilayah induk mengosongkan turunan + kode pos;
                      // label wilayah dari browser bukan sumber canonical.
                      const next = { ...prev, [field]: id, postalCode: postalCode ?? "" };
                      for (let n = index + 1; n < regionFields.length; n++) next[regionFields[n]] = "";
                      return next;
                    })
                  }
                />
              ))}
              {errors.region && (
                <p className="text-xs text-destructive sm:col-span-2">{errors.region}</p>
              )}
              <div className="space-y-2">
                <Label htmlFor="checkout-postal">Kode Pos</Label>
                <ReadOnlyInput
                  id="checkout-postal"
                  value={draft.postalCode}
                  hint="Terisi otomatis dari Kelurahan/Area."
                />
                {errors.postalCode && (
                  <p className="text-xs text-destructive">{errors.postalCode}</p>
                )}
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="checkout-street" required>
                  Alamat Lengkap
                </Label>
                <Input
                  id="checkout-street"
                  ref={streetRef}
                  className="checkout-prompt"
                  required
                  disabled={disabled}
                  value={draft.fullAddress}
                  placeholder="Jalan, nomor rumah, unit, dan patokan"
                  aria-invalid={Boolean(errors.fullAddress)}
                  aria-describedby={
                    errors.fullAddress ? "checkout-street-error" : undefined
                  }
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, fullAddress: e.target.value }))
                  }
                />
                {errors.fullAddress && (
                  <p id="checkout-street-error" className="text-xs text-destructive">
                    {errors.fullAddress}
                  </p>
                )}
              </div>
              <label className="flex items-start gap-2 text-sm sm:col-span-2">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4"
                  checked={draft.isDefault}
                  disabled={disabled}
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, isDefault: e.target.checked }))
                  }
                />
                <span>
                  Jadikan alamat utama
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    Opsional. Alamat lain tidak otomatis menjadi utama.
                  </span>
                </span>
              </label>
            </div>
            {(summary ||
              notice ||
              phase === "conflict" ||
              phase === "missing" ||
              phase === "unknown") && (
              <div role="alert" className="mt-4 space-y-1 text-sm">
                {summary && <p className="text-muted-foreground">{summary}</p>}
                {notice && <p className="text-destructive">{notice}</p>}
                {phase === "conflict" && (
                  <p className="text-destructive">
                    Permintaan alamat berbeda. Periksa Buku Alamat sebelum menambahkan lagi.
                  </p>
                )}
                {phase === "missing" && (
                  <p className="text-destructive">
                    Alamat tidak ditemukan. Pilih alamat lain atau tambahkan alamat baru.
                  </p>
                )}
                {phase === "unknown" && (
                  <p className="text-destructive">
                    {mode === "create"
                      ? "Status penyimpanan belum dapat dipastikan. Coba lagi untuk memeriksa permintaan yang sama."
                      : "Status perubahan belum dapat dipastikan. Periksa alamat tersimpan."}
                  </p>
                )}
              </div>
            )}
          </div>
          <DialogFooter className="gap-2 border-t p-6 pt-4">
            {!complete && !unresolved && !inFlight && (
              <p className="mr-auto self-center text-xs text-muted-foreground">
                Lengkapi nama, telepon, wilayah, dan alamat.
              </p>
            )}
            {phase === "saving" && (
              <p
                role="status"
                className="mr-auto flex items-center gap-2 self-center text-xs text-muted-foreground"
              >
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Menyimpan alamat…
              </p>
            )}
            <Button type="button" variant="outline" onClick={close} disabled={inFlight}>
              {unresolved ? "Tutup" : "Batal"}
            </Button>
            <Button
              type="button"
              onClick={() => {
                if (unresolved) {
                  if (mode === "create") void submit();
                  else void checkStoredAddress();
                  return;
                }
                void submit();
              }}
              disabled={inFlight || phase === "missing" || (!unresolved && !complete)}
              aria-busy={inFlight}
            >
              {primaryLabel}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

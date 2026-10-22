"use client";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlertTriangle, Check, Loader2, Tag, X } from "lucide-react";

export interface AvailableOffer {
  offerId: string;
  name: string;
  /** Nominal aktual untuk context ini (hasil floor/clip/cap); "0" bila tidak eligible. */
  benefitAmount: string;
  benefitKind: "fixed_goods" | "percentage_goods" | null;
  rate: string | null;
  capAmount: string | null;
  minSubtotal: string;
  endsAt: string | null;
  eligible: boolean;
  reason: string | null;
  reasonMessage: string | null;
}

/** Pilihan yang tersimpan di browser tetapi sudah gugur di server (ticket 08). */
export interface PromoInvalidation {
  offerId: string;
  message: string;
}

interface PromoSelectorProps {
  offers: AvailableOffer[];
  /** Manual Promo Code yang sudah diterapkan pada review terakhir. */
  appliedManualCode: { code: string; offerId: string; codeId: string } | null;
  manualCodeError: string | null;
  manualPending: boolean;
  onApplyManualCode: (code: string) => void;
  onClearManual: () => void;
  selectedOfferId: string | null;
  /** Alasan aman mengapa pilihan tersimpan tidak bisa dipakai lagi. */
  invalidated: PromoInvalidation | null;
  /** Kandidat yang sedang diperiksa server (Pilih/Terapkan = penggantian). */
  pendingOfferId: string | null;
  loading: boolean;
  error: string | null;
  disabled?: boolean;
  onSelect: (offerId: string) => void;
  onClear: () => void;
  onContinueWithout: () => void;
  onRetry: () => void;
}

function rupiah(value: string): string {
  return Number(value).toLocaleString("id-ID");
}

/** Label benefit: percentage menampilkan rate+cap (nominal tetap menampilkan Rp). */
function benefitLabel(offer: AvailableOffer): string {
  if (offer.benefitKind === "percentage_goods" && offer.rate) {
    return offer.capAmount
      ? `Diskon ${offer.rate}% (maks Rp ${rupiah(offer.capAmount)})`
      : `Diskon ${offer.rate}%`;
  }
  return `Potongan Rp ${rupiah(offer.benefitAmount)}`;
}

function endLabel(endsAt: string | null): string | null {
  if (!endsAt) return null;
  const date = new Date(endsAt);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Jakarta",
  });
}

/**
 * Pemilihan Coupon publik tanpa claim pada checkout pickup (ticket 07).
 * Hanya menampilkan Offer yang dikembalikan server (publik/enabled/aktif).
 * Offer yang belum eligible tetap terlihat, disabled dengan alasan aman.
 *
 * Ticket 08: pilihan yang gugur TIDAK dihapus diam-diam. Card menampilkan alasan
 * dari server dan menawarkan pilihan ulang atau "Lanjut tanpa promo" eksplisit;
 * `Pilih/Terapkan` adalah tindakan penggantian yang diperiksa server (dialog
 * hanya muncul bila total final naik).
 */
export function PromoSelector({
  offers,
  appliedManualCode,
  manualCodeError,
  manualPending,
  onApplyManualCode,
  onClearManual,
  selectedOfferId,
  invalidated,
  pendingOfferId,
  loading,
  error,
  disabled,
  onSelect,
  onClear,
  onContinueWithout,
  onRetry,
}: PromoSelectorProps) {
  const [manualCode, setManualCode] = useState("");
  const selected = offers.find((offer) => offer.offerId === selectedOfferId) ?? null;
  const invalidatedSelected = invalidated?.offerId === selectedOfferId;
  const validSelection = selected != null && selected.eligible && !invalidatedSelected;

  return (
    <div className="mb-6 rounded-lg border p-4">
      <div className="mb-3 flex items-start gap-2">
        <Tag className="mt-0.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <div>
          <h3 className="text-sm font-semibold">Promo</h3>
          <p className="text-xs text-muted-foreground">
            Pilih satu kupon untuk pesanan ini. Mengganti kupon atau melepasnya
            dihitung ulang oleh server; pemilihan tidak memesan kapasitas.
          </p>
        </div>
      </div>

      {invalidated && (
        <div
          role="alert"
          className="mb-3 rounded-lg border border-amber-300 border-l-4 border-l-amber-500 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:border-l-amber-500 dark:bg-amber-950/50"
        >
          <p className="flex items-center gap-2 font-medium text-amber-900 dark:text-amber-100">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
            Promo sebelumnya tidak lagi berlaku
          </p>
          <p className="mt-1 text-amber-900/90 dark:text-amber-100/90">
            {invalidated.message}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onContinueWithout}
              disabled={disabled}
            >
              Lanjut tanpa promo
            </Button>
            <span className="text-xs text-muted-foreground">
              atau pilih promo lain di bawah.
            </span>
          </div>
        </div>
      )}

      {loading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Memuat promo…
        </p>
      ) : error ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
          <span>{error}</span>
          <Button type="button" variant="outline" size="sm" onClick={onRetry} disabled={disabled}>
            Coba lagi
          </Button>
        </div>
      ) : offers.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Belum ada promo yang tersedia untuk pilihan ini.
        </p>
      ) : (
        <ul className="space-y-2">
          {offers.map((offer) => {
            const isSelected = offer.offerId === selectedOfferId;
            const isInvalidated = isSelected && invalidatedSelected;
            const blocked = disabled || !offer.eligible || pendingOfferId != null;
            const pending = pendingOfferId === offer.offerId;
            return (
              <li key={offer.offerId}>
                <button
                  type="button"
                  aria-pressed={isSelected && !isInvalidated}
                  disabled={blocked}
                  onClick={() => onSelect(offer.offerId)}
                  className={`flex w-full items-start justify-between gap-3 rounded-lg border p-3 text-left transition ${
                    isSelected && !isInvalidated
                      ? "border-primary bg-primary/5"
                      : "border-input hover:bg-muted/50"
                  } ${blocked ? "cursor-not-allowed opacity-60" : ""}`}
                >
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{offer.name}</span>
                      <Badge variant="secondary">{benefitLabel(offer)}</Badge>
                      {isSelected && !isInvalidated && (
                        <Badge className="gap-1">
                          <Check className="h-3 w-3" aria-hidden="true" /> Dipakai
                        </Badge>
                      )}
                      {isInvalidated && <Badge variant="outline">Tidak berlaku</Badge>}
                      {pending && (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                          Memeriksa…
                        </span>
                      )}
                    </span>
                    {Number(offer.minSubtotal) > 0 && (
                      <span className="mt-1 block text-xs text-muted-foreground">
                        Min. belanja Rp {rupiah(offer.minSubtotal)}
                      </span>
                    )}
                    {endLabel(offer.endsAt) && (
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        Berlaku sampai {endLabel(offer.endsAt)}
                      </span>
                    )}
                    {!offer.eligible && offer.reasonMessage && (
                      <span className="mt-1 block text-xs font-medium text-amber-700 dark:text-amber-400">
                        {offer.reasonMessage}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {validSelection && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-3 gap-1"
          onClick={onClear}
          disabled={disabled || pendingOfferId != null}
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" /> Pakai tanpa promo
        </Button>
      )}

      <div className="mt-4 border-t pt-3">
        <label htmlFor="manual-promo-code" className="text-sm font-medium">
          Punya kode promo?
        </label>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Masukkan kode lalu tekan Terapkan. Kode diperiksa server; kode yang
          tidak berlaku tidak mengganti promo yang sudah dipakai.
        </p>
        <form
          className="mt-2 flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (manualCode.trim().length < 3) return;
            onApplyManualCode(manualCode);
          }}
        >
          <Input
            id="manual-promo-code"
            name="manual-promo-code"
            value={manualCode}
            onChange={(event) => setManualCode(event.target.value)}
            maxLength={64}
            autoComplete="off"
            spellCheck={false}
            placeholder="Contoh: HEMAT17AGUSTUS"
            className="h-9 w-full max-w-xs font-mono text-sm uppercase"
            disabled={disabled || manualPending}
          />
          <Button
            type="submit"
            size="sm"
            disabled={disabled || manualPending || manualCode.trim().length < 3}
          >
            {manualPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            ) : null}
            Terapkan
          </Button>
        </form>
        {manualCodeError && (
          <p role="alert" className="mt-2 text-xs font-medium text-destructive">
            {manualCodeError}
          </p>
        )}
        {appliedManualCode && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge className="gap-1 font-mono">
              <Check className="h-3 w-3" aria-hidden="true" />
              {appliedManualCode.code}
            </Badge>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="gap-1"
              onClick={onClearManual}
              disabled={disabled || pendingOfferId != null}
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" /> Lepas kode
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

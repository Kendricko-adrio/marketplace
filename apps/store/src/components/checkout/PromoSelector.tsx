"use client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Check, Loader2, Tag, X } from "lucide-react";

export interface AvailableOffer {
  offerId: string;
  name: string;
  benefitAmount: string;
  minSubtotal: string;
  endsAt: string | null;
  eligible: boolean;
  reason: string | null;
  reasonMessage: string | null;
}

interface PromoSelectorProps {
  offers: AvailableOffer[];
  selectedOfferId: string | null;
  loading: boolean;
  error: string | null;
  disabled?: boolean;
  onSelect: (offerId: string) => void;
  onClear: () => void;
  onRetry: () => void;
}

function rupiah(value: string): string {
  return Number(value).toLocaleString("id-ID");
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
 */
export function PromoSelector({
  offers,
  selectedOfferId,
  loading,
  error,
  disabled,
  onSelect,
  onClear,
  onRetry,
}: PromoSelectorProps) {
  const selected = offers.find((offer) => offer.offerId === selectedOfferId) ?? null;

  return (
    <div className="mb-6 rounded-lg border p-4">
      <div className="mb-3 flex items-start gap-2">
        <Tag className="mt-0.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <div>
          <h3 className="text-sm font-semibold">Promo</h3>
          <p className="text-xs text-muted-foreground">
            Pilih satu kupon untuk pesanan ini. Pemilihan tidak memesan kapasitas;
            total final termasuk promo dihitung pada langkah review.
          </p>
        </div>
      </div>

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
            const blocked = disabled || !offer.eligible;
            return (
              <li key={offer.offerId}>
                <button
                  type="button"
                  aria-pressed={isSelected}
                  disabled={blocked}
                  onClick={() => onSelect(offer.offerId)}
                  className={`flex w-full items-start justify-between gap-3 rounded-lg border p-3 text-left transition ${
                    isSelected
                      ? "border-primary bg-primary/5"
                      : "border-input hover:bg-muted/50"
                  } ${blocked ? "cursor-not-allowed opacity-60" : ""}`}
                >
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{offer.name}</span>
                      <Badge variant="secondary">
                        Potongan Rp {rupiah(offer.benefitAmount)}
                      </Badge>
                      {isSelected && (
                        <Badge className="gap-1">
                          <Check className="h-3 w-3" aria-hidden="true" /> Dipakai
                        </Badge>
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

      {selected && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-3 gap-1"
          onClick={onClear}
          disabled={disabled}
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" /> Pakai tanpa promo
        </Button>
      )}
    </div>
  );
}

"use client";

import { Button } from "@/components/ui/button";
import type { ClientAddressView } from "@/lib/client-addresses";

/**
 * Satu presentasi pasif tujuan pengiriman yang lengkap.
 *
 * Dipakai untuk SEMUA sumber alamat (alamat tersimpan, alamat utama yang dipilih
 * otomatis, dan hasil tambah/ubah dari checkout) supaya dua alamat dengan nama
 * penerima sama tetap bisa dibedakan dari detail tujuannya, bukan dari tooltip.
 * Tidak ada truncation/line-clamp: nama penerima, telepon, jalan, wilayah, dan
 * kode pos adalah informasi pemeriksaan sebelum membayar.
 *
 * `onEdit` hanya diberikan bila aksi itu memang tersedia untuk alamat tersebut
 * (batas D3: hasil create sesi panel checkout ini).
 */
export default function CheckoutAddressCard({
  address,
  onEdit,
}: {
  address: ClientAddressView;
  onEdit?: () => void;
}) {
  // Alamat legacy / respons API lama bisa tidak membawa label wilayah; kartu
  // tidak boleh crash karena field opsional itu.
  const textOf = (value: unknown) => (typeof value === "string" ? value.trim() : "");
  const areaLine = [textOf(address.area), textOf(address.district)]
    .filter((part) => part.length > 0)
    .join(", ");
  const cityLine = [
    [textOf(address.city), textOf(address.province)]
      .filter((part) => part.length > 0)
      .join(", "),
    textOf(address.postalCode) ? `Kode pos ${textOf(address.postalCode)}` : "",
  ]
    .filter((part) => part.length > 0)
    .join(" · ");

  return (
    <div
      role="group"
      aria-label="Alamat terpilih"
      className="mt-4 rounded-lg border bg-muted/30 p-4 text-sm"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <p className="text-xs font-medium text-muted-foreground">
            Alamat terpilih
          </p>
          <p className="break-words font-medium">
            {textOf(address.recipientName) || "Nama penerima belum diisi"}
          </p>
          {textOf(address.phone) && (
            <p className="break-words tabular-nums">{textOf(address.phone)}</p>
          )}
          <p className="break-words">{textOf(address.fullAddress)}</p>
          {areaLine && <p className="break-words text-muted-foreground">{areaLine}</p>}
          {cityLine && <p className="break-words text-muted-foreground">{cityLine}</p>}
          {address.isDefault && (
            <p className="pt-1">
              <span className="inline-flex items-center rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                Alamat utama
              </span>
            </p>
          )}
        </div>
        {onEdit && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0 self-start"
            onClick={onEdit}
          >
            Ubah alamat
          </Button>
        )}
      </div>
    </div>
  );
}

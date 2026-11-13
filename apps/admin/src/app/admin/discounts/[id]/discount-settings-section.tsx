"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DiscountNumberInput } from "./discount-number-input";
import type { DiscountEditorForm } from "./discount-editor-state";

/**
 * Tab **Pengaturan**: identitas, potongan, minimum, jadwal, batas penggunaan,
 * dan batas per customer. Semua field menulis ke SATU state draft; tidak ada
 * tombol simpan per kelompok di sini.
 */
export function DiscountSettingsSection(props: {
  form: DiscountEditorForm;
  disabled: boolean;
  fieldErrors: Record<string, string>;
  onChange: (patch: Partial<DiscountEditorForm>) => void;
}) {
  const { form, fieldErrors, onChange, disabled } = props;
  const error = (path: string) => fieldErrors[path] ?? null;

  return (
    <div className="space-y-8">
      <p className="text-xs text-muted-foreground">* Wajib diisi untuk publish.</p>

      <fieldset className="min-w-0 space-y-4">
        <legend className="text-sm font-semibold">Identitas</legend>
        <div className="space-y-2">
          <Label htmlFor="discount-name">Nama diskon*</Label>
          <Input
            id="discount-name"
            value={form.name}
            disabled={disabled}
            maxLength={120}
            aria-invalid={error("name") ? true : undefined}
            aria-describedby={error("name") ? "discount-name-error" : undefined}
            onChange={(event) => onChange({ name: event.target.value })}
            placeholder="Diskon Rp17.000 Sepatu Pilihan"
          />
          {error("name") ? (
            <p id="discount-name-error" className="text-xs text-destructive">
              {error("name")}
            </p>
          ) : null}
        </div>
      </fieldset>

      <fieldset className="min-w-0 space-y-4 border-t pt-6">
        <legend className="text-sm font-semibold">Potongan</legend>
        <div className="space-y-2">
          <Label htmlFor="discount-benefit-kind">Jenis potongan*</Label>
          <Select
            value={form.benefitKind || undefined}
            disabled={disabled}
            onValueChange={(value) =>
              // Parameter kind sebelumnya dikosongkan, bukan dikirim tersembunyi.
              onChange({
                benefitKind: value as DiscountEditorForm["benefitKind"],
                fixedAmount: value === "fixed_goods" ? form.fixedAmount : "",
                rate: value === "percentage_goods" ? form.rate : "",
                capAmount:
                  value === "percentage_goods" || value === "shipping"
                    ? form.capAmount
                    : "",
              })
            }
          >
            <SelectTrigger
              id="discount-benefit-kind"
              aria-invalid={error("benefit") || error("benefit.kind") ? true : undefined}
            >
              <SelectValue placeholder="Pilih jenis potongan" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="fixed_goods">Nominal tetap</SelectItem>
              <SelectItem value="percentage_goods">Persentase</SelectItem>
              <SelectItem value="shipping">Subsidi ongkir</SelectItem>
            </SelectContent>
          </Select>
          {error("benefit") ?? error("benefit.kind") ? (
            <p className="text-xs text-destructive">
              {error("benefit") ?? error("benefit.kind")}
            </p>
          ) : null}
        </div>

        {form.benefitKind === "fixed_goods" ? (
          <DiscountNumberInput
            id="discount-fixed-amount"
            label="Nominal potongan barang*"
            kind="money"
            value={form.fixedAmount}
            disabled={disabled}
            error={error("benefit.fixedAmount")}
            hint="Berlaku sekali per pesanan, maksimal sebesar subtotal setelah harga coret."
            onValueChange={(next) => onChange({ fixedAmount: next })}
          />
        ) : form.benefitKind === "shipping" ? (
          <DiscountNumberInput
            id="discount-shipping-cap"
            label="Maksimum subsidi ongkir*"
            kind="money"
            value={form.capAmount}
            disabled={disabled}
            error={error("benefit.capAmount")}
            hint="Berlaku untuk pengiriman, maksimal sebesar ongkir. Sisa subsidi tidak dapat dipakai lagi."
            onValueChange={(next) => onChange({ capAmount: next })}
          />
        ) : form.benefitKind === "percentage_goods" ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <DiscountNumberInput
              id="discount-rate"
              label="Persentase diskon*"
              kind="percent"
              value={form.rate}
              disabled={disabled}
              error={error("benefit.rate")}
              hint="Lebih dari 0 sampai 100%; ketikan yang melewati 100% ditolak. Maksimal 6 angka desimal."
              onValueChange={(next) => onChange({ rate: next })}
            />
            <DiscountNumberInput
              id="discount-cap"
              label="Maksimum potongan per pesanan"
              kind="money"
              optional
              value={form.capAmount}
              disabled={disabled}
              error={error("benefit.capAmount")}
              hint="Kosongkan jika tanpa batas."
              onValueChange={(next) => onChange({ capAmount: next })}
            />
          </div>
        ) : null}
      </fieldset>

      <fieldset className="min-w-0 space-y-4 border-t pt-6">
        <legend className="text-sm font-semibold">Minimum</legend>
        <DiscountNumberInput
          id="discount-min-subtotal"
          label="Minimum belanja*"
          kind="money"
          value={form.minSubtotal}
          disabled={disabled}
          error={error("minSubtotal")}
          hint="Setelah harga coret; 0 = tanpa minimum."
          onValueChange={(next) => onChange({ minSubtotal: next })}
        />
      </fieldset>

      <fieldset className="min-w-0 space-y-4 border-t pt-6">
        <legend className="text-sm font-semibold">Jadwal</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="discount-start">
              Mulai (WIB)<span className="ml-1 font-normal text-muted-foreground">(opsional)</span>
            </Label>
            <Input
              id="discount-start"
              type="datetime-local"
              value={form.startAt}
              disabled={disabled}
              aria-invalid={error("startAt") ? true : undefined}
              onChange={(event) => onChange({ startAt: event.target.value })}
            />
            <p className="text-xs text-muted-foreground">Kosong = berlaku setelah publish.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="discount-end">
              Berakhir (WIB)<span className="ml-1 font-normal text-muted-foreground">(opsional)</span>
            </Label>
            <Input
              id="discount-end"
              type="datetime-local"
              value={form.endAt}
              disabled={disabled}
              aria-invalid={error("endAt") ? true : undefined}
              onChange={(event) => onChange({ endAt: event.target.value })}
            />
            <p className="text-xs text-muted-foreground">Kosong = tanpa tanggal berakhir.</p>
          </div>
        </div>
        {error("startAt") ?? error("endAt") ? (
          <p className="text-xs text-destructive">{error("startAt") ?? error("endAt")}</p>
        ) : null}
      </fieldset>

      <fieldset className="min-w-0 space-y-4 border-t pt-6">
        <legend className="text-sm font-semibold">Batas penggunaan*</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="discount-quota">
              Kuota pemakaian<span className="ml-1 font-normal text-muted-foreground">(opsional)</span>
            </Label>
            <Input
              id="discount-quota"
              inputMode="numeric"
              autoComplete="off"
              value={form.quota}
              disabled={disabled}
              aria-invalid={error("capacity.quotaCount") ? true : undefined}
              onChange={(event) => onChange({ quota: event.target.value })}
              placeholder="Kosong = tanpa kuota"
            />
          </div>
          <DiscountNumberInput
            id="discount-budget"
            label="Budget diskon"
            optional
            kind="money"
            value={form.budget}
            disabled={disabled}
            error={error("capacity.budgetAmount")}
            hint="Nol bukan tanpa batas."
            onValueChange={(next) => onChange({ budget: next })}
          />
        </div>
        <p className="text-xs text-muted-foreground">Isi kuota atau budget.</p>
        {error("capacity") ? (
          <p className="text-xs text-destructive">{error("capacity")}</p>
        ) : null}
        <p className="text-xs text-muted-foreground">
          Kuota 1 dihitung per pemakaian kode, bukan per unit barang.
        </p>
      </fieldset>

      <fieldset className="min-w-0 space-y-4 border-t pt-6">
        <legend className="text-sm font-semibold">Batas akun</legend>
        <div className="max-w-xs space-y-2">
          <Label htmlFor="discount-per-client">Batas pemakaian per customer*</Label>
          <Input
            id="discount-per-client"
            inputMode="numeric"
            autoComplete="off"
            value={form.perClient}
            disabled={disabled}
            aria-invalid={error("capacity.perClientLimit") ? true : undefined}
            onChange={(event) => onChange({ perClient: event.target.value })}
          />
          <p className="text-xs text-muted-foreground">
            Untuk customer dengan email akun store terverifikasi.
          </p>
        </div>
      </fieldset>
    </div>
  );
}

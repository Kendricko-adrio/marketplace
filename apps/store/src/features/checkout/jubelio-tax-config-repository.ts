import { inArray } from "drizzle-orm";

import { db, systemConfig } from "@/db";
import { parseProviderTaxRatePercent } from "@marketplace/db/src/provider-tax";
import { createModuleLogger } from "@/lib/logger";

/**
 * Reader konfigurasi pajak checkout — DUA key, dibaca UNCACHED per request.
 *
 * Spec `.scratch/jubelio-sales-api-switching/plan/jubelio-sales-order-tax-spec.md`
 * §5.1: identitas pajak tenant hidup di `system_config` (tanpa menu admin), dan
 * pembacaannya TIDAK boleh memakai getter generic yang menelan kegagalan DB lalu
 * memakai default. Key yang hilang, tipe yang salah, nilai kosong/ambigu, dan
 * kegagalan database semuanya fail closed — checkout baru diblokir sebelum
 * pembayaran, bukan dicatat dengan No Tax/rate 0.
 *
 * Nilai `tax.ppnRatePercent` di sini adalah rate WEBSITE (kebijakan harga), bukan
 * rate master Jubelio; kesetaraan keduanya dibuktikan oleh
 * `prepare-checkout-tax-service.ts`.
 */

const log = createModuleLogger("checkout-tax-config");

export const CHECKOUT_TAX_CONFIG_KEYS = {
  salesTaxId: "jubelio.salesTaxId",
  ppnRatePercent: "tax.ppnRatePercent",
} as const;

export type CheckoutTaxDatabase = Pick<typeof db, "select">;

export type CheckoutTaxConfig = {
  /** Signed safe integer nonnol; `-2` adalah PPN 11% pada tenant riset. */
  taxId: number;
  /** Rate website kanonik `0..100`, maksimal 6 digit pecahan. */
  ppnRatePercent: string;
};

export type CheckoutTaxConfigReason =
  | "missing_config"
  | "config_malformed"
  | "config_unavailable";

export class CheckoutTaxConfigError extends Error {
  readonly reason: CheckoutTaxConfigReason;

  constructor(reason: CheckoutTaxConfigReason, message: string) {
    super(message);
    this.name = "CheckoutTaxConfigError";
    this.reason = reason;
  }
}

type ConfigRow = { key: string; value: string; type: string };

const TAX_ID_PATTERN = /^(?:0|-?[1-9]\d*)$/;

function malformed(message: string): CheckoutTaxConfigError {
  return new CheckoutTaxConfigError("config_malformed", message);
}

/**
 * Pure resolver untuk test dan reader. Nilai text DB diparse ketat:
 * - `type` wajib `number` untuk kedua key (hint tipe yang salah = salah config),
 * - tax id wajib integer kanonik (tanpa `+`/nol di depan/pecahan/eksponen) dan
 *   signed safe integer nonnol,
 * - rate wajib desimal kanonik 0..100 maksimal 6 digit pecahan.
 */
export function resolveCheckoutTaxConfig(rows: readonly ConfigRow[]): CheckoutTaxConfig {
  const byKey = new Map<string, ConfigRow>();
  for (const row of rows) {
    if (byKey.has(row.key)) {
      throw malformed(`System config memuat key ganda: ${row.key}`);
    }
    byKey.set(row.key, row);
  }
  const salesTaxId = byKey.get(CHECKOUT_TAX_CONFIG_KEYS.salesTaxId);
  const ppnRatePercent = byKey.get(CHECKOUT_TAX_CONFIG_KEYS.ppnRatePercent);
  if (!salesTaxId || !ppnRatePercent) {
    throw new CheckoutTaxConfigError(
      "missing_config",
      "Konfigurasi pajak checkout belum lengkap"
    );
  }
  if (salesTaxId.type !== "number" || ppnRatePercent.type !== "number") {
    throw malformed("Konfigurasi pajak checkout memakai tipe yang tidak didukung");
  }
  const taxIdText = salesTaxId.value.trim();
  if (!TAX_ID_PATTERN.test(taxIdText)) {
    throw malformed("jubelio.salesTaxId bukan integer kanonik");
  }
  const taxId = Number(taxIdText);
  if (!Number.isSafeInteger(taxId) || taxId === 0) {
    throw malformed("jubelio.salesTaxId harus signed safe integer nonnol");
  }
  let ratePercent: string;
  try {
    ratePercent = parseProviderTaxRatePercent(
      ppnRatePercent.value.trim(),
      "tax.ppnRatePercent"
    ).ratePercent;
  } catch {
    throw malformed("tax.ppnRatePercent bukan desimal 0..100 yang didukung");
  }
  return { taxId, ppnRatePercent: ratePercent };
}

/**
 * Membaca dua key pajak langsung dari DB (tanpa cache boot). Kegagalan query
 * dilempar sebagai `config_unavailable`, tidak pernah menjadi nilai default.
 */
export async function readCheckoutTaxConfig(
  database: CheckoutTaxDatabase = db
): Promise<CheckoutTaxConfig> {
  let rows: ConfigRow[];
  try {
    rows = await database
      .select({
        key: systemConfig.key,
        value: systemConfig.value,
        type: systemConfig.type,
      })
      .from(systemConfig)
      .where(
        inArray(systemConfig.key, [
          CHECKOUT_TAX_CONFIG_KEYS.salesTaxId,
          CHECKOUT_TAX_CONFIG_KEYS.ppnRatePercent,
        ])
      );
  } catch {
    log.error(
      "Konfigurasi pajak checkout gagal dibaca",
      new Error("Checkout tax config storage unavailable")
    );
    throw new CheckoutTaxConfigError(
      "config_unavailable",
      "Konfigurasi pajak checkout tidak dapat dibaca"
    );
  }
  const resolved = resolveCheckoutTaxConfig(rows);
  log.info(
    `Konfigurasi pajak checkout terbaca (tax id ${resolved.taxId}, rate ${resolved.ppnRatePercent}%)`
  );
  return resolved;
}

import {
  parseProviderTaxRatePercent,
  type ValidatedProviderTax,
} from "@marketplace/db/src/provider-tax";
import {
  createJubelioSalesGateway,
  type JubelioSalesGateway,
} from "@/lib/jubelio-sales-client";
import { createModuleLogger } from "@/lib/logger";
import {
  CheckoutTaxConfigError,
  readCheckoutTaxConfig,
  type CheckoutTaxDatabase,
} from "./jubelio-tax-config-repository";

/**
 * Preflight pajak checkout — satu service, satu operasi bisnis: menghasilkan
 * `ValidatedProviderTax` immutable SEBELUM harga/attempt order baru dibentuk.
 *
 * Spec PPN §5.1/§5.5:
 * - config DB dan master provider (`GET /taxes/`) dibaca ulang setiap request,
 *   tanpa cache sukses yang bisa stale;
 * - tax id wajib ada tepat satu di master, rate website wajib SAMA PERSIS
 *   (perbandingan exact terskala, bukan float) dengan rate master;
 * - rate positif wajib memetakan akun pajak keluaran (`tax_out`);
 * - kegagalan apa pun = `CheckoutTaxUnavailableError` dengan reason aman untuk
 *   diagnosis. Route memetakannya ke 503 + copy customer; tidak ada fallback ke
 *   No Tax/rate default, tidak ada auto-reprice.
 *
 * Service ini tidak menerima `Request`/logger/requestId: korelasi request dibaca
 * dari scope logger aktif, dan tax identity/rate hanya keluar lewat return value.
 */

const log = createModuleLogger("checkout-tax");

export type CheckoutTaxUnavailableReason =
  | "config_unavailable"
  | "missing_config"
  | "config_malformed"
  | "tax_lookup_failed"
  | "tax_not_found"
  | "tax_rate_mismatch"
  | "tax_output_unavailable";

/** Copy internal yang aman: tanpa ID pajak, rate, akun, atau detail master. */
const UNAVAILABLE_MESSAGE =
  "Checkout belum dapat diproses karena konfigurasi pajak belum sesuai.";

export class CheckoutTaxUnavailableError extends Error {
  readonly code = "CHECKOUT_TAX_UNAVAILABLE";
  readonly reason: CheckoutTaxUnavailableReason;

  constructor(reason: CheckoutTaxUnavailableReason) {
    super(UNAVAILABLE_MESSAGE);
    this.name = "CheckoutTaxUnavailableError";
    this.reason = reason;
  }
}

export type PrepareCheckoutTaxInput = {
  database?: CheckoutTaxDatabase;
  salesGateway?: Pick<JubelioSalesGateway, "getTaxRecord">;
};

function unavailable(reason: CheckoutTaxUnavailableReason): never {
  // Satu baris error tersanitasi per kegagalan; reason adalah satu-satunya
  // detail teknis yang boleh terlihat, bukan payload/credential/response master.
  log.error(
    `Preflight pajak checkout gagal (reason ${reason})`,
    new Error("Checkout tax preflight unavailable")
  );
  throw new CheckoutTaxUnavailableError(reason);
}

export async function prepareCheckoutTax(
  input: PrepareCheckoutTaxInput = {}
): Promise<ValidatedProviderTax> {
  let config;
  try {
    config = await readCheckoutTaxConfig(input.database);
  } catch (error) {
    unavailable(
      error instanceof CheckoutTaxConfigError ? error.reason : "config_unavailable"
    );
  }

  let gateway: Pick<JubelioSalesGateway, "getTaxRecord">;
  try {
    gateway = input.salesGateway ?? createJubelioSalesGateway();
  } catch {
    // Runtime gateway tidak tersedia (mis. credentials/base URL belum siap):
    // dependency failure, bukan alasan memakai No Tax.
    unavailable("tax_lookup_failed");
  }

  let record: Awaited<ReturnType<typeof gateway.getTaxRecord>>;
  try {
    record = await gateway.getTaxRecord(config.taxId);
  } catch {
    unavailable("tax_lookup_failed");
  }
  if (record === null || record.taxId !== config.taxId) {
    unavailable("tax_not_found");
  }

  let websiteRate;
  let masterRate;
  try {
    websiteRate = parseProviderTaxRatePercent(
      config.ppnRatePercent,
      "tax.ppnRatePercent"
    );
    masterRate = parseProviderTaxRatePercent(record.ratePercent, "tax.rate");
  } catch {
    unavailable("config_malformed");
  }
  // Exact equality: "11", "11.00" setara; "11" vs "12" ditolak tanpa fallback.
  if (websiteRate.rateScaled !== masterRate.rateScaled) {
    unavailable("tax_rate_mismatch");
  }
  if (websiteRate.rateScaled > BigInt(0) && record.outputAccount === null) {
    unavailable("tax_output_unavailable");
  }

  log.info(
    `Preflight pajak checkout siap (tax id ${config.taxId}, rate ${websiteRate.ratePercent}%)`
  );
  return { taxId: config.taxId, ratePercent: websiteRate.ratePercent };
}

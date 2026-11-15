/** Seam L — configured discount/price import limits (spec §6.2, acceptance X06).
 *
 * Pure: tanpa DB, tanpa Next, tanpa side effect. Nilai limit dibaca dari
 * `system_config` oleh reader app (`apps/admin/src/lib/discount-import-limits.ts`)
 * dan di-resolve di sini supaya parsing/validasi yang sama dipakai stage,
 * apply, dan (nanti) parser workbook. Batas ini adalah batas konfigurasi
 * operasional, bukan SLA/benchmark.
 *
 * Aturan approved:
 * - key hilang / `null` / string kosong tepat (`""`) → default terdokumentasi;
 * - selain itu nilai wajib `/^\d{1,10}$/` dan `1..2147483647` (integer positif);
 * - satu key invalid menggagalkan seluruh resolve (fail closed) — jangan
 *   diam-diam memakai default untuk key itu, karena itu akan membuka batas
 *   tanpa limit yang disepakati.
 */

export interface DiscountImportLimits {
  maxRows: number;
  maxFileBytes: number;
  maxExpandedBytes: number;
}

export const DISCOUNT_IMPORT_LIMIT_KEYS = {
  maxRows: "discount.import.maxRows",
  maxFileBytes: "discount.import.maxFileBytes",
  maxExpandedBytes: "discount.import.maxExpandedBytes",
} as const;

export const DISCOUNT_IMPORT_LIMIT_DEFAULTS = {
  maxRows: 1000,
  maxFileBytes: 5242880,
  maxExpandedBytes: 26214400,
} as const satisfies DiscountImportLimits;

const MAX_LIMIT_VALUE = 2147483647;
const LIMIT_VALUE_PATTERN = /^\d{1,10}$/;

export class DiscountImportLimitError extends Error {
  constructor(
    readonly key: keyof DiscountImportLimits,
    message: string
  ) {
    super(message);
    this.name = "DiscountImportLimitError";
  }
}

/**
 * `null`/`undefined`/`""` → default key tersebut; nilai lain wajib integer
 * positif 1..2147483647 tanpa spasi/tanda/pecahan.
 */
export function parseDiscountImportLimit(
  key: keyof DiscountImportLimits,
  raw: string | null | undefined
): number {
  if (raw === null || raw === undefined || raw === "") {
    return DISCOUNT_IMPORT_LIMIT_DEFAULTS[key];
  }
  if (!LIMIT_VALUE_PATTERN.test(raw)) {
    throw new DiscountImportLimitError(
      key,
      `${key} must be a positive whole number of at most 10 digits`
    );
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_LIMIT_VALUE) {
    throw new DiscountImportLimitError(
      key,
      `${key} must be between 1 and ${MAX_LIMIT_VALUE}`
    );
  }
  return value;
}

/** Resolve ketiga limit sekaligus; key yang hilang memakai default. */
export function resolveDiscountImportLimits(
  rows: Partial<Record<keyof DiscountImportLimits, string | null | undefined>>
): DiscountImportLimits {
  return {
    maxRows: parseDiscountImportLimit("maxRows", rows.maxRows),
    maxFileBytes: parseDiscountImportLimit("maxFileBytes", rows.maxFileBytes),
    maxExpandedBytes: parseDiscountImportLimit(
      "maxExpandedBytes",
      rows.maxExpandedBytes
    ),
  };
}

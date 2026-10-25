/** Seam L — proyeksi Markdown satu SKU (spec §4.1, §4.2, §4.4, §6.1).
 *
 * Pure: tanpa DB/HTTP/config. Satu target tersimpan per SKU diproyeksikan ke
 * harga efektif terhadap source (base) TERBARU:
 *
 * - `0 < target < source`  → effective = target, coretan aktif;
 * - target null / `target >= source` → effective = source, tanpa coretan,
 *   sementara target tetap tersimpan dan aktif lagi bila source naik.
 *
 * Original/coretan selalu berasal dari variant yang sama, bukan `product.base_price`
 * atau harga variant lain. Modul ini tidak menulis apa pun; penulis target
 * (price change apply) tetap wajib memvalidasi terhadap source terbaru di
 * transaksi apply.
 */
import { MAX_MONEY_RUPIAH } from "./versioned-pricing";

export type MarkdownPriceErrorCode =
  | "MARKDOWN_PRICE_INPUT_INVALID"
  | "MARKDOWN_TARGET_INVALID";

export class MarkdownPriceError extends Error {
  readonly code: MarkdownPriceErrorCode;

  constructor(code: MarkdownPriceErrorCode, message: string) {
    super(message);
    this.name = "MarkdownPriceError";
    this.code = code;
  }
}

function inputInvalid(message: string): never {
  throw new MarkdownPriceError("MARKDOWN_PRICE_INPUT_INVALID", message);
}

function targetInvalid(message: string): never {
  throw new MarkdownPriceError("MARKDOWN_TARGET_INVALID", message);
}

const RATE_SCALE_DIGITS = 6;
const RATE_SCALE = BigInt(10) ** BigInt(RATE_SCALE_DIGITS);
const HUNDRED = BigInt(100);

/** Whole Rupiah, 0..9999999999999; `.00` style scale2 is tolerated as exact. */
function parseWholeRupiah(value: string | number, field: string): bigint {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) {
      inputInvalid(`${field} must be an exact non-negative whole Rupiah amount`);
    }
    return BigInt(value);
  }
  if (typeof value !== "string") inputInvalid(`${field} must be a decimal string`);
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) inputInvalid(`${field} must be an unsigned decimal Rupiah amount`);
  if (!/^0*$/.test(match[2] ?? "")) {
    inputInvalid(`${field} must not carry a Rupiah fraction`);
  }
  const amount = BigInt(match[1]);
  if (amount > MAX_MONEY_RUPIAH) {
    inputInvalid(`${field} is outside the supported Rupiah range`);
  }
  return amount;
}

/** Rate discount 0 < p <= 100 dengan paling banyak 6 digit pecahan. */
function parsePercentScaled(value: string | number, field: string): bigint {
  const text = typeof value === "number" ? String(value) : value;
  if (typeof text !== "string") inputInvalid(`${field} must be a decimal string`);
  const match = /^(\d+)(?:\.(\d{1,6}))?$/.exec(text.trim());
  if (!match) {
    inputInvalid(`${field} must be a decimal percentage with at most 6 fractional digits`);
  }
  const scaled =
    BigInt(match[1]) * RATE_SCALE + BigInt((match[2] ?? "").padEnd(RATE_SCALE_DIGITS, "0"));
  if (scaled <= BigInt(0) || scaled > HUNDRED * RATE_SCALE) {
    inputInvalid(`${field} must be greater than 0 and at most 100`);
  }
  return scaled;
}

export interface MarkdownProjectionInput {
  /** Source unit price (Jubelio SKU base), whole Rupiah. */
  sourceUnitPrice: string | number;
  /** Current stored target; null means no Markdown / restored. */
  storedTargetUnitPrice?: string | number | null;
  /** Revision that set the current target; required only when Markdown is active. */
  markdownRevisionId?: string | null;
}

export interface MarkdownPriceProjection {
  sourceUnitPrice: string;
  effectiveUnitPrice: string;
  /** Target stays stored on fallback and becomes active again when source rises. */
  storedTarget: string | null;
  markdownActive: boolean;
  /** Null when there is no active coretan (fallback included). */
  markdownRevisionId: string | null;
}

/**
 * Proyeksi read satu SKU. `markdownRevisionId` wajib ada saat coretan aktif:
 * harga coret tanpa revision history tidak boleh tampil.
 */
export function projectMarkdownPrice(
  input: MarkdownProjectionInput
): MarkdownPriceProjection {
  const source = parseWholeRupiah(input.sourceUnitPrice, "sourceUnitPrice");
  const rawTarget = input.storedTargetUnitPrice;
  const storedTarget =
    rawTarget === null || rawTarget === undefined
      ? null
      : parseWholeRupiah(rawTarget, "storedTargetUnitPrice");
  if (storedTarget !== null && storedTarget === BigInt(0)) {
    inputInvalid("storedTargetUnitPrice must be greater than zero when present");
  }

  const markdownActive = storedTarget !== null && storedTarget < source;
  const revisionId = input.markdownRevisionId ?? null;
  if (markdownActive) {
    if (typeof revisionId !== "string" || revisionId.length === 0) {
      inputInvalid("markdownRevisionId is required while Markdown is active");
    }
  }

  return {
    sourceUnitPrice: source.toString(),
    effectiveUnitPrice: (markdownActive ? storedTarget : source).toString(),
    storedTarget: storedTarget === null ? null : storedTarget.toString(),
    markdownActive,
    markdownRevisionId: markdownActive ? revisionId : null,
  };
}

/**
 * Target fixed dari shortcut persen: `target = round_half_up(source × (100-p)/100)`.
 * Contoh approved spec §4.4: source100001, shortcut85% → 85001 (bukan floor
 * 85000). Persen adalah potongan dari base, bukan tambahan dari harga Markdown.
 */
export function computePercentTarget(
  sourceUnitPrice: string | number,
  discountPercent: string | number
): string {
  const source = parseWholeRupiah(sourceUnitPrice, "sourceUnitPrice");
  const percentScaled = parsePercentScaled(discountPercent, "discountPercent");
  const numerator = source * (HUNDRED * RATE_SCALE - percentScaled);
  const denominator = HUNDRED * RATE_SCALE;
  // Half-up on non-negative values: floor((2n + d) / 2d).
  const target = (BigInt(2) * numerator + denominator) / (BigInt(2) * denominator);
  if (target <= BigInt(0)) {
    targetInvalid("the percentage target must stay greater than zero");
  }
  if (target > MAX_MONEY_RUPIAH) {
    targetInvalid("the percentage target is outside the supported Rupiah range");
  }
  return target.toString();
}

/**
 * Validasi set target terhadap source TERBARU saat apply (spec §4.1): target
 * harus positif dan lebih rendah dari base terbaru. Tidak ada floor/persentase
 * minimum tambahan. Return bentuk kanonik untuk disimpan.
 */
export function validateSetTarget(
  targetUnitPrice: string | number,
  latestSourceUnitPrice: string | number
): string {
  const target = parseWholeRupiah(targetUnitPrice, "targetUnitPrice");
  const source = parseWholeRupiah(latestSourceUnitPrice, "latestSourceUnitPrice");
  if (target <= BigInt(0)) {
    targetInvalid("targetUnitPrice must be greater than zero");
  }
  if (target >= source) {
    targetInvalid("targetUnitPrice must be lower than the latest source price");
  }
  return target.toString();
}

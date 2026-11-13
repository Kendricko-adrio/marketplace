/** Seam PPN provider — tax context immutable dan alokasi pajak whole-line.
 *
 * Pure: tanpa DB/HTTP/config, tanpa efek samping. Dipakai oleh builder/decoder
 * snapshot (`versioned-pricing.ts`), evaluator benefit (`discount-pricing.ts`),
 * paired reader, dan verifikasi provider, sehingga store dan admin memakai satu
 * aturan pembulatan.
 *
 * Aturan yang disetujui (spec
 * `.scratch/jubelio-sales-api-switching/plan/jubelio-sales-order-tax-spec.md`
 * §5.1–§5.3):
 * - Tax ID provider adalah signed safe integer nonnol. ID negatif adalah data
 *   master tenant yang sah (PPN 11% tenant riset = `-2`), ID `0` tetap ditolak.
 * - Rate adalah desimal kanonik `0..100` dengan maksimal 6 digit pecahan,
 *   dibandingkan/dihitung sebagai integer terskala — bukan binary float.
 * - PPN order dihitung SEKALI dengan ceil pada net barang
 *   (`ppnAmount = ceil(netGoods × rate / 100)`), lalu dialokasikan ke setiap
 *   whole line. Total alokasi WAJIB sama dengan `ppnAmount`; pembulatan tidak
 *   boleh berubah menjadi ceil per baris.
 * - Baris net `0` selalu menerima pajak `0` dan tidak ikut pembagian selisih.
 *   Sisa pembulatan dibagikan menurut remainder terbesar, tie-break `variantId`
 *   ascending secara ordinal (perbandingan code unit, bukan locale/urutan
 *   array).
 */

/** Tax context tervalidasi: identitas master + rate website yang sama persis. */
export interface ValidatedProviderTax {
  /** Signed safe integer nonnol; `-2` adalah PPN 11% pada tenant riset. */
  taxId: number;
  /** Rate kanonik `0..100`, maksimal 6 digit pecahan signifikan. */
  ratePercent: string;
}

export const MAX_PROVIDER_TAX_RUPIAH = BigInt("9999999999999");
const RATE_SCALE_DIGITS = 6;
const RATE_SCALE = BigInt(10) ** BigInt(RATE_SCALE_DIGITS);
const HUNDRED = BigInt(100);
const ZERO = BigInt(0);
const ONE = BigInt(1);
const MAX_ID_LENGTH = 128;

export type ProviderTaxErrorCode =
  | "PROVIDER_TAX_INPUT_INVALID"
  | "PROVIDER_TAX_ALLOCATION_MISMATCH";

export class ProviderTaxError extends Error {
  readonly code: ProviderTaxErrorCode;

  constructor(code: ProviderTaxErrorCode, message: string) {
    super(message);
    this.name = "ProviderTaxError";
    this.code = code;
  }
}

function inputInvalid(message: string): ProviderTaxError {
  return new ProviderTaxError("PROVIDER_TAX_INPUT_INVALID", message);
}

function allocationMismatch(message: string): ProviderTaxError {
  return new ProviderTaxError("PROVIDER_TAX_ALLOCATION_MISMATCH", message);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Rate kanonik `0..100` dengan maksimal 6 digit pecahan. `number` diterima
 * hanya bila representasinya exact (tidak ada exponent dan tidak melebihi
 * digit pecahan), lalu selalu dikembalikan sebagai string kanonik.
 */
export function parseProviderTaxRatePercent(
  value: string | number,
  field = "ratePercent"
): { ratePercent: string; rateScaled: bigint } {
  const text = typeof value === "number" ? String(value) : value;
  if (typeof text !== "string") {
    throw inputInvalid(`${field} must be a decimal percentage`);
  }
  const match = /^(\d+)(?:\.(\d{1,6}))?$/.exec(text);
  if (!match) {
    throw inputInvalid(
      `${field} must be a decimal percentage with at most 6 fractional digits`
    );
  }
  const fraction = (match[2] ?? "").padEnd(RATE_SCALE_DIGITS, "0");
  const rateScaled = BigInt(match[1]) * RATE_SCALE + BigInt(fraction);
  if (rateScaled > HUNDRED * RATE_SCALE) {
    throw inputInvalid(`${field} must be between 0 and 100`);
  }
  return { ratePercent: formatRate(rateScaled), rateScaled };
}

function formatRate(scaled: bigint): string {
  const whole = scaled / RATE_SCALE;
  const fraction = (scaled % RATE_SCALE)
    .toString()
    .padStart(RATE_SCALE_DIGITS, "0")
    .replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

/**
 * Trust boundary untuk tax context yang tersimpan (`jsonb`) atau dibaca dari
 * config. Fail closed: field asing, versi/tipe salah, ID `0`, ID di luar safe
 * integer, dan rate tidak kanonik semuanya ditolak — tidak ada default rate 0.
 */
export function parseValidatedProviderTax(value: unknown): ValidatedProviderTax {
  if (!isPlainObject(value)) {
    throw inputInvalid("provider tax context must be a JSON object");
  }
  for (const key of Object.keys(value)) {
    if (key !== "taxId" && key !== "ratePercent") {
      throw inputInvalid(`provider tax context carries an unknown field: ${key}`);
    }
  }
  const taxId = value.taxId;
  if (
    typeof taxId !== "number" ||
    !Number.isSafeInteger(taxId) ||
    taxId === 0
  ) {
    throw inputInvalid(
      "provider taxId must be a nonzero safe integer (a negative ID is a valid master record)"
    );
  }
  const { ratePercent } = parseProviderTaxRatePercent(
    value.ratePercent as string | number,
    "providerTax.ratePercent"
  );
  return { taxId, ratePercent };
}

function parseMoney(value: unknown, field: string): bigint {
  if (typeof value !== "string") {
    throw inputInvalid(`${field} must be a decimal string`);
  }
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) {
    throw inputInvalid(`${field} must be an unsigned decimal Rupiah amount`);
  }
  if (!/^0*$/.test(match[2] ?? "")) {
    throw inputInvalid(`${field} must not carry a Rupiah fraction`);
  }
  const amount = BigInt(match[1]);
  if (amount > MAX_PROVIDER_TAX_RUPIAH) {
    throw inputInvalid(`${field} is outside the supported Rupiah range`);
  }
  return amount;
}

function parseVariantId(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_ID_LENGTH) {
    throw inputInvalid(
      `${field} must be a non-empty string of at most ${MAX_ID_LENGTH} characters`
    );
  }
  return value;
}

export interface AllocateProviderTaxInput {
  lines: readonly { variantId: string; netLineAmount: string }[];
  ppnRatePercent: string | number;
  /** PPN order final: `ceil(netGoods × rate / 100)` dari snapshot. */
  ppnAmount: string;
}

export interface ProviderTaxAllocation {
  variantId: string;
  providerTaxAmount: string;
}

function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  if (numerator === ZERO) return ZERO;
  return (numerator + denominator - ONE) / denominator;
}

/**
 * Alokasi PPN order ke whole line: exact per baris, floor, lalu sisa menuju
 * `ppnAmount` dibagikan menurut remainder terbesar dengan tie-break
 * `variantId` ascending ordinal. Total hasil selalu tepat `ppnAmount`.
 */
export function allocateProviderTax(
  input: AllocateProviderTaxInput
): readonly ProviderTaxAllocation[] {
  if (!Array.isArray(input.lines) || input.lines.length === 0) {
    throw inputInvalid("provider tax allocation requires at least one line");
  }
  const { rateScaled } = parseProviderTaxRatePercent(
    input.ppnRatePercent,
    "ppnRatePercent"
  );
  const ppnAmount = parseMoney(input.ppnAmount, "ppnAmount");

  const seen = new Set<string>();
  const bases: bigint[] = [];
  const variantIds: string[] = [];
  let netGoods = ZERO;
  input.lines.forEach((line, index) => {
    const variantId = parseVariantId(line.variantId, `lines[${index}].variantId`);
    if (seen.has(variantId)) {
      throw inputInvalid(`lines[${index}].variantId duplicates another line`);
    }
    seen.add(variantId);
    const netLineAmount = parseMoney(
      line.netLineAmount,
      `lines[${index}].netLineAmount`
    );
    variantIds.push(variantId);
    bases.push(netLineAmount);
    netGoods += netLineAmount;
    if (netGoods > MAX_PROVIDER_TAX_RUPIAH) {
      throw inputInvalid("lines.netLineAmount total is outside the supported Rupiah range");
    }
  });

  const denominator = HUNDRED * RATE_SCALE;
  const expectedPpnAmount = ceilDiv(netGoods * rateScaled, denominator);
  if (expectedPpnAmount !== ppnAmount) {
    throw allocationMismatch(
      `ppnAmount ${ppnAmount} does not equal ceil(netGoods ${netGoods} × rate ${formatRate(rateScaled)} / 100) = ${expectedPpnAmount}`
    );
  }

  const allocations = bases.map(() => ZERO);
  if (ppnAmount === ZERO) {
    return variantIds.map((variantId) => ({ variantId, providerTaxAmount: "0" }));
  }

  const remainders: { index: number; remainder: bigint; variantId: string }[] = [];
  let assigned = ZERO;
  bases.forEach((basis, index) => {
    if (basis === ZERO) return;
    const weighted = basis * rateScaled;
    const share = weighted / denominator;
    allocations[index] = share;
    assigned += share;
    remainders.push({
      index,
      remainder: weighted % denominator,
      variantId: variantIds[index],
    });
  });
  remainders.sort((left, right) => {
    if (left.remainder !== right.remainder) {
      return left.remainder > right.remainder ? -1 : 1;
    }
    if (left.variantId === right.variantId) return 0;
    return left.variantId < right.variantId ? -1 : 1;
  });
  let residual = ppnAmount - assigned;
  if (residual < ZERO) {
    throw allocationMismatch("provider tax allocation exceeds the order PPN amount");
  }
  for (let cursor = 0; residual > ZERO; cursor += 1) {
    if (remainders.length === 0) {
      throw allocationMismatch("provider tax residual cannot be allocated to zero-net lines");
    }
    allocations[remainders[cursor % remainders.length].index] += ONE;
    residual -= ONE;
  }

  return variantIds.map((variantId, index) => ({
    variantId,
    providerTaxAmount: allocations[index].toString(),
  }));
}

/** Nominal provider satu baris: net line + pajak teralokasi (Rupiah utuh). */
export function providerLineAmount(
  netLineAmount: string,
  providerTaxAmount: string
): bigint {
  return (
    parseMoney(netLineAmount, "netLineAmount") +
    parseMoney(providerTaxAmount, "providerTaxAmount")
  );
}

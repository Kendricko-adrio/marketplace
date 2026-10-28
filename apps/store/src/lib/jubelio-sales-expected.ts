import type { PricingSnapshotPayloadV1 } from "@marketplace/db/src/schema";
import {
  parseValidatedProviderTax,
  type ValidatedProviderTax,
} from "@marketplace/db/src/provider-tax";
import {
  readOrderPricing,
  type PersistedOrderPricingRow,
} from "./versioned-pricing";

/**
 * jubelio-sales-expected — decoder runtime dua record immutable yang menjadi
 * otoritas uang provider Sales (spec §8.3 "Sales operation", §10.2).
 *
 * Dua record tersimpan harus SALING SETUJU dan tidak pernah dihitung ulang
 * dari master/config saat ini:
 *
 * 1. **order row** — versi relational `pricing1/engine1/provider2` + financial
 *    snapshot immutable (`orders.pricing_snapshot`, dibaca oleh decoder Lane A
 *    `readOrderPricing`, bukan dari master price/tax/quote).
 * 2. **create intent** — payload operasi `create` yang dibekukan di operation
 *    ledger (`JubelioSalesOrderCreateRequest`), sumber `expectedProviderPayable`
 *    yang dipakai `POST /sales/orders/`, invoice dan payment.
 *
 * Aturan versi (fail closed, tanpa downgrade diam-diam):
 * - `providerContractVersion` ABSEN pada intent = legacy unversioned, dan baris
 *   order wajib tetap `0/0/0`. Branch legacy mempertahankan aturan lamanya di
 *   `jubelio-sales-lifecycle.ts` (tidak dihitung ulang di sini).
 * - `providerContractVersion: 2` = kontrak provider baru: envelope shipping +
 *   payable wajib lolos bound Rupiah utuh/identity/tax/unit, dan baris order
 *   wajib persis `1/1/2` dengan snapshot yang nilainya sama.
 * - `providerContractVersion: 3` = kontrak PPN provider: envelope yang sama
 *   ditambah `providerTax` tervalidasi dan pajak per baris; payable provider =
 *   net barang + PPN + net ongkir, dan baris order wajib `1/1/3`.
 * - Nilai eksplisit lain (termasuk `null`) = versi unknown → fail closed;
 *   tidak pernah dianggap legacy atau ditebak sebagai versi 2.
 *
 * Pure: tanpa DB/HTTP/config. Modul ini tidak menulis apa pun dan tidak
 * membaca master/config; ia hanya memutuskan apakah dua record tersimpan boleh
 * dipakai sebagai expected provider.
 */

/** Versi kontrak provider Sales tanpa pajak provider (spec §8.3/§10.1). */
export const SALES_PROVIDER_CONTRACT_VERSION = 2;
/** Versi kontrak provider yang mencatat PPN checkout pada SO (spec PPN §5.2). */
export const SALES_PROVIDER_TAX_CONTRACT_VERSION = 3;
/** Bound uang website (spec §4.3): 0..9999999999999 Rupiah utuh. */
export const SALES_MAX_MONEY = 9_999_999_999_999;
/** Bound cart (spec §4.3): maksimal 50 baris, quantity 1..99 per baris. */
export const SALES_MAX_ITEM_LINES = 50;
export const SALES_MAX_ITEM_QUANTITY = 99;

export type JubelioSalesContractErrorCode =
  | "SALES_CONTRACT_SHAPE_INVALID"
  | "SALES_CONTRACT_UNSUPPORTED_VERSION"
  | "SALES_CONTRACT_PAYABLE_MISMATCH"
  | "SALES_CONTRACT_RECORD_DRIFT";

export class JubelioSalesContractError extends Error {
  readonly code: JubelioSalesContractErrorCode;

  constructor(code: JubelioSalesContractErrorCode, message: string) {
    super(message);
    this.name = "JubelioSalesContractError";
    this.code = code;
  }
}

function shapeInvalid(message: string): never {
  throw new JubelioSalesContractError("SALES_CONTRACT_SHAPE_INVALID", message);
}

function unsupportedVersion(message: string): never {
  throw new JubelioSalesContractError(
    "SALES_CONTRACT_UNSUPPORTED_VERSION",
    message
  );
}

function recordDrift(message: string): never {
  throw new JubelioSalesContractError("SALES_CONTRACT_RECORD_DRIFT", message);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    shapeInvalid(`${field} must be a non-empty string`);
  }
  return value;
}

function requireWholeRupiah(value: unknown, field: string): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > SALES_MAX_MONEY
  ) {
    shapeInvalid(
      `${field} must be whole Rupiah between 0 and ${SALES_MAX_MONEY}`
    );
  }
  return value;
}

function requirePositiveInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    shapeInvalid(`${field} must be a positive integer`);
  }
  return value;
}

/** Tax ID provider adalah signed safe integer nonnol (PPN 11% tenant = -2). */
function requireTaxId(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value === 0) {
    shapeInvalid(`${field} must be a nonzero safe integer tax id`);
  }
  return value;
}

export type JubelioSalesExpectedLine = {
  itemId: number;
  quantity: number;
  price: number;
  discAmount: number;
  taxAmount: number;
  unit: string;
  taxId: number;
};

/** Intent unversioned: branch legacy, aturan provider lama dipertahankan. */
export type LegacySalesOrderExpectation = { providerContractVersion: 0 };

/** Intent kontrak v2: envelope shipping + payable yang dibekukan. */
export type VersionedSalesOrderExpectation = {
  providerContractVersion: 2 | 3;
  contactId: number;
  customerName: string;
  locationId: number;
  note: string;
  originalShipmentCost: number;
  shippingCost: number;
  /** Gross barang dari baris intent (net goods, tanpa ongkir). */
  netGoods: number;
  expectedProviderPayable: number;
  lines: readonly JubelioSalesExpectedLine[];
  /** Kontrak3: identitas/rate pajak yang dibekukan (v2 tidak punya). */
  providerTax?: ValidatedProviderTax;
  /** Kontrak3: jumlah pajak per line (0 pada kontrak2). */
  totalTax?: number;
};

export type JubelioSalesOrderExpectation =
  | LegacySalesOrderExpectation
  | VersionedSalesOrderExpectation;

/**
 * Decoder runtime payload operasi `create` yang tersimpan (jsonb: tipe
 * TypeScript hanya compile-time). Absen version = legacy; versi eksplisit lain
 * selain 2 fail closed; v2 divalidasi identity/tax/unit/money dan identitas
 * `netGoods + shippingCost === expectedProviderPayable`.
 */
export function readJubelioSalesOrderExpectation(
  payload: unknown
): JubelioSalesOrderExpectation {
  if (!isPlainObject(payload)) {
    shapeInvalid("persisted sales operation payload must be a JSON object");
  }
  if (payload.type !== "create") {
    shapeInvalid(
      "persisted sales operation payload is not a create intent"
    );
  }
  const create = payload.create;
  if (!isPlainObject(create)) {
    shapeInvalid("persisted sales create intent must be a JSON object");
  }

  const version = create.providerContractVersion;
  if (version === undefined) {
    // Only an ABSENT version is the legacy branch. Shipping/payable money
    // without an explicit version was never a legitimate legacy intent — the
    // gateway rejects it on dispatch, so a stored row like that is corrupt.
    if (
      create.originalShipmentCost !== undefined ||
      create.shippingCost !== undefined ||
      create.expectedProviderPayable !== undefined
    ) {
      unsupportedVersion(
        "legacy create intent carries contract v2 money without an explicit provider contract version"
      );
    }
    return { providerContractVersion: 0 };
  }
  if (
    version !== SALES_PROVIDER_CONTRACT_VERSION &&
    version !== SALES_PROVIDER_TAX_CONTRACT_VERSION
  ) {
    unsupportedVersion(
      `persisted provider contract version ${String(version)} is unsupported: only the unversioned legacy intent and contract versions ${SALES_PROVIDER_CONTRACT_VERSION}/${SALES_PROVIDER_TAX_CONTRACT_VERSION} are accepted`
    );
  }
  const taxContract = version === SALES_PROVIDER_TAX_CONTRACT_VERSION;
  let providerTax: ValidatedProviderTax | undefined;
  if (taxContract) {
    try {
      providerTax = parseValidatedProviderTax(create.providerTax);
    } catch {
      shapeInvalid(
        "contract v3 create intent requires a validated provider tax context"
      );
    }
  } else if (create.providerTax !== undefined) {
    shapeInvalid(
      "contract v2 create intent must not carry a provider tax context"
    );
  }

  const contactId = create.contactId;
  if (
    typeof contactId !== "number" ||
    !Number.isSafeInteger(contactId) ||
    contactId === 0
  ) {
    shapeInvalid("sales create intent contactId must be a nonzero integer");
  }
  // Lokasi adalah identifier bertanda dari provider (Tangerang memakai -1),
  // bukan besaran positif. Kecocokan lokasi tetap diverifikasi oleh consumer.
  const locationId = create.locationId;
  if (typeof locationId !== "number" || !Number.isSafeInteger(locationId)) {
    shapeInvalid("sales create intent locationId must be a safe integer");
  }
  const customerName = requireNonEmptyString(
    create.customerName,
    "sales create intent customerName"
  );
  const note = requireNonEmptyString(create.note, "sales create intent note");

  const originalShipmentCost = requireWholeRupiah(
    create.originalShipmentCost,
    "sales create intent originalShipmentCost"
  );
  const shippingCost = requireWholeRupiah(
    create.shippingCost,
    "sales create intent shippingCost"
  );
  const expectedProviderPayable = requireWholeRupiah(
    create.expectedProviderPayable,
    "sales create intent expectedProviderPayable"
  );
  if (shippingCost > originalShipmentCost) {
    shapeInvalid(
      "sales create intent net shipping cannot exceed the original shipping"
    );
  }

  const rawItems = create.items;
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    shapeInvalid("sales create intent requires at least one item line");
  }
  if (rawItems.length > SALES_MAX_ITEM_LINES) {
    shapeInvalid(
      `sales create intent must not exceed ${SALES_MAX_ITEM_LINES} item lines`
    );
  }

  const lines: JubelioSalesExpectedLine[] = [];
  const seenItemIds = new Set<number>();
  let netGoods = 0;
  let totalTax = 0;
  rawItems.forEach((rawItem, index) => {
    const field = `sales create intent items[${index}]`;
    if (!isPlainObject(rawItem)) {
      shapeInvalid(`${field} must be a JSON object`);
    }
    const itemId = requirePositiveInteger(rawItem.itemId, `${field}.itemId`);
    if (seenItemIds.has(itemId)) {
      shapeInvalid(`${field}.itemId duplicates another item line`);
    }
    seenItemIds.add(itemId);
    const quantity = rawItem.quantity;
    if (
      typeof quantity !== "number" ||
      !Number.isSafeInteger(quantity) ||
      quantity < 1 ||
      quantity > SALES_MAX_ITEM_QUANTITY
    ) {
      shapeInvalid(
        `${field}.quantity must be a whole quantity between 1 and ${SALES_MAX_ITEM_QUANTITY}`
      );
    }
    const price = requireWholeRupiah(rawItem.price, `${field}.price`);
    const discAmount = requireWholeRupiah(
      rawItem.discAmount,
      `${field}.discAmount`
    );
    const taxAmount = requireWholeRupiah(rawItem.taxAmount, `${field}.taxAmount`);
    const unit = requireNonEmptyString(rawItem.unit, `${field}.unit`);
    const taxId = requireTaxId(rawItem.taxId, `${field}.taxId`);
    // Kontrak2/legacy tetap No Tax. Kontrak3 mencatat PPN per whole line dan
    // setiap baris wajib memakai tax id yang sama dengan snapshot pajak.
    if (!taxContract && taxAmount !== 0) {
      shapeInvalid(
        `${field}.taxAmount must be 0: only contract v3 records provider tax`
      );
    }
    if (taxContract && providerTax && taxId !== providerTax.taxId) {
      shapeInvalid(
        `${field}.taxId must equal the frozen provider tax id on contract v3`
      );
    }
    totalTax += taxAmount;
    if (totalTax > SALES_MAX_MONEY) {
      shapeInvalid("sales create intent total tax is outside the supported range");
    }
    const gross = price * quantity;
    if (!Number.isSafeInteger(gross) || gross > SALES_MAX_MONEY) {
      shapeInvalid(`${field} gross amount is outside the supported range`);
    }
    if (discAmount > gross) {
      shapeInvalid(`${field}.discAmount exceeds the line gross amount`);
    }
    netGoods += gross - discAmount;
    if (netGoods > SALES_MAX_MONEY) {
      shapeInvalid("sales create intent net goods is outside the supported range");
    }
    lines.push({
      itemId,
      quantity,
      price,
      discAmount,
      taxAmount,
      unit,
      taxId,
    });
  });

  if (netGoods + totalTax + shippingCost !== expectedProviderPayable) {
    throw new JubelioSalesContractError(
      "SALES_CONTRACT_PAYABLE_MISMATCH",
      `sales create intent expected provider payable ${expectedProviderPayable} does not equal net goods ${netGoods} + provider tax ${totalTax} + net shipping ${shippingCost}`
    );
  }

  return {
    providerContractVersion: taxContract
      ? SALES_PROVIDER_TAX_CONTRACT_VERSION
      : SALES_PROVIDER_CONTRACT_VERSION,
    contactId,
    customerName,
    locationId,
    note,
    originalShipmentCost,
    shippingCost,
    netGoods,
    expectedProviderPayable,
    lines,
    ...(providerTax ? { providerTax } : {}),
    ...(taxContract ? { totalTax } : {}),
  };
}

/**
 * Otoritas settlement dari DUA record tersimpan: create intent + baris order
 * (versi relational + financial snapshot). Gagal closed bila versi tidak sah
 * atau kedua record tidak saling setuju — tidak ada fallback ke master/config.
 */
export function readSettlementAuthorityRecord(input: {
  createPayload: unknown;
  orderRow: PersistedOrderPricingRow;
}): JubelioSalesOrderExpectation {
  const intent = readJubelioSalesOrderExpectation(input.createPayload);
  const row = input.orderRow;
  const pricingVersion = row.pricingContractVersion ?? 0;
  const engineVersion = row.pricingEngineVersion ?? 0;
  const providerVersion = row.providerContractVersion ?? 0;

  if (intent.providerContractVersion === 0) {
    // The legacy branch keeps the existing subtotal rules, but a legacy intent
    // paired with versioned order pricing is not a legitimate stored pair.
    if (pricingVersion !== 0 || engineVersion !== 0 || providerVersion !== 0) {
      recordDrift(
        "order row carries versioned pricing while the stored create intent is unversioned"
      );
    }
    return intent;
  }

  if (
    pricingVersion !== 1 ||
    engineVersion !== 1 ||
    providerVersion !== intent.providerContractVersion
  ) {
    unsupportedVersion(
      `order row pricing versions (${pricingVersion}/${engineVersion}/${providerVersion}) are unknown or inconsistent with a contract v${intent.providerContractVersion} create intent`
    );
  }

  const snapshot = decodeOrderPricingSnapshot(row);
  assertOrderSnapshotAgreesWithIntent(intent, snapshot);
  return intent;
}

/**
 * Decode immutable financial snapshot baris order lewat decoder Lane A
 * (`readOrderPricing`); apa pun selain kontrak pricing1 yang utuh fail closed.
 * Tidak ada recompute dari master/config di sini.
 */
function decodeOrderPricingSnapshot(
  row: PersistedOrderPricingRow
): PricingSnapshotPayloadV1 {
  let decoded: ReturnType<typeof readOrderPricing>;
  try {
    decoded = readOrderPricing(row);
  } catch (error) {
    throw new JubelioSalesContractError(
      "SALES_CONTRACT_SHAPE_INVALID",
      error instanceof Error
        ? `order pricing snapshot could not be decoded: ${error.message}`
        : "order pricing snapshot could not be decoded"
    );
  }
  if (decoded.pricingContractVersion !== 1) {
    throw new JubelioSalesContractError(
      "SALES_CONTRACT_SHAPE_INVALID",
      "order pricing snapshot is not a supported contract version"
    );
  }
  return decoded;
}

/**
 * Kesetaraan dua record immutable untuk money provider. Tidak menghitung ulang
 * apa pun: keduanya dibandingkan sebagai nilai tersimpan.
 */
export function assertOrderSnapshotAgreesWithIntent(
  intent: VersionedSalesOrderExpectation,
  snapshot: PricingSnapshotPayloadV1
): void {
  const mismatches: string[] = [];
  // Independent totals: the frozen intent (per-line source price and
  // whole-line discount) must agree with the immutable order snapshot. The
  // order snapshot is the authority for the CUSTOMER total; both records must
  // describe the same money, never a recomputed from master prices.
  let intentGross = BigInt(0);
  let intentDiscount = BigInt(0);
  let intentNetGoods = BigInt(0);
  for (const line of intent.lines) {
    const gross = BigInt(line.price) * BigInt(line.quantity);
    intentGross += gross;
    intentDiscount += BigInt(line.discAmount);
    intentNetGoods += gross - BigInt(line.discAmount);
  }
  if (snapshot.sourceGoodsSubtotal !== intentGross.toString()) {
    mismatches.push(
      `source goods ${snapshot.sourceGoodsSubtotal} vs intent ${intentGross.toString()}`
    );
  }
  if (snapshot.netGoods !== intentNetGoods.toString()) {
    mismatches.push(
      `net goods ${snapshot.netGoods} vs intent ${intentNetGoods.toString()}`
    );
  }
  const snapshotDiscount = BigInt(snapshot.markdownTotal) + BigInt(snapshot.goodsDiscount);
  if (intentDiscount.toString() !== snapshotDiscount.toString()) {
    mismatches.push(
      `intent whole-line discount ${intentDiscount.toString()} vs snapshot markdown ${snapshot.markdownTotal} + goods discount ${snapshot.goodsDiscount}`
    );
  }
  if (snapshot.shippingBeforeSubsidy !== String(intent.originalShipmentCost)) {
    mismatches.push(
      `original shipping ${snapshot.shippingBeforeSubsidy} vs intent ${intent.originalShipmentCost}`
    );
  }
  if (snapshot.shippingCost !== String(intent.shippingCost)) {
    mismatches.push(
      `net shipping ${snapshot.shippingCost} vs intent ${intent.shippingCost}`
    );
  }
  if (snapshot.expectedProviderPayable !== String(intent.expectedProviderPayable)) {
    mismatches.push(
      `expected provider payable ${snapshot.expectedProviderPayable} vs intent ${intent.expectedProviderPayable}`
    );
  }
  if (intent.providerContractVersion === SALES_PROVIDER_TAX_CONTRACT_VERSION) {
    // Kontrak3: identitas/rate pajak dan nominal per baris kedua record wajib
    // sama. Header total yang benar tidak membuktikan alokasi per line.
    if (snapshot.providerContractVersion !== SALES_PROVIDER_TAX_CONTRACT_VERSION) {
      mismatches.push(
        `order snapshot provider version ${snapshot.providerContractVersion} vs intent ${SALES_PROVIDER_TAX_CONTRACT_VERSION}`
      );
    } else {
      if (
        !intent.providerTax ||
        snapshot.providerTax.taxId !== intent.providerTax.taxId ||
        snapshot.providerTax.ratePercent !== intent.providerTax.ratePercent
      ) {
        mismatches.push(
          "order snapshot provider tax identity/rate disagrees with the stored create intent"
        );
      }
      const snapshotTax = BigInt(snapshot.ppnAmount);
      const intentTax = BigInt(intent.totalTax ?? 0);
      if (snapshotTax !== intentTax) {
        mismatches.push(
          `order snapshot PPN ${snapshot.ppnAmount} vs intent ${intentTax.toString()}`
        );
      }
      const lineTaxTotal = snapshot.lines.reduce(
        (sum, line) => sum + BigInt(line.providerTaxAmount),
        BigInt(0)
      );
      if (lineTaxTotal !== intentTax) {
        mismatches.push(
          `order snapshot line tax ${lineTaxTotal.toString()} vs intent ${intentTax.toString()}`
        );
      }
    }
  }
  if (mismatches.length > 0) {
    recordDrift(
      `order pricing snapshot disagrees with the stored create intent: ${mismatches.join("; ")}`
    );
  }
}

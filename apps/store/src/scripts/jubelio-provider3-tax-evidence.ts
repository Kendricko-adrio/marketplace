/**
 * Bukti provider3 (PPN pada Sales Order) — BOUNDED, satu SO + cancel.
 *
 * Izin yang dipakai (diberikan pemilik pada sesi ini): **satu** Sales Order
 * create dengan 2 baris (satu diskon whole-line), ongkir 30000, PPN 11%, lalu
 * **satu** cancel untuk membersihkan fixture. TIDAK membuat invoice, payment,
 * edit mirror, booking shipment, atau perubahan master. TIDAK ada retry POST.
 *
 * Urutan:
 *   1. read-only: login, `GET /inventory/` (pilih 2 item berstok pada satu
 *      lokasi), `GET /taxes/` (tax id -2 rate 11 + akun keluaran).
 *   2. aborsi jika stok kurang atau master pajak tidak cocok (tanpa write).
 *   3. satu `POST /sales/orders/` provider3, diverifikasi GET per baris
 *      (tax id/nominal) — bila provider menghitung ulang berbeda, gateway
 *      fail closed dan fixture dibersihkan dengan cancel.
 *   4. satu cancel + bukti stok kembali.
 *   5. journal JSON teredaksi ke research/.
 *
 * Run (dari apps/store): `npx tsx src/scripts/jubelio-provider3-tax-evidence.ts`
 * Prasyarat env: JUBELIO_EMAIL/PASSWORD, JUBELIO_SALES_TEST_ACCOUNT_ENABLED=true,
 * JUBELIO_API_BASE_URL=https://api2.jubelio.com (opt-in test account).
 * Opsional: JUBELIO_TAX_EVIDENCE_TAX_ID (default -2),
 * JUBELIO_TAX_EVIDENCE_RATE (default 11).
 */
import dotenv from "dotenv";
dotenv.config({ path: "../../.env" });

import { writeFileSync } from "node:fs";
import path from "node:path";
import {
  buildPricingSnapshot,
  type PricingSnapshot,
} from "@marketplace/db/src/versioned-pricing";
import {
  createJubelioSalesGateway,
  type JubelioSalesGatewayError,
} from "../lib/jubelio-sales-client";

const TAX_ID = Number(process.env.JUBELIO_TAX_EVIDENCE_TAX_ID || -2);
const EXPECTED_RATE = (process.env.JUBELIO_TAX_EVIDENCE_RATE || "11").trim();
const UNIT = process.env.JUBELIO_ITEM_UNIT?.trim() || "Buah";
const LINE_A_PRICE = 100_001;
const LINE_A_DISCOUNT = 20_000;
const LINE_A_TAX = 8_801;
const LINE_B_PRICE = 120_000;
const LINE_B_TAX = 13_200;
const SHIPPING = 30_000;
const PPN_AMOUNT = 22_001;
// net barang 80001 + 120000 = 200001; PPN 22001; ongkir 30000 → 252002.
const PAYABLE = 252_002;

type Journal = {
  runAt: string;
  scope: string;
  tax: { taxId: number; ratePercent: string; outputAccountPresent: boolean };
  locationId: number | null;
  items: Array<{ role: "A" | "B"; itemId: number }>;
  expected: Record<string, number>;
  confirmed: Record<string, unknown> | null;
  salesOrderId: number | null;
  createAmbiguous: boolean;
  cancel: Record<string, unknown> | null;
  stockRestored: boolean | null;
  checks: Array<{ label: string; ok: boolean; detail?: string }>;
};

const journal: Journal = {
  runAt: new Date().toISOString(),
  scope:
    "one provider3 create (2 lines, one whole-line discount, shipping 30000, PPN 11%) + one cancel; no invoice/payment/edit",
  tax: { taxId: TAX_ID, ratePercent: EXPECTED_RATE, outputAccountPresent: false },
  locationId: null,
  items: [],
  expected: {
    subTotal: LINE_A_PRICE + LINE_B_PRICE,
    totalDisc: LINE_A_DISCOUNT,
    totalTax: PPN_AMOUNT,
    grandTotal: PAYABLE,
    lineATax: LINE_A_TAX,
    lineBTax: LINE_B_TAX,
  },
  confirmed: null,
  salesOrderId: null,
  createAmbiguous: false,
  cancel: null,
  stockRestored: null,
  checks: [],
};

const failures: string[] = [];
function check(label: string, ok: boolean, detail?: string): void {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  journal.checks.push({ label, ok, ...(detail ? { detail } : {}) });
  if (!ok) failures.push(label);
}

type InventoryItem = {
  item_id: string;
  location_stocks: Array<{
    location_id: string;
    available: number | string;
  }>;
};

async function main(): Promise<void> {
  const runtimeEnv = {
    NODE_ENV: process.env.NODE_ENV,
    APP_ENV: process.env.APP_ENV,
    JUBELIO_API_BASE_URL: process.env.JUBELIO_API_BASE_URL,
    JUBELIO_SALES_TEST_ACCOUNT_ENABLED: process.env.JUBELIO_SALES_TEST_ACCOUNT_ENABLED,
    JUBELIO_EMAIL: process.env.JUBELIO_EMAIL,
    JUBELIO_PASSWORD: process.env.JUBELIO_PASSWORD,
    JUBELIO_ITEM_UNIT: process.env.JUBELIO_ITEM_UNIT,
  };
  if (runtimeEnv.JUBELIO_SALES_TEST_ACCOUNT_ENABLED !== "true") {
    throw new Error("refusing: JUBELIO_SALES_TEST_ACCOUNT_ENABLED must be true (test account opt-in)");
  }
  if (runtimeEnv.JUBELIO_API_BASE_URL !== "https://api2.jubelio.com" && runtimeEnv.JUBELIO_API_BASE_URL !== "https://api2.jubelio.com/") {
    throw new Error("refusing: evidence run must target the pinned https://api2.jubelio.com test account");
  }

  const gateway = createJubelioSalesGateway({ env: runtimeEnv });

  // ---- 1. read-only preflight: master pajak ----
  const tax = await gateway.getTaxRecord(TAX_ID);
  check("master pajak ditemukan (tax id tervalidasi)", tax !== null, tax ? `rate=${tax.ratePercent}` : "null");
  if (!tax) return;
  journal.tax.ratePercent = tax.ratePercent;
  journal.tax.outputAccountPresent = tax.outputAccount !== null;
  check("rate master sama dengan rate website", tax.ratePercent === EXPECTED_RATE, `${tax.ratePercent} vs ${EXPECTED_RATE}`);
  check("mapping pajak keluaran tersedia", tax.outputAccount !== null);

  // ---- 2. read-only preflight: dua item berstok pada satu lokasi ----
  const token = await login();
  const inventory = await listInventory(token);
  const candidate = pickLocationWithTwoItems(inventory);
  check("dua item berstok ditemukan pada satu lokasi", candidate !== null, candidate ? `lokasi ${candidate.locationId}` : "tidak ada");
  if (!candidate) return;
  journal.locationId = candidate.locationId;
  journal.items = [
    { role: "A", itemId: candidate.itemA },
    { role: "B", itemId: candidate.itemB },
  ];
  const before = await stocksFor(token, [candidate.itemA, candidate.itemB], candidate.locationId);
  check(
    "stok tersedia ≥1 untuk kedua item sebelum create",
    before.every((row) => row.available >= 1),
    JSON.stringify(before)
  );
  if (!before.every((row) => row.available >= 1)) return;

  // ---- 3. snapshot provider3 + satu create ----
  const snapshot = buildPricingSnapshot({
    fulfillmentMethod: "delivery",
    ppnRatePercent: tax.ratePercent,
    lines: [
      {
        variantId: "evidence-line-a",
        quantity: 1,
        sourceUnitPrice: LINE_A_PRICE,
        effectiveUnitPrice: LINE_A_PRICE - LINE_A_DISCOUNT,
        markdownRevisionId: "sandbox-tax-evidence-markdown-a",
      },
      { variantId: "evidence-line-b", quantity: 1, sourceUnitPrice: LINE_B_PRICE, effectiveUnitPrice: LINE_B_PRICE },
    ],
    shippingBeforeSubsidy: SHIPPING,
    providerTax: { taxId: tax.taxId, ratePercent: tax.ratePercent },
  }) as PricingSnapshot;
  check(
    "snapshot lokal: PPN 22001 dan payable 252002",
    snapshot.ppnAmount === String(PPN_AMOUNT) && snapshot.expectedProviderPayable === String(PAYABLE),
    `ppn=${snapshot.ppnAmount} payable=${snapshot.expectedProviderPayable}`
  );
  if (snapshot.providerContractVersion !== 3) throw new Error("snapshot did not build the provider3 contract");
  const taxLineA = snapshot.lines.find((line) => line.variantId === "evidence-line-a")?.providerTaxAmount;
  const taxLineB = snapshot.lines.find((line) => line.variantId === "evidence-line-b")?.providerTaxAmount;
  check(
    "snapshot lokal: alokasi per baris 8801/13200",
    taxLineA === String(LINE_A_TAX) && taxLineB === String(LINE_B_TAX),
    `${taxLineA}/${taxLineB}`
  );

  const note = `OKCIR_PPN_EVIDENCE:${Date.now()}`;
  let salesOrderId: number | null = null;
  try {
    const created = await gateway.createSalesOrder({
      providerContractVersion: 3,
      contactId: -1,
      customerName: "Sandbox PPN Evidence",
      locationId: candidate.locationId,
      note,
      refNo: note,
      channelStatus: "Belum Bayar",
      originalShipmentCost: SHIPPING,
      shippingCost: SHIPPING,
      expectedProviderPayable: PAYABLE,
      providerTax: { taxId: tax.taxId, ratePercent: tax.ratePercent },
      items: [
        {
          itemId: candidate.itemA,
          quantity: 1,
          price: LINE_A_PRICE,
          discAmount: LINE_A_DISCOUNT,
          taxAmount: LINE_A_TAX,
          unit: UNIT,
          taxId: tax.taxId,
        },
        {
          itemId: candidate.itemB,
          quantity: 1,
          price: LINE_B_PRICE,
          discAmount: 0,
          taxAmount: LINE_B_TAX,
          unit: UNIT,
          taxId: tax.taxId,
        },
      ],
      operationId: note,
    });
    salesOrderId = created.salesOrderId;
    journal.salesOrderId = salesOrderId;
    check("create provider3 + GET verifikasi per baris", true, `salesOrderId=${salesOrderId}`);
    journal.confirmed = {
      salesorderId: created.order.salesorderId,
      subTotal: created.order.subTotal,
      totalDisc: created.order.totalDisc,
      totalTax: created.order.totalTax,
      grandTotal: created.order.grandTotal,
      originalShipmentCost: created.order.originalShipmentCost ?? null,
      shippingCost: created.order.shippingCost ?? null,
      items: created.order.items.map((item) => ({
        itemId: item.itemId,
        quantity: item.quantity,
        price: item.price,
        amount: item.amount,
        taxId: item.taxId ?? null,
        taxAmount: item.taxAmount ?? null,
      })),
    };
    const confirmed = created.order;
    check(
      "header SO: sub_total 220001 / total_disc 20000 / total_tax 22001 / grand_total 252002",
      confirmed.subTotal === LINE_A_PRICE + LINE_B_PRICE &&
        confirmed.totalDisc === LINE_A_DISCOUNT &&
        confirmed.totalTax === PPN_AMOUNT &&
        confirmed.grandTotal === PAYABLE,
      `${confirmed.subTotal}/${confirmed.totalDisc}/${confirmed.totalTax}/${confirmed.grandTotal}`
    );
    const confirmedA = confirmed.items.find((item) => item.itemId === candidate.itemA);
    const confirmedB = confirmed.items.find((item) => item.itemId === candidate.itemB);
    check(
      "pajak per baris provider = alokasi snapshot (8801/13200)",
      confirmedA?.taxAmount === LINE_A_TAX &&
        confirmedA?.taxId === tax.taxId &&
        confirmedB?.taxAmount === LINE_B_TAX &&
        confirmedB?.taxId === tax.taxId,
      `A=${confirmedA?.taxAmount}/${confirmedA?.taxId} B=${confirmedB?.taxAmount}/${confirmedB?.taxId}`
    );
  } catch (error) {
    // Provider write may have been applied: never retry. Clean up only with the
    // returned id (cancel is a separate, explicitly authorized write).
    const gatewayError = error as JubelioSalesGatewayError;
    const returnedId = (gatewayError?.options as { salesOrderId?: number } | undefined)?.salesOrderId;
    journal.createAmbiguous = gatewayError?.options?.ambiguous === true;
    journal.salesOrderId = returnedId ?? null;
    check("create provider3 + GET verifikasi per baris", false, gatewayError?.message ?? String(error));
    salesOrderId = returnedId ?? null;
  }

  // ---- 4. satu cancel + stok kembali ----
  if (salesOrderId != null) {
    try {
      const canceled = await gateway.cancelSalesOrder({ salesOrderId, operationId: note });
      journal.cancel = { salesOrderId, isCanceled: canceled.order.isCanceled };
      check("cancel SO terkonfirmasi via GET", canceled.order.isCanceled);
    } catch (error) {
      journal.cancel = { salesOrderId, error: (error as Error).message };
      check("cancel SO terkonfirmasi via GET", false, (error as Error).message);
    }
    const after = await stocksFor(token, [candidate.itemA, candidate.itemB], candidate.locationId);
    const restored = after.every((row, index) => row.available === before[index].available);
    journal.stockRestored = restored;
    check("stok kembali ke nilai sebelum create", restored, JSON.stringify(after));
  }

  writeJournal();
  console.log(failures.length === 0 ? "\nALL PROVIDER3 EVIDENCE CHECKS PASSED" : `\n${failures.length} CHECK(S) FAILED`);
  if (failures.length > 0) process.exitCode = 1;
}

function pickLocationWithTwoItems(
  inventory: InventoryItem[]
): { locationId: number; itemA: number; itemB: number } | null {
  const byLocation = new Map<number, number[]>();
  for (const item of inventory) {
    const itemId = Number(item.item_id);
    if (!Number.isInteger(itemId) || itemId <= 0) continue;
    for (const stock of item.location_stocks ?? []) {
      const locationId = Number(stock.location_id);
      const available = Number(stock.available);
      if (!Number.isInteger(locationId) || locationId === 0) continue;
      if (!Number.isFinite(available) || available < 1) continue;
      const list = byLocation.get(locationId) ?? [];
      if (!list.includes(itemId)) list.push(itemId);
      byLocation.set(locationId, list);
    }
  }
  for (const [locationId, itemIds] of [...byLocation.entries()].sort((a, b) => a[0] - b[0])) {
    if (itemIds.length >= 2) {
      return { locationId, itemA: itemIds[0], itemB: itemIds[1] };
    }
  }
  return null;
}

async function login(): Promise<string> {
  const response = await fetch(`${process.env.JUBELIO_API_BASE_URL?.replace(/\/$/, "")}/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: process.env.JUBELIO_EMAIL, password: process.env.JUBELIO_PASSWORD }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await response.json()) as { token?: string };
  if (!response.ok || typeof body.token !== "string") {
    throw new Error(`login failed (${response.status})`);
  }
  return body.token;
}

async function authenticatedGet(token: string, pathAndQuery: string): Promise<Record<string, unknown>> {
  const response = await fetch(
    `${process.env.JUBELIO_API_BASE_URL?.replace(/\/$/, "")}${pathAndQuery}`,
    { headers: { authorization: token }, signal: AbortSignal.timeout(20_000) }
  );
  if (!response.ok) throw new Error(`GET ${pathAndQuery} failed (${response.status})`);
  return (await response.json()) as Record<string, unknown>;
}

async function listInventory(token: string): Promise<InventoryItem[]> {
  const items: InventoryItem[] = [];
  for (let page = 1; page <= 5; page += 1) {
    const body = await authenticatedGet(token, `/inventory/?page=${page}&pageSize=100`);
    const data = Array.isArray(body.data) ? (body.data as InventoryItem[]) : [];
    items.push(...data);
    const total = Number(body.totalCount ?? 0);
    if (data.length === 0 || items.length >= total) break;
  }
  return items;
}

async function stocksFor(
  token: string,
  itemIds: number[],
  locationId: number
): Promise<Array<{ itemId: number; available: number; onHand: number }>> {
  const response = await fetch(
    `${process.env.JUBELIO_API_BASE_URL?.replace(/\/$/, "")}/inventory/items/all-stocks/`,
    {
      method: "POST",
      headers: { authorization: token, "content-type": "application/json" },
      body: JSON.stringify({ ids: itemIds }),
      signal: AbortSignal.timeout(20_000),
    }
  );
  if (!response.ok) throw new Error(`stock read failed (${response.status})`);
  const body = (await response.json()) as {
    data: Array<{ item_id: string; location_stocks: Array<Record<string, unknown>> }>;
  };
  return itemIds.map((itemId) => {
    const row = body.data.find((entry) => Number(entry.item_id) === itemId);
    const locationStock = row?.location_stocks.find(
      (stock) => Number(stock.location_id) === locationId
    );
    return {
      itemId,
      available: Number(locationStock?.available ?? 0),
      onHand: Number(locationStock?.on_hand ?? 0),
    };
  });
}

function writeJournal(): void {
  // Dijalankan dari apps/store (lihat header); path relatif terhadap cwd.
  const target = path.resolve(
    process.cwd(),
    "../../.scratch/jubelio-sales-api-switching/research/jubelio-sales-provider3-multiline-results.json"
  );
  writeFileSync(target, `${JSON.stringify(journal, null, 2)}\n`, "utf8");
  console.log(`journal: ${target}`);
}

main().catch((error) => {
  console.error("PROVIDER3 EVIDENCE FAILED:", error instanceof Error ? error.message : error);
  process.exit(1);
});

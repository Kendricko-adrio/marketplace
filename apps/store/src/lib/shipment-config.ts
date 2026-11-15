import { inArray } from "drizzle-orm";
import { db, systemConfig } from "@/db";
import type { ShipmentParcelInput } from "./shipment-parcel";

type Row = { key: string; value: string };
const keys = ["shipment.parcelFallback", "shipment.packagingWeightGrams"];
/** Re-read IT parameters per quote; a cached PPN/cart read must not pin readiness. */
export async function loadShipmentParcelConfig(read: () => Promise<Row[]> = () => db.select({ key: systemConfig.key, value: systemConfig.value }).from(systemConfig).where(inArray(systemConfig.key, keys))) {
  const rows = new Map((await read()).map((row) => [row.key, row.value]));
  let fallback: ShipmentParcelInput["fallback"] = null;
  try { fallback = JSON.parse(rows.get(keys[0]) ?? "null"); } catch { /* Invalid fallback remains unavailable. */ }
  const raw = (rows.get(keys[1]) ?? "").trim();
  const number = /^\d+$/.test(raw) ? Number(raw) : NaN;
  const packagingWeight = Number.isSafeInteger(number) && number >= 0 ? number : NaN;
  return { fallback, packagingWeight };
}

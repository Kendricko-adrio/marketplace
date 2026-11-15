import { inArray } from "drizzle-orm";

import { db } from "@/db";
import { systemConfig } from "@/db";
import {
  DISCOUNT_IMPORT_LIMIT_KEYS,
  resolveDiscountImportLimits,
  type DiscountImportLimits,
} from "@marketplace/db/src/discount-import-limits";

// =========================================================
// Configured import limits — read UNCACHED per stage/apply request
// =========================================================
// Spec §6.2: limit dibaca per request staging/apply supaya perubahan operator
// berlaku pada request berikutnya (bukan cache boot store yang stale). Nilai
// invalid tidak pernah menjadi "tanpa limit": `resolveDiscountImportLimits`
// melempar `DiscountImportLimitError` dan caller fail closed. Limit baru tidak
// menghapus batch/result yang sudah committed.

export async function readDiscountImportLimitsUncached(): Promise<DiscountImportLimits> {
  const rows = await db
    .select({ key: systemConfig.key, value: systemConfig.value })
    .from(systemConfig)
    .where(inArray(systemConfig.key, Object.values(DISCOUNT_IMPORT_LIMIT_KEYS)));

  const byKey = new Map<string, string | null>();
  for (const row of rows) {
    byKey.set(row.key, row.value);
  }

  return resolveDiscountImportLimits({
    maxRows: byKey.get(DISCOUNT_IMPORT_LIMIT_KEYS.maxRows) ?? null,
    maxFileBytes: byKey.get(DISCOUNT_IMPORT_LIMIT_KEYS.maxFileBytes) ?? null,
    maxExpandedBytes:
      byKey.get(DISCOUNT_IMPORT_LIMIT_KEYS.maxExpandedBytes) ?? null,
  });
}

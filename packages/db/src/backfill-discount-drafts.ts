/**
 * Backfill `discount_offer_revision.draft_configuration` untuk draft lama yang
 * dibuat sebelum model snapshot menyeluruh.
 *
 * Aturan:
 * - Hanya revision yang BELUM publish (`published_at IS NULL`) dan belum punya
 *   snapshot yang disentuh. Revision live/published tidak diubah.
 * - Nilai diambil apa adanya dari kolom legacy + benefit + kapasitas Offer;
 *   field yang belum lengkap tetap NULL (tidak mengarang nama/kuota/benefit).
 * - Idempotent: baris yang sudah punya snapshot dilewati, jadi aman diulang.
 * - Tidak menaikkan version/policyVersion, tidak menulis usage, kode, atau
 *   audit domain.
 *
 * Usage (root): `npm run db:backfill-discount-drafts`
 */
import dotenv from "dotenv";
dotenv.config({ path: "../../.env" });
import { isNull, and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import {
  parseDiscountDraftConfiguration,
  type DiscountDraftConfiguration,
} from "./discount-draft";
import { discountBenefits, discountOfferRevisions, discountOffers } from "./schema";

function moneyText(value: string | null): string | null {
  if (value === null) return null;
  return /^\d+$/.test(value) ? value : null;
}

export function configurationFromLegacy(input: {
  name: string | null;
  minSubtotal: string | null;
  startAt: Date | null;
  endAt: Date | null;
  benefit:
    | {
        kind: string;
        paramsVersion: number;
        fixedAmount: string | null;
        rate: string | null;
        capAmount: string | null;
      }
    | null;
  quotaCount: number | null;
  budgetAmount: string | null;
  perClientLimit: number | null;
}): DiscountDraftConfiguration | null {
  const benefit = input.benefit;
  const parsed = parseDiscountDraftConfiguration({
    draftSchemaVersion: 1,
    name: input.name,
    currency: "IDR",
    minSubtotal: moneyText(input.minSubtotal),
    startAt: input.startAt ? input.startAt.toISOString() : null,
    endAt: input.endAt ? input.endAt.toISOString() : null,
    benefit:
      benefit === null
        ? null
        : benefit.paramsVersion !== 1
          ? null
          : benefit.kind === "fixed_goods"
            ? {
                kind: "fixed_goods",
                paramsVersion: 1,
                fixedAmount: moneyText(benefit.fixedAmount),
              }
            : benefit.kind === "shipping"
              ? {
                  kind: "shipping",
                  paramsVersion: 1,
                  capAmount: moneyText(benefit.capAmount),
                }
              : benefit.kind === "percentage_goods"
                ? {
                    kind: "percentage_goods",
                    paramsVersion: 1,
                    rate: benefit.rate,
                    capAmount: moneyText(benefit.capAmount),
                  }
                : null,
    capacity: {
      quotaCount: input.quotaCount,
      budgetAmount: moneyText(input.budgetAmount),
      perClientLimit: input.perClientLimit,
    },
    codeChanges: { proposedCodes: [], states: [] },
  });
  return parsed.success ? parsed.configuration : null;
}

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const db = drizzle(pool);
  let updated = 0;
  let skipped = 0;
  try {
    const rows = await db
      .select({
        revision: discountOfferRevisions,
        offer: discountOffers,
        benefit: discountBenefits,
      })
      .from(discountOfferRevisions)
      .innerJoin(discountOffers, eq(discountOffers.id, discountOfferRevisions.offerId))
      .leftJoin(discountBenefits, eq(discountBenefits.revisionId, discountOfferRevisions.id))
      .where(
        and(
          isNull(discountOfferRevisions.publishedAt),
          isNull(discountOfferRevisions.draftConfiguration)
        )
      );

    for (const row of rows) {
      const configuration = configurationFromLegacy({
        name: row.revision.name,
        minSubtotal: row.revision.minSubtotal,
        startAt: row.revision.startAt,
        endAt: row.revision.endAt,
        benefit: row.benefit
          ? {
              kind: row.benefit.kind,
              paramsVersion: row.benefit.paramsVersion,
              fixedAmount: row.benefit.fixedAmount,
              rate: row.benefit.rate,
              capAmount: row.benefit.capAmount,
            }
          : null,
        quotaCount: row.offer.quotaCount,
        budgetAmount: row.offer.budgetAmount,
        perClientLimit: row.offer.perClientLimit,
      });
      if (!configuration) {
        skipped += 1;
        continue;
      }
      // Hanya snapshot draft yang ditulis: pointer live, kapasitas live,
      // kode, usage, version, dan audit tidak berubah.
      await db
        .update(discountOfferRevisions)
        .set({ draftConfiguration: configuration })
        .where(
          and(
            eq(discountOfferRevisions.id, row.revision.id),
            isNull(discountOfferRevisions.draftConfiguration)
          )
        );
      updated += 1;
    }
    console.log(
      `Backfill draft diskon selesai: ${updated} revision diperbarui, ${skipped} dilewati (data legacy tidak dapat dipetakan).`
    );
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("Backfill draft diskon gagal:", error);
  process.exit(1);
});

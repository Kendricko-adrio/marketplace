import { and, eq, inArray, sql, type SQL, type SQLWrapper } from "drizzle-orm";

import { db } from "@/db";
import {
  productVariants,
  variantPriceCurrent,
  variantPriceRevisions,
} from "@/db";
import {
  MarkdownPriceError,
  projectMarkdownPrice,
  type MarkdownPriceProjection,
} from "@marketplace/db/src/markdown-pricing";
import { PricingContractError } from "./versioned-pricing";

/**
 * Markdown read projection for the storefront.
 *
 * ONE definition of "effective price" for every surface (catalog, homepage,
 * detail, cart, preview, checkout): a stored target is active only while it is
 * strictly below the variant's CURRENT source price. `effectivePriceSql` is the
 * same rule expressed in SQL so filters/sorts/range operate on the effective
 * projection with pagination, instead of evaluating the whole catalog in the
 * browser. Original/strikethrough always comes from the SAME variant row.
 *
 * `target` is never written into `product_variant.price`; a source sync only
 * changes the source, so a fallback target stays stored and reactivates when
 * the source rises (spec §4.1).
 */

/** `case when target is not null and target < source then target else source end`. */
export function effectivePriceSql(
  source: SQLWrapper | SQL,
  target: SQLWrapper | SQL
): SQL<string> {
  return sql<string>`case when ${target} is not null and ${target} < ${source} then ${target} else ${source} end`;
}

/** `target is not null and target < source` — the ONLY definition of an active badge. */
export function markdownActiveSql(
  source: SQLWrapper | SQL,
  target: SQLWrapper | SQL
): SQL<boolean> {
  return sql<boolean>`(${target} is not null and ${target} < ${source})`;
}

export interface VariantProjectionRow {
  variantId: string;
  sourceUnitPrice: string;
  storedTargetUnitPrice: string | null;
  markdownRevisionId: string | null;
}

export function projectRow(row: VariantProjectionRow): MarkdownPriceProjection {
  try {
    return projectMarkdownPrice({
      sourceUnitPrice: row.sourceUnitPrice,
      storedTargetUnitPrice: row.storedTargetUnitPrice,
      markdownRevisionId: row.markdownRevisionId,
    });
  } catch (error) {
    if (error instanceof MarkdownPriceError) {
      // A stored current pointer that disagrees with its own money is corrupt
      // pricing data: fail closed instead of showing/pricing a partial price.
      throw new PricingContractError(
        "PRICING_SNAPSHOT_CORRUPT",
        `variant ${row.variantId} carries inconsistent Markdown data: ${error.message}`
      );
    }
    throw error;
  }
}

/**
 * Read projections for up to 50 variants in ONE query (no N+1). Missing ids are
 * absent from the map; callers treat that as "variant not found" not as a zero
 * price.
 */
export async function readVariantProjections(
  variantIds: readonly string[]
): Promise<Map<string, MarkdownPriceProjection>> {
  const result = new Map<string, MarkdownPriceProjection>();
  if (variantIds.length === 0) return result;
  const rows = await db
    .select({
      variantId: productVariants.id,
      sourceUnitPrice: productVariants.price,
      storedTargetUnitPrice: variantPriceRevisions.targetUnitPrice,
      markdownRevisionId: variantPriceRevisions.id,
      revisionVariantId: variantPriceRevisions.variantId,
    })
    .from(productVariants)
    .leftJoin(
      variantPriceCurrent,
      eq(variantPriceCurrent.variantId, productVariants.id)
    )
    .leftJoin(
      variantPriceRevisions,
      and(
        eq(variantPriceRevisions.id, variantPriceCurrent.revisionId),
        eq(variantPriceRevisions.variantId, variantPriceCurrent.variantId)
      )
    )
    .where(inArray(productVariants.id, [...variantIds]));
  for (const row of rows) {
    // A pointer whose revision belongs to another variant can never be a valid
    // projection; the composite FK already forbids it, so this is belt + braces.
    if (row.revisionVariantId !== null && row.revisionVariantId !== row.variantId) {
      throw new PricingContractError(
        "PRICING_SNAPSHOT_CORRUPT",
        `variant ${row.variantId} points at a Markdown revision of another variant`
      );
    }
    result.set(
      row.variantId,
      projectRow({
        variantId: row.variantId,
        sourceUnitPrice: row.sourceUnitPrice,
        storedTargetUnitPrice: row.storedTargetUnitPrice,
        markdownRevisionId: row.revisionVariantId === null ? null : row.markdownRevisionId,
      })
    );
  }
  return result;
}

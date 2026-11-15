import { and, eq, inArray } from "drizzle-orm";

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

/**
 * Admin read projection for one product's variants (bounded, no N+1). Uses the
 * SAME pure `projectMarkdownPrice` rule as the storefront so an admin review can
 * never show a different effective price than the surface it is changing.
 */
export async function readAdminVariantProjections(
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
    try {
      result.set(
        row.variantId,
        projectMarkdownPrice({
          sourceUnitPrice: row.sourceUnitPrice,
          storedTargetUnitPrice: row.storedTargetUnitPrice,
          markdownRevisionId:
            row.revisionVariantId === null ? null : row.markdownRevisionId,
        })
      );
    } catch (error) {
      if (error instanceof MarkdownPriceError) {
        // Corrupt current pointer/revision: surface no price rather than a
        // silently different one.
        continue;
      }
      throw error;
    }
  }
  return result;
}

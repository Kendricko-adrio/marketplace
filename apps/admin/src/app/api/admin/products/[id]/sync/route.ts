import { NextRequest, NextResponse } from "next/server";
import { db, products, auditLogs } from "@/db";
import { eq } from "drizzle-orm";
import { serializeError } from "@/lib/logger";
import { guard } from "@/lib/rbac/guard";
import { syncOneProduct } from "@marketplace/db/src/jubelio-sync";

export const dynamic = "force-dynamic";

/**
 * Re-sync a single product from Jubelio (source of truth)   [products:edit:all]
 *
 * Triggered by the "Sync" button on the admin product detail page. Looks up
 * the product's `jubelio_item_group_id`, re-fetches its catalog detail
 * (brand, description, gallery images, variants) + per-branch stock from
 * Jubelio, and upserts. See packages/db/src/jubelio-sync.ts `syncOneProduct`.
 *
 * The global re-sync is an all-branch product mutation: view-only and
 * impossible own-branch edit grants are denied (403) even for a carried
 * product — the required scope is `edit all_branches`. The audit event is
 * classified as a global event with the policy version in force.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guardResult = await guard("products", "edit", {
    request,
    requiredScope: "all_branches",
  });
  if (!guardResult.ok) return guardResult.response;
  const { logger, ctx } = guardResult;

  try {
    const { id } = await params;
    const syncLog = logger.child({ productId: id });

    const [row] = await db
      .select({ jubelioItemGroupId: products.jubelioItemGroupId })
      .from(products)
      .where(eq(products.id, id))
      .limit(1);

    if (!row) {
      syncLog.warn("products.sync.not_found", {
        outcome: "denied",
        reason: "product_not_found",
      });
      return NextResponse.json(
        { success: false, error: "Product not found" },
        { status: 404 }
      );
    }
    if (!row.jubelioItemGroupId) {
      syncLog.warn("products.sync.not_jubelio_product", {
        outcome: "denied",
        reason: "missing_item_group_id",
      });
      return NextResponse.json(
        {
          success: false,
          error:
            "Product is not a Jubelio-synced product (no jubelio_item_group_id)",
        },
        { status: 400 }
      );
    }

    const result = await syncOneProduct(db, row.jubelioItemGroupId);

    await db.insert(auditLogs).values({
      id: crypto.randomUUID(),
      userId: ctx.user.id,
      action: "JUBELIO_SYNC_ADMIN",
      entityType: "product",
      entityId: id,
      changes: { itemGroupId: row.jubelioItemGroupId, ...result },
      ipAddress: null,
      // Global/system event: visible to audit_log all-branch scope only.
      policyVersion: ctx.policy.policyVersion,
      branchScope: "global",
    });

    syncLog.info("products.sync", {
      outcome: "success",
      policyVersion: ctx.policy.policyVersion,
    });

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    logger.error("products.sync.failure", {
      outcome: "error",
      error: serializeError(error),
    });
    return NextResponse.json(
      { success: false, error: "Sync failed" },
      { status: 500 }
    );
  }
}
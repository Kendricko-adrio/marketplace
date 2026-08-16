import { NextRequest, NextResponse } from "next/server";
import { db, products, auditLogs } from "@/db";
import { eq } from "drizzle-orm";
import { withPermission } from "@/lib/auth-guard";
import { syncOneProduct } from "@marketplace/db/src/jubelio-sync";

/**
 * Re-sync a single product from Jubelio (source of truth). Triggered by the
 * "Sync" button on the admin product detail page. Looks up the product's
 * `jubelio_item_group_id`, re-fetches its catalog detail (brand, description,
 * gallery images, variants) + per-branch stock from Jubelio, and upserts.
 * See packages/db/src/jubelio-sync.ts `syncOneProduct`.
 */
export const POST = withPermission(async (
  _ctx,
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  try {
    const { id } = await params;

    const [row] = await db
      .select({ jubelioItemGroupId: products.jubelioItemGroupId })
      .from(products)
      .where(eq(products.id, id))
      .limit(1);

    if (!row) {
      return NextResponse.json(
        { success: false, error: "Product not found" },
        { status: 404 }
      );
    }
    if (!row.jubelioItemGroupId) {
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
      userId: null,
      action: "JUBELIO_SYNC_ADMIN",
      entityType: "product",
      entityId: id,
      changes: { itemGroupId: row.jubelioItemGroupId, ...result },
      ipAddress: null,
    });

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error("Error syncing product from Jubelio:", error);
    return NextResponse.json(
      { success: false, error: "Sync failed" },
      { status: 500 }
    );
  }
}, "products", "edit");
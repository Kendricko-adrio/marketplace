import { NextRequest, NextResponse } from "next/server";
import { db, products, auditLogs } from "@/db";
import { eq } from "drizzle-orm";
import { createModuleLogger, withRequestContext } from "@/lib/logger";
import { guard } from "@/lib/rbac/guard";
import { syncOneProduct } from "@marketplace/db/src/jubelio-sync";

export const dynamic = "force-dynamic";

/**
 * Module logger untuk route ini: dibuat sekali di module scope, sedangkan
 * `requestId` dibaca dari scope HTTP yang aktif setiap kali log ditulis.
 */
const log = createModuleLogger("admin-product-sync");

/**
 * Proyeksi teknis statis untuk field `error`: pesan asli dari provider Jubelio
 * maupun DB tidak pernah masuk log (bisa memuat response provider/URL).
 */
class ProductSyncLogError extends Error {
  constructor() {
    super("products sync gagal");
    this.name = "ProductSyncLogError";
  }
}

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
async function syncProduct(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const guardResult = await guard("products", "edit", {
    requiredScope: "all_branches",
  });
  if (!guardResult.ok) return guardResult.response;
  const { ctx } = guardResult;

  let productId: string | null = null;
  try {
    const { id } = await params;
    productId = id;

    const [row] = await db
      .select({ jubelioItemGroupId: products.jubelioItemGroupId })
      .from(products)
      .where(eq(products.id, id))
      .limit(1);

    if (!row) {
      log.warn(
        `products.sync.not_found (productId ${id}, reason product_not_found, outcome denied)`
      );
      return NextResponse.json(
        { success: false, error: "Product not found" },
        { status: 404 }
      );
    }
    if (!row.jubelioItemGroupId) {
      log.warn(
        `products.sync.not_jubelio_product (productId ${id}, reason missing_item_group_id, outcome denied)`
      );
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

    log.info(
      `products.sync (productId ${id}, itemGroupId ${row.jubelioItemGroupId}, auditAction JUBELIO_SYNC_ADMIN, actingUserId ${ctx.user.id}, policyVersion ${ctx.policy.policyVersion}, outcome success)`
    );

    return NextResponse.json({ success: true, data: result });
  } catch {
    // Nilai yang tertangkap tidak pernah masuk log: bisa memuat response
    // provider Jubelio atau pesan driver DB.
    log.error(
      `products.sync gagal (productId ${productId ?? "unknown"}, outcome error)`,
      new ProductSyncLogError()
    );
    return NextResponse.json(
      { success: false, error: "Sync failed" },
      { status: 500 }
    );
  }
}

export const POST = withRequestContext(syncProduct, "admin-product-sync");

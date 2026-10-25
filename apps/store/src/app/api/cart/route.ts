import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  carts,
  cartItems,
  productVariants,
  products,
  productImages,
  branches,
  branchStocks,
} from "@/db";
import { eq, and, asc, sql } from "drizzle-orm";
import { requireOnboardedApiSession } from "@/lib/route-access";
import { getPpnRatePercent, getDiscountsContractVersion } from "@/lib/config";
import { buildPricingSnapshot } from "@/lib/versioned-pricing";
import { readVariantProjections } from "@/lib/variant-price-projection";
import { createModuleLogger, withRequestContext } from "@/lib/logger";

/**
 * Module logger untuk route ini: dibuat sekali di module scope, sedangkan
 * `requestId` dibaca dari scope HTTP yang aktif setiap kali log ditulis
 * (`withRequestContext` di export handler membuka scope tersebut).
 */
const log = createModuleLogger("cart");

/**
 * Proyeksi teknis statis untuk field `error`: pesan asli dari DB/Next/provider
 * tidak pernah masuk log, hanya pesan yang ditulis module ini. Kontrak HTTP
 * gagal (status/body) tidak berubah.
 */
class RouteLogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RouteLogError";
  }
}

// Helper to get or create cart
async function getOrCreateCart(userId: string) {
  const newCartId = crypto.randomUUID();
  await db
    .insert(carts)
    .values({ id: newCartId, userId })
    .onConflictDoNothing({ target: carts.userId });
  const [cart] = await db
    .select()
    .from(carts)
    .where(eq(carts.userId, userId))
    .limit(1);
  if (!cart) throw new Error("Failed to create cart");
  return cart;
}

async function getCart(_request: NextRequest): Promise<Response> {
  try {
    const access = await requireOnboardedApiSession();
    if (!access.ok) return access.response;
    const { session } = access;

    const cart = await getOrCreateCart(session.user.id);

    // Get cart items with product details (each item carries its own branchId)
    const items = await db
      .select({
        id: cartItems.id,
        quantity: cartItems.quantity,
        available: sql<number>`CASE
          WHEN ${branches.status} = 'aktif'
            AND ${branches.jubelioLocationId} IS NOT NULL
            AND ${productVariants.jubelioItemId} IS NOT NULL
          THEN GREATEST(0, COALESCE(${branchStocks.availableStock}, 0) - COALESCE(${branchStocks.pendingRemoteStock}, 0))
          ELSE 0 END`,
        variantId: cartItems.variantId,
        branchId: cartItems.branchId,
        variant: {
          id: productVariants.id,
          sku: productVariants.sku,
          color: productVariants.color,
          size: productVariants.size,
          price: productVariants.price,
        },
        branch: {
          id: branches.id,
          name: branches.name,
          city: branches.city,
        },
        product: {
          id: products.id,
          name: products.name,
          slug: products.slug,
          basePrice: products.basePrice,
          thumbnail: products.thumbnail,
        },
      })
      .from(cartItems)
      .innerJoin(productVariants, eq(cartItems.variantId, productVariants.id))
      .innerJoin(products, eq(productVariants.productId, products.id))
      .leftJoin(branches, eq(cartItems.branchId, branches.id))
      .leftJoin(branchStocks, and(
        eq(branchStocks.branchId, cartItems.branchId),
        eq(branchStocks.productVariantId, cartItems.variantId)
      ))
      .where(eq(cartItems.cartId, cart.id));

    // Get an image for each item: prefer the product-level thumbnail (Jubelio
    // CDN), fall back to the variant's first image for legacy products.
    const itemsWithImages = await Promise.all(
      items.map(async (item) => {
        let image = item.product.thumbnail ?? null;
        if (!image) {
          const images = await db
            .select()
            .from(productImages)
            .where(eq(productImages.variantId, item.variantId))
            .orderBy(asc(productImages.displayOrder))
            .limit(1);
          image = images[0]?.url || null;
        }

        return {
          ...item,
          image,
        };
      })
    );

    const pricingContractVersion = await getDiscountsContractVersion();
    const ppnRatePercent = await getPpnRatePercent();
    // One Markdown projection read for the whole (bounded) cart. The UI reads
    // `variant.price` as the effective price, with the same variant's source
    // kept explicit for the strikethrough.
    const projections = await readVariantProjections(
      itemsWithImages.map((item) => item.variantId)
    );
    const displayItems = itemsWithImages.map((item) => {
      const projection = projections.get(item.variantId);
      return {
        ...item,
        variant: {
          ...item.variant,
          price: projection?.effectiveUnitPrice ?? item.variant.price,
          sourcePrice: projection?.sourceUnitPrice ?? item.variant.price,
          storedTarget: projection?.storedTarget ?? null,
          markdownActive: projection?.markdownActive ?? false,
          markdownRevisionId: projection?.markdownRevisionId ?? null,
        },
      };
    });
    // Empty carts have no pricing snapshot. Non-empty v1 carts are validated
    // exactly before any conversion to the existing UI's numeric DTO.
    const snapshot = pricingContractVersion === 1 && displayItems.length
      ? buildPricingSnapshot({
          fulfillmentMethod: "pickup", ppnRatePercent,
          lines: displayItems.map((item) => ({
            variantId: item.variantId, quantity: item.quantity,
            sourceUnitPrice: item.variant.sourcePrice,
            effectiveUnitPrice: item.variant.price,
            markdownRevisionId: item.variant.markdownRevisionId,
          })),
        })
      : null;
    const subtotal = pricingContractVersion === 1
      ? Number(snapshot?.subtotal ?? "0")
      : displayItems.reduce((sum, item) => sum + parseFloat(item.variant.price) * item.quantity, 0);
    // Fakta bisnis (user, jumlah item, subtotal, PPN) hanya ada di message.
    log.info(
      `cart served: user ${session.user.id}, ${displayItems.length} item, subtotal ${subtotal}, ppn ${ppnRatePercent}%`
    );
    return NextResponse.json({
      success: true,
      data: {
        id: cart.id,
        pricingContractVersion,
        items: displayItems,
        itemCount: displayItems.length,
        subtotal,
        ppnRatePercent: Number(ppnRatePercent),
      },
    });
  } catch {
    log.error("cart fetch failed", new RouteLogError("cart read failed"));
    return NextResponse.json(
      { success: false, error: "Failed to fetch cart" },
      { status: 500 }
    );
  }
}

async function deleteCart(_request: NextRequest): Promise<Response> {
  try {
    const access = await requireOnboardedApiSession();
    if (!access.ok) return access.response;
    const { session } = access;

    const cart = await db
      .select()
      .from(carts)
      .where(eq(carts.userId, session.user.id))
      .limit(1);

    if (cart.length > 0) {
      await db.delete(cartItems).where(eq(cartItems.cartId, cart[0].id));
      await db
        .update(carts)
        .set({ updatedAt: new Date() })
        .where(eq(carts.id, cart[0].id));
    }

    log.info(`cart cleared: user ${session.user.id}`);
    return NextResponse.json({
      success: true,
      message: "Cart cleared",
    });
  } catch {
    log.error("cart clear failed", new RouteLogError("cart clear failed"));
    return NextResponse.json(
      { success: false, error: "Failed to clear cart" },
      { status: 500 }
    );
  }
}

/** HTTP entry: wrapper menambahkan `x-request-id` kanonik + satu baris completion. */
export const GET = withRequestContext(getCart, "cart");
export const DELETE = withRequestContext(deleteCart, "cart");

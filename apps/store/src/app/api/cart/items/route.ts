import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { carts, cartItems, productVariants, branchStocks, branches } from "@/db";
import { eq, and, sql } from "drizzle-orm";
import { requireOnboardedApiSession } from "@/lib/route-access";
import { z } from "zod";
import { createModuleLogger, withRequestContext } from "@/lib/logger";
import { sellableUnits } from "@/lib/stock";

/**
 * Module logger untuk route ini: dibuat sekali di module scope, sedangkan
 * `requestId` dibaca dari scope HTTP yang aktif setiap kali log ditulis
 * (`withRequestContext` di export handler membuka scope tersebut).
 */
const log = createModuleLogger("cart-items");

/**
 * Proyeksi teknis statis untuk field `error`: pesan asli dari DB/Next/provider
 * tidak pernah masuk log, hanya pesan yang ditulis module ini.
 */
class RouteLogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RouteLogError";
  }
}

const addItemSchema = z.object({
  variantId: z.string(),
  branchId: z.string(),
  quantity: z.number().int().positive().default(1),
});

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

async function addCartItem(request: NextRequest): Promise<Response> {
  try {
    const access = await requireOnboardedApiSession();
    if (!access.ok) return access.response;
    const { session } = access;

    const body = await request.json();
    const parsed = addItemSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid request body" },
        { status: 400 }
      );
    }

    const { variantId, branchId, quantity } = parsed.data;

    // Check if variant exists
    const variant = await db
      .select()
      .from(productVariants)
      .where(eq(productVariants.id, variantId))
      .limit(1);

    if (variant.length === 0) {
      return NextResponse.json(
        { success: false, error: "Variant not found" },
        { status: 404 }
      );
    }

    // Check if branch exists and is active
    const branch = await db
      .select()
      .from(branches)
      .where(eq(branches.id, branchId))
      .limit(1);

    if (branch.length === 0 || branch[0].status !== "aktif") {
      return NextResponse.json(
        { success: false, error: "Branch not available" },
        { status: 400 }
      );
    }

    if (variant[0].jubelioItemId == null || branch[0].jubelioLocationId == null) {
      log.warn(
        `cart item rejected — Jubelio stock mapping unavailable (variant ${variantId}, branch ${branchId})`
      );
      return NextResponse.json({ success: false, error: "Jubelio stock mapping unavailable" }, { status: 409 });
    }

    const cart = await getOrCreateCart(session.user.id);
    // Lock snapshot selama mutasi agar sync/hold dan request paralel tidak
    // meloloskan quantity berdasarkan snapshot yang sudah berubah.
    const result = await db.transaction(async (tx) => {
      const [stockRow] = await tx.select().from(branchStocks)
        .where(and(
          eq(branchStocks.branchId, branchId),
          eq(branchStocks.productVariantId, variantId)
        )).for("update");
      if (!stockRow) return { ok: false, status: 409, error: "Stock mapping unavailable" };
      const available = sellableUnits(stockRow);
      if (quantity > available) {
        return { ok: false, status: 400, error: "Stok produk di cabang ini tidak mencukupi" };
      }
      const changed = await tx.insert(cartItems).values({
        id: crypto.randomUUID(), cartId: cart.id, variantId, branchId, quantity,
      }).onConflictDoUpdate({
        target: [cartItems.cartId, cartItems.variantId, cartItems.branchId],
        set: {
          quantity: sql`${cartItems.quantity} + ${quantity}`,
          updatedAt: new Date(),
        },
        setWhere: sql`${cartItems.quantity} + ${quantity} <= ${available}`,
      }).returning({ id: cartItems.id });
      return changed.length
        ? { ok: true }
        : { ok: false, status: 400, error: "Stok produk di cabang ini tidak mencukupi" };
    });
    if (!result.ok) {
      log.warn(
        `cart item rejected — ${result.error} (variant ${variantId}, branch ${branchId}, quantity ${quantity})`
      );
      return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    }

    log.info(
      `cart item added: variant ${variantId}, branch ${branchId}, quantity ${quantity}`
    );
    return NextResponse.json({ success: true, message: "Item added to cart" });
  } catch {
    log.error("cart item add failed", new RouteLogError("cart item add failed"));
    return NextResponse.json(
      { success: false, error: "Failed to add to cart" },
      { status: 500 }
    );
  }
}

/** HTTP entry: wrapper menambahkan `x-request-id` kanonik + satu baris completion. */
export const POST = withRequestContext(addCartItem, "cart-items");

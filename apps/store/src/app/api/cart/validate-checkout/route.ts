import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  carts,
  cartItems,
  branches,
  branchStocks,
  productVariants,
  products,
} from "@/db";
import { eq, and, inArray } from "drizzle-orm";
import { requireOnboardedApiSession } from "@/lib/route-access";
import { z } from "zod";
import { requestLogger, withRequestId, serializeError } from "@/lib/logger";

// Pre-checkout validation: verifies that the branch of the selected items is
// still active before the customer is allowed to proceed to /checkout. If the
// branch has been disabled (status !== "aktif") or removed, ALL of that
// branch's items are removed from the customer's cart (only for that customer)
// and the response signals the cart page to show an error popup.
const validateCheckoutSchema = z.object({
  selectedItemIds: z
    .array(z.string())
    .min(1, "Select at least one item to checkout"),
});

export async function POST(request: NextRequest) {
  let log = requestLogger(request, { module: "validate-checkout" });
  log.info("checkout validation requested");
  try {
    const access = await requireOnboardedApiSession();
    if (!access.ok) return withRequestId(access.response, log);
    const { session } = access;

    const body = await request.json();
    const parsed = validateCheckoutSchema.safeParse(body);

    if (!parsed.success) {
      log.warn("invalid request body", { issues: parsed.error.issues });
      return withRequestId(
        NextResponse.json(
          {
            success: false,
            error: "Invalid request body",
            details: parsed.error.issues,
          },
          { status: 400 }
        ),
        log
      );
    }

    const { selectedItemIds } = parsed.data;
    log = log.child({ userId: session.user.id, itemCount: selectedItemIds.length });

    // ===== Load the user's cart =====
    const cartRows = await db
      .select()
      .from(carts)
      .where(eq(carts.userId, session.user.id))
      .limit(1);

    if (cartRows.length === 0) {
      return NextResponse.json(
        { success: false, error: "Cart is empty" },
        { status: 400 }
      );
    }

    const cart = cartRows[0];

    // ===== Load the selected cart items (scoped to this user's cart) =====
    // Joined with variant + product so we can check stock and report the
    // product name back to the cart page. Same join shape as place-order.
    const selectedItems = await db
      .select({
        id: cartItems.id,
        branchId: cartItems.branchId,
        variantId: cartItems.variantId,
        quantity: cartItems.quantity,
        productName: products.name,
      })
      .from(cartItems)
      .innerJoin(productVariants, eq(cartItems.variantId, productVariants.id))
      .innerJoin(products, eq(productVariants.productId, products.id))
      .where(
        and(eq(cartItems.cartId, cart.id), inArray(cartItems.id, selectedItemIds))
      );

    if (selectedItems.length === 0) {
      return NextResponse.json(
        { success: false, error: "No selected items to checkout" },
        { status: 400 }
      );
    }

    // ===== Enforce single-branch checkout (cart page already does this) =====
    const branchIds = new Set(
      selectedItems.map((i) => i.branchId).filter((b): b is string => !!b)
    );
    if (branchIds.size === 0) {
      return NextResponse.json(
        { success: false, error: "Selected items have no branch assigned" },
        { status: 400 }
      );
    }
    if (branchIds.size > 1) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Tidak bisa checkout barang di branch yang berbeda. Pilih barang dari satu cabang saja.",
        },
        { status: 400 }
      );
    }

    const branchId = Array.from(branchIds)[0];

    // ===== Check the branch status =====
    const branch = await db
      .select({
        id: branches.id,
        name: branches.name,
        status: branches.status,
      })
      .from(branches)
      .where(eq(branches.id, branchId))
      .limit(1);

    // Branch removed (hard delete cascades its cart items, but guard anyway) or
    // branch disabled (soft, status !== "aktif") — either way, cannot checkout.
    const branchInactive = branch.length === 0 || branch[0].status !== "aktif";

    if (branchInactive) {
      // Remove ALL of this branch's items from the customer's cart (this
      // customer only — cart items are scoped to the user's cart).
      log.warn("branch inactive — removing its items from cart", {
        branchId,
        branchName: branch[0]?.name ?? null,
      });
      const itemsToRemove = await db
        .select({ id: cartItems.id })
        .from(cartItems)
        .where(
          and(eq(cartItems.cartId, cart.id), eq(cartItems.branchId, branchId))
        );

      await db
        .delete(cartItems)
        .where(
          and(eq(cartItems.cartId, cart.id), eq(cartItems.branchId, branchId))
        );

      // Bump cart.updatedAt so the cart badge/provider reflects the change.
      await db
        .update(carts)
        .set({ updatedAt: new Date() })
        .where(eq(carts.id, cart.id));

      return NextResponse.json({
        success: false,
        code: "BRANCH_INACTIVE",
        branchName: branch[0]?.name ?? null,
        removedItemCount: itemsToRemove.length,
      });
    }

    // ===== Check stock for each selected item (soft UX pre-check) =====
    // Available stock = stock - reservedStock (units held by pending_payment
    // orders). Same calculation as the soft pre-check in place-order. The
    // authoritative race-free guard remains the atomic conditional UPDATE
    // inside the place-order transaction; this pre-check just gives the
    // customer early feedback on the cart page instead of failing at step 3.
    //
    // Two outcomes per item when qty > available:
    //   - available <= 0  → product is fully out of stock → remove it from cart
    //   - 0 < available   → partial stock → lower the cart quantity to available
    const outOfStock: { cartItemId: string; name: string }[] = [];
    const adjusted: { cartItemId: string; name: string; available: number }[] = [];

    for (const item of selectedItems) {
      const stockRow = await db
        .select()
        .from(branchStocks)
        .where(
          and(
            eq(branchStocks.branchId, branchId),
            eq(branchStocks.productVariantId, item.variantId)
          )
        )
        .limit(1);

      const available =
        (stockRow[0]?.stock ?? 0) - (stockRow[0]?.reservedStock ?? 0);

      if (item.quantity > available) {
        if (available <= 0) {
          outOfStock.push({ cartItemId: item.id, name: item.productName });
        } else {
          adjusted.push({
            cartItemId: item.id,
            name: item.productName,
            available,
          });
        }
      }
    }

    if (outOfStock.length > 0 || adjusted.length > 0) {
      // Remove fully out-of-stock items from the cart.
      log.warn("insufficient stock — adjusting cart", {
        outOfStock: outOfStock.length,
        adjusted: adjusted.length,
      });
      if (outOfStock.length > 0) {
        await db
          .delete(cartItems)
          .where(
            and(
              eq(cartItems.cartId, cart.id),
              inArray(
                cartItems.id,
                outOfStock.map((o) => o.cartItemId)
              )
            )
          );
      }

      // Lower the quantity of partially-available items to what's left.
      for (const item of adjusted) {
        await db
          .update(cartItems)
          .set({ quantity: item.available })
          .where(eq(cartItems.id, item.cartItemId));
      }

      // Bump cart.updatedAt so the cart badge/provider reflects the change.
      await db
        .update(carts)
        .set({ updatedAt: new Date() })
        .where(eq(carts.id, cart.id));

      return NextResponse.json({
        success: false,
        code: "INSUFFICIENT_STOCK",
        outOfStock: outOfStock.map(({ name }) => ({ name })),
        adjusted: adjusted.map(({ name, available }) => ({ name, available })),
      });
    }

    // Branch is active and stock is sufficient — ok to proceed to /checkout.
    log.info("checkout validation passed", { branchId });
    return withRequestId(
      NextResponse.json({ success: true }),
      log
    );
  } catch (error) {
    log.error("validate-checkout failed", { error: serializeError(error) });
    return withRequestId(
      NextResponse.json(
        { success: false, error: "Failed to validate checkout" },
        { status: 500 }
      ),
      log
    );
  }
}

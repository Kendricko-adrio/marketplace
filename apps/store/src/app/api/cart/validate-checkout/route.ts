import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { carts, cartItems, branches } from "@/db";
import { eq, and, inArray } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { z } from "zod";

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
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const parsed = validateCheckoutSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid request body",
          details: parsed.error.issues,
        },
        { status: 400 }
      );
    }

    const { selectedItemIds } = parsed.data;

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
    const selectedItems = await db
      .select({
        id: cartItems.id,
        branchId: cartItems.branchId,
      })
      .from(cartItems)
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

    // Branch is active — ok to proceed to /checkout.
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error validating checkout:", error);
    return NextResponse.json(
      { success: false, error: "Failed to validate checkout" },
      { status: 500 }
    );
  }
}
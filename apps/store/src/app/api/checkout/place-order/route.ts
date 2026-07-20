import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  carts,
  cartItems,
  productVariants,
  products,
  branches,
  branchStocks,
  orders,
  orderItems,
} from "@/db";
import { eq, and } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { z } from "zod";
import { validatePickupSlot } from "@/lib/pickup-validation";
import { createPayment } from "@/lib/midtrans";

const placeOrderSchema = z.object({
  phone: z
    .string()
    .min(8, "Phone number is required")
    .max(20, "Phone number is too long"),
  email: z.string().email("Valid email is required"),
  pickupDate: z.string(), // YYYY-MM-DD
  pickupTime: z.string(), // HH:mm
  // Cart item ids the customer chose to checkout in this order.
  selectedItemIds: z.array(z.string()).min(1, "Select at least one item to checkout"),
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
    const parsed = placeOrderSchema.safeParse(body);

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

    const { phone, email, pickupDate, pickupTime, selectedItemIds } =
      parsed.data;

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

    // ===== Load the selected cart items with variant + product + branch =====
    const items = await db
      .select({
        cartItemId: cartItems.id,
        quantity: cartItems.quantity,
        variantId: productVariants.id,
        variantColor: productVariants.color,
        variantSize: productVariants.size,
        variantPrice: productVariants.price,
        productId: products.id,
        productName: products.name,
        branchId: cartItems.branchId,
      })
      .from(cartItems)
      .innerJoin(productVariants, eq(cartItems.variantId, productVariants.id))
      .innerJoin(products, eq(productVariants.productId, products.id))
      .where(eq(cartItems.cartId, cart.id));

    const selectedItems = items.filter((item) =>
      selectedItemIds.includes(item.cartItemId)
    );

    if (selectedItems.length === 0) {
      return NextResponse.json(
        { success: false, error: "No selected items to checkout" },
        { status: 400 }
      );
    }

    // ===== Enforce single-branch checkout =====
    // All selected items must belong to the same branch.
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

    // ===== Load the branch and validate operating hours =====
    const branch = await db
      .select()
      .from(branches)
      .where(eq(branches.id, branchId))
      .limit(1);

    if (branch.length === 0 || branch[0].status !== "aktif") {
      return NextResponse.json(
        { success: false, error: "Branch is no longer available" },
        { status: 400 }
      );
    }

    const slotValidation = validatePickupSlot(
      branch[0].operatingHours,
      pickupDate,
      pickupTime
    );
    if (!slotValidation.ok) {
      return NextResponse.json(
        { success: false, error: slotValidation.error },
        { status: 400 }
      );
    }

    // ===== Re-check stock for each selected item =====
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

      const availableStock = stockRow[0]?.stock ?? 0;
      if (item.quantity > availableStock) {
        return NextResponse.json(
          {
            success: false,
            error: `Insufficient stock for ${item.productName} at this branch`,
          },
          { status: 400 }
        );
      }
    }

    // ===== Calculate totals =====
    let subtotal = 0;
    for (const item of selectedItems) {
      subtotal += parseFloat(item.variantPrice) * item.quantity;
    }
    const serviceFee = 0;
    const total = subtotal;

    // ===== Create the order, order items, call Midtrans, and clear cart — all atomically =====
    const orderId = crypto.randomUUID();

    try {
      const midtransResult = await db.transaction(async (tx) => {
        // ===== Create the order =====
        await tx.insert(orders).values({
          id: orderId,
          userId: session.user.id,
          branchId,
          status: "pending_payment",
          paymentMethod: "qris",
          paymentStatus: "pending",
          pickupDate: new Date(pickupDate + "T00:00:00"),
          pickupTime,
          contactPhone: phone,
          contactEmail: email,
          subtotal: subtotal.toString(),
          shippingCost: "0",
          discount: "0",
          serviceFee: serviceFee.toString(),
          total: total.toString(),
        });

        // ===== Create order items (with real product names) =====
        for (const item of selectedItems) {
          await tx.insert(orderItems).values({
            id: crypto.randomUUID(),
            orderId,
            variantId: item.variantId,
            productName: item.productName,
            variantInfo: `${item.variantColor || ""} ${item.variantSize || ""}`.trim(),
            price: item.variantPrice,
            quantity: item.quantity,
          });
        }

        // ===== Call Midtrans Snap to create the payment =====
        // Any thrown error auto-rollbacks the transaction in Drizzle.
        const paymentResult = await createPayment(
          orderId,
          total,
          {
            first_name: session.user.name || "Customer",
            email,
            phone,
          },
          [
            ...selectedItems.map((item) => ({
              id: item.variantId,
              name: item.productName,
              price: parseFloat(item.variantPrice),
              quantity: item.quantity,
            })),
          ]
        );

        // Persist Snap redirect URL so the customer can resume payment later
        await tx
          .update(orders)
          .set({ snapRedirectUrl: paymentResult.redirectUrl })
          .where(eq(orders.id, orderId));

        return paymentResult;
      });

      // ===== Remove only the checked-out items from the cart AFTER payment creation succeeds =====
      for (const itemId of selectedItemIds) {
        await db
          .delete(cartItems)
          .where(and(eq(cartItems.id, itemId), eq(cartItems.cartId, cart.id)));
      }

      return NextResponse.json({
        success: true,
        orderId,
        redirectUrl: midtransResult.redirectUrl,
        token: midtransResult.token,
      });
    } catch (midtransError) {
      const err = midtransError as {
        message?: string;
        httpStatusCode?: number;
        ApiResponse?: unknown;
      };
      console.error("Midtrans payment creation failed:", {
        message: err.message,
        httpStatusCode: err.httpStatusCode,
        apiResponse: err.ApiResponse,
      });
      // Transaction rolled back — order & cart are preserved. Customer can retry.
      return NextResponse.json(
        {
          success: false,
          error:
            err.message ||
            "Failed to initiate payment. Your cart is preserved — please try again.",
        },
        { status: 502 }
      );
    }
  } catch (error) {
    console.error("Error placing order:", error);
    return NextResponse.json(
      { success: false, error: "Failed to place order" },
      { status: 500 }
    );
  }
}
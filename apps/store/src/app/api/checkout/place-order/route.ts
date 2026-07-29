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
import { eq, and, sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { z } from "zod";
import { validatePickupSlot } from "@/lib/pickup-validation";
import { createPayment } from "@/lib/midtrans";
import { getConfigNumber } from "@/lib/config";
import { requestLogger, withRequestId, serializeError } from "@/lib/logger";

/**
 * Thrown inside the place-order transaction when the atomic stock-reservation
 * UPDATE matches 0 rows (another concurrent checkout took the last units).
 * The catch block translates it into a 400 so the customer can retry; the whole
 * transaction rolls back, releasing any reservations made for earlier items.
 */
class InsufficientStockError extends Error {
  constructor(public productName: string) {
    super(`Insufficient stock for ${productName}`);
    this.name = "InsufficientStockError";
  }
}

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
  let log = requestLogger(request, { module: "place-order" });
  log.info("place order requested");
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session) {
      log.warn("unauthorized — no session");
      return withRequestId(
        NextResponse.json(
          { success: false, error: "Unauthorized" },
          { status: 401 }
        ),
        log
      );
    }

    const body = await request.json();
    const parsed = placeOrderSchema.safeParse(body);

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

    const { phone, email, pickupDate, pickupTime, selectedItemIds } =
      parsed.data;
    log = log.child({
      userId: session.user.id,
      itemCount: selectedItemIds.length,
      pickupDate,
      pickupTime,
    });

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
      log.warn("multi-branch checkout rejected", {
        branchIds: Array.from(branchIds),
      });
      return withRequestId(
        NextResponse.json(
          {
            success: false,
            error:
              "Tidak bisa checkout barang di branch yang berbeda. Pilih barang dari satu cabang saja.",
          },
          { status: 400 }
        ),
        log
      );
    }

    const branchId = Array.from(branchIds)[0];
    log = log.child({ branchId });

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

    // ===== Re-check stock for each selected item (soft check) =====
    // Available stock = stock - reservedStock (units held by pending_payment
    // orders). This is a soft UX pre-check; the authoritative guard is the
    // atomic conditional UPDATE inside the transaction below.
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

      const availableStock =
        (stockRow[0]?.stock ?? 0) - (stockRow[0]?.reservedStock ?? 0);
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

    // ===== Reservation TTL (minutes) from system_config (cached at boot) =====
    const ttlMinutes = await getConfigNumber("reservation.ttlMinutes", 30);

    // ===== Create the order, order items, reserve stock, call Midtrans, and clear cart — all atomically =====
    const orderId = crypto.randomUUID();
    log = log.child({ orderId });
    log.info("creating order", { total, ttlMinutes });

    try {
      const midtransResult = await db.transaction(async (tx) => {
        // ===== Create the order =====
        // expiresAt drives the sweep cron and pairs with the Midtrans expiry
        // so the reservation is released even if the `expire` webhook is missed.
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
          expiresAt: new Date(Date.now() + ttlMinutes * 60_000),
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

        // ===== Atomically reserve stock per item (authoritative guard) =====
        // Conditional UPDATE: only increments reserved_stock if enough is still
        // available (stock - reserved_stock >= qty). 0 rows means another
        // concurrent checkout took the last units → throw to roll back the whole
        // transaction (releasing reservations made for earlier items in this tx).
        // This is race-free without FOR UPDATE: two concurrent checkouts for the
        // last unit produce one match and one miss.
        for (const item of selectedItems) {
          const reserved = await tx
            .update(branchStocks)
            .set({
              reservedStock: sql`${branchStocks.reservedStock} + ${item.quantity}`,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(branchStocks.branchId, branchId),
                eq(branchStocks.productVariantId, item.variantId),
                sql`${branchStocks.stock} - ${branchStocks.reservedStock} >= ${item.quantity}`
              )
            )
            .returning({ branchId: branchStocks.branchId });
          if (reserved.length === 0) {
            throw new InsufficientStockError(item.productName);
          }
        }

        // ===== Call Midtrans Snap to create the payment =====
        // Any thrown error auto-rollbacks the transaction in Drizzle (releasing
        // the reservations above). Expiry is set to the reservation TTL so
        // Midtrans auto-expires the transaction and fires an `expire` webhook.
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
          ],
          ttlMinutes
        );

        // Persist Snap redirect URL so the customer can resume payment later
        await tx
          .update(orders)
          .set({ snapRedirectUrl: paymentResult.redirectUrl })
          .where(eq(orders.id, orderId));

        // ===== Remove only the checked-out items from the cart (inside the tx) =====
        // Kept inside the transaction so a Midtrans/reservation failure rolls
        // cart deletion back too — the customer's cart is preserved on retry.
        for (const itemId of selectedItemIds) {
          await tx
            .delete(cartItems)
            .where(and(eq(cartItems.id, itemId), eq(cartItems.cartId, cart.id)));
        }

        return paymentResult;
      });

      log.info("order placed successfully", {
        redirectUrl: !!midtransResult.redirectUrl,
      });
      return withRequestId(
        NextResponse.json({
          success: true,
          orderId,
          redirectUrl: midtransResult.redirectUrl,
          token: midtransResult.token,
        }),
        log
      );
    } catch (midtransError) {
      // Insufficient stock → 400 (customer can retry / pick fewer units).
      if (midtransError instanceof InsufficientStockError) {
        log.warn("insufficient stock — order rolled back", {
          productName: midtransError.productName,
        });
        return withRequestId(
          NextResponse.json(
            { success: false, error: midtransError.message },
            { status: 400 }
          ),
          log
        );
      }
      const err = midtransError as {
        message?: string;
        httpStatusCode?: number;
        ApiResponse?: unknown;
      };
      log.error("Midtrans payment creation failed — order rolled back", {
        message: err.message,
        httpStatusCode: err.httpStatusCode,
        apiResponse: err.ApiResponse,
      });
      // Transaction rolled back — order, reservation & cart are preserved. Customer can retry.
      return withRequestId(
        NextResponse.json(
          {
            success: false,
            error:
              err.message ||
              "Failed to initiate payment. Your cart is preserved — please try again.",
          },
          { status: 502 }
        ),
        log
      );
    }
  } catch (error) {
    log.error("place order failed", { error: serializeError(error) });
    return withRequestId(
      NextResponse.json(
        { success: false, error: "Failed to place order" },
        { status: 500 }
      ),
      log
    );
  }
}
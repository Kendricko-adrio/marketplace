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
  jubelioStockOperations,
} from "@/db";
import { eq, and, sql } from "drizzle-orm";
import { requireOnboardedApiSession } from "@/lib/route-access";
import { z } from "zod";
import { pickupDateToInstant, validatePickupSlot } from "@/lib/pickup-validation";
import { createPayment, getMockPaymentResult } from "@/lib/midtrans";
import { getConfigNumber } from "@/lib/config";
import { requestLogger, withRequestId, serializeError } from "@/lib/logger";
import { claimAndFailOrder } from "@/lib/order-finalize";
import { initializeReservedOrderPayment } from "@/lib/payment-initialization";
import {
  applyJubelioStockOperation,
  createReserveOperationValues,
  failOrderWithAmbiguousReserve,
} from "@/lib/jubelio-stock-saga";

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
    const access = await requireOnboardedApiSession();
    if (!access.ok) return withRequestId(access.response, log);
    const { session } = access;

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
      log.warn("checkout rejected — cart is empty");
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
        jubelioItemId: productVariants.jubelioItemId,
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
      log.warn("checkout rejected — no selected cart items", { selectedItemIds });
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
      log.warn("checkout rejected — selected items have no branch");
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
      log.warn("checkout rejected — branch unavailable", { branchId });
      return NextResponse.json(
        { success: false, error: "Branch is no longer available" },
        { status: 400 }
      );
    }
    if (branch[0].jubelioLocationId == null) {
      log.warn("checkout rejected — branch is not linked to Jubelio", { branchId });
      return NextResponse.json(
        { success: false, error: "Branch is not linked to Jubelio inventory" },
        { status: 409 }
      );
    }
    const unmappedItem = selectedItems.find((item) => item.jubelioItemId == null);
    if (unmappedItem) {
      log.warn("checkout rejected — product is not linked to Jubelio", {
        variantId: unmappedItem.variantId,
        productName: unmappedItem.productName,
      });
      return NextResponse.json(
        {
          success: false,
          error: `${unmappedItem.productName} is not linked to Jubelio inventory`,
        },
        { status: 409 }
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
    // Confirmed remote reservations are already reflected in Jubelio on-hand
    // (`stock`). Only holds still waiting for remote confirmation are
    // subtracted here. This is a soft UX pre-check; the authoritative guard is the
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
        (stockRow[0]?.stock ?? 0) - (stockRow[0]?.pendingRemoteStock ?? 0);
      if (item.quantity > availableStock) {
        log.warn("checkout rejected — soft stock check failed", {
          variantId: item.variantId,
          requestedQuantity: item.quantity,
          availableStock,
        });
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
    const ttlMinutes = await getConfigNumber("reservation.ttlMinutes", 15);

    // ===== Persist order + reservation atomically, then call Midtrans outside the transaction =====
    const orderId = crypto.randomUUID();
    const stockOperationId = crypto.randomUUID();
    log = log.child({ orderId });
    log.info("creating order", { total, ttlMinutes });

    try {
      await db.transaction(async (tx) => {
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
          pickupDate: pickupDateToInstant(pickupDate),
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

        // ===== Atomically hold stock while Jubelio confirms the adjustment =====
        // Conditional UPDATE: only increments pending_remote_stock if enough is
        // still available (stock - pending_remote_stock >= qty). 0 rows means another
        // concurrent checkout took the last units → throw to roll back the whole
        // transaction (releasing reservations made for earlier items in this tx).
        // This is race-free without FOR UPDATE: two concurrent checkouts for the
        // last unit produce one match and one miss.
        for (const item of selectedItems) {
          const reserved = await tx
            .update(branchStocks)
            .set({
              pendingRemoteStock: sql`${branchStocks.pendingRemoteStock} + ${item.quantity}`,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(branchStocks.branchId, branchId),
                eq(branchStocks.productVariantId, item.variantId),
                sql`${branchStocks.stock} - ${branchStocks.pendingRemoteStock} >= ${item.quantity}`
              )
            )
            .returning({ branchId: branchStocks.branchId });
          if (reserved.length === 0) {
            throw new InsufficientStockError(item.productName);
          }
          log.info("local stock hold created", {
            variantId: item.variantId,
            quantity: item.quantity,
          });
        }

        await tx.insert(jubelioStockOperations).values(
          createReserveOperationValues({
            operationId: stockOperationId,
            orderId,
            locationId: branch[0].jubelioLocationId!,
            items: selectedItems.map((item) => ({
              variantId: item.variantId,
              itemId: item.jubelioItemId!,
              quantity: item.quantity,
              description: item.productName,
            })),
          })
        );

      });

      // Never create a Midtrans transaction until Jubelio confirms that its
      // on-hand stock has been reduced. Provider calls stay outside the DB tx.
      log.info("Jubelio stock reserve dispatched", { operationId: stockOperationId });
      const stockOutcome = await applyJubelioStockOperation(stockOperationId, undefined, log);
      log.info("Jubelio stock reserve completed", {
        operationId: stockOperationId,
        status: stockOutcome.status,
      });
      if (stockOutcome.status !== "applied") {
        if (stockOutcome.status === "reconciling") {
          await failOrderWithAmbiguousReserve(
            orderId,
            "Stock confirmation from Jubelio is still pending",
            log
          );
        }
        const status = stockOutcome.status === "rejected" ? 409 : 503;
        const error =
          stockOutcome.status === "rejected"
            ? "Stock produk berubah atau tidak mencukupi. Silakan periksa keranjang Anda."
            : "Stock sedang dikonfirmasi. Silakan coba kembali beberapa saat lagi.";
        return withRequestId(
          NextResponse.json({ success: false, error }, { status }),
          log
        );
      }

      const initialized = await initializeReservedOrderPayment({
        create: () => {
          const mockRequested =
            process.env.NODE_ENV !== "production" &&
            request.headers.get("x-e2e-payment-mock") === "true";
          const mock = mockRequested
            ? getMockPaymentResult(orderId, {
                MIDTRANS_E2E_MOCK: "true",
                NODE_ENV: "test",
              })
            : null;
          return mock
            ? Promise.resolve(mock)
            : createPayment(
            orderId,
            total,
            {
              first_name: session.user.name || "Customer",
              email,
              phone,
            },
            selectedItems.map((item) => ({
              id: item.variantId,
              name: item.productName,
              price: parseFloat(item.variantPrice),
              quantity: item.quantity,
            })),
            ttlMinutes
          );
        },
        persist: async (paymentResult) => {
          await db.transaction(async (tx) => {
            await tx
              .update(orders)
              .set({
                snapRedirectUrl: paymentResult.redirectUrl,
                updatedAt: new Date(),
              })
              .where(eq(orders.id, orderId));

            for (const itemId of selectedItemIds) {
              await tx
                .delete(cartItems)
                .where(
                  and(eq(cartItems.id, itemId), eq(cartItems.cartId, cart.id))
                );
            }
          });
        },
        compensate: async (error) => {
          await claimAndFailOrder(
            orderId,
            "Payment initialization failed",
            "initialization_error",
            log
          );
          log.error("payment initialization failed; reservation released", {
            error: serializeError(error),
          });
        },
      });

      const midtransResult = initialized.payment;
      if (initialized.persistenceError) {
        log.error("payment created but local metadata needs reconciliation", {
          error: serializeError(initialized.persistenceError),
        });
      }

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
        log.warn("insufficient stock — reservation transaction rolled back", {
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
      log.error("Midtrans payment creation failed", {
        message: err.message,
        httpStatusCode: err.httpStatusCode,
        apiResponse: err.ApiResponse,
      });
      // The compensation path marks the order failed and releases reservation;
      // checked-out cart rows are preserved so the customer can retry.
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

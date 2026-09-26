import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  carts,
  cartItems,
  branches,
  branchStocks,
  orders,
  orderItems,
  productVariants,
  products,
} from "@/db";
import { eq, and, sql } from "drizzle-orm";
import { requireOnboardedApiSession } from "@/lib/route-access";
import { z } from "zod";
import { pickupDateToInstant, validatePickupSlot } from "@/lib/pickup-validation";
import { createPayment, getMockPaymentResult } from "@/lib/midtrans";
import { getConfigNumber, getConfigString, getPpnRatePercent } from "@/lib/config";
import {
  calculateLineItemSubtotal,
  calculateOrderPricing,
} from "@/lib/order-pricing";
import { buildPaymentItemDetails } from "@/lib/payment-item-details";
import { requestLogger, withRequestId, serializeError } from "@/lib/logger";
import { claimAndFailOrder } from "@/lib/order-finalize";
import { initializeReservedOrderPayment } from "@/lib/payment-initialization";
import { verifyCheckoutStock } from "@marketplace/db/src/checkout-live-stock";
import {
  dispatchJubelioSalesCreate,
} from "@/lib/jubelio-sales-lifecycle";
import { recordJubelioSalesIntent } from "@/lib/jubelio-sales-operations";
import type { JubelioSalesOrderCreateRequest } from "@marketplace/db/src/schema";

/**
 * Thrown inside the place-order transaction when the atomic SO-hold UPDATE
 * matches 0 rows (another concurrent checkout took the last sellable unit, or
 * no provider `available` snapshot exists). The catch block translates it
 * into a 400/503 so the customer can retry; the whole transaction rolls back.
 */
class InsufficientStockError extends Error {
  constructor(
    public productName: string,
    public missingSnapshot = false
  ) {
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

/**
 * Emergency pause switch (plan feature 4): when `checkout.paused` is set,
 * NEW checkouts are blocked — never with an adjustment fallback. Fail closed:
 * if the config cannot be read, checkouts stay blocked until it can be.
 */
export async function isCheckoutPaused(): Promise<boolean> {
  try {
    const value = await getConfigString("checkout.paused", "false");
    return value.trim().toLowerCase() === "true";
  } catch {
    return true;
  }
}

export async function POST(request: NextRequest) {
  let log = requestLogger(request, { module: "place-order" });
  log.info("place order requested");
  try {
    const access = await requireOnboardedApiSession();
    if (!access.ok) return withRequestId(access.response, log);
    const { session } = access;

    // Emergency pause: block NEW checkouts only; in-flight orders keep their
    // normal reconciliation paths. Never falls back to the retired adjustment
    // flow.
    if (await isCheckoutPaused()) {
      log.warn("checkout rejected — new checkouts are paused");
      return withRequestId(
        NextResponse.json(
          {
            success: false,
            error:
              "Checkout sedang dijeda sementara. Silakan coba beberapa saat lagi.",
          },
          { status: 503 }
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

    // Read the local mirror first, then verify ALL selected pairs against the
    // provider before creating an SO. A stale/zero local cache is advisory:
    // the provider is the stock source of truth. The atomic hold below still
    // protects against concurrent checkouts on this site.
    const stockCheck = await verifyCheckoutStock(db, selectedItems.map((item) => ({
      branchId,
      variantId: item.variantId,
      itemId: item.jubelioItemId!,
      locationId: branch[0].jubelioLocationId!,
      quantity: item.quantity,
      productName: item.productName,
    })));
    if (!stockCheck.ok) {
      const stockFailure = {
        reason: stockCheck.reason,
        detail: stockCheck.detail,
        productName: stockCheck.productName,
        itemIds: selectedItems.map((item) => item.jubelioItemId),
        locationId: branch[0].jubelioLocationId,
      };
      if (stockCheck.reason === "unavailable") {
        log.error("checkout rejected — Jubelio stock unavailable", stockFailure);
      } else {
        log.warn("checkout rejected — Jubelio stock insufficient", stockFailure);
      }
      return withRequestId(NextResponse.json({
        success: false,
        error: stockCheck.reason === "insufficient"
          ? `Stok ${stockCheck.productName} di cabang ini tidak mencukupi. Silakan kurangi jumlah atau pilih barang lain.`
          : "Stok Jubelio belum dapat diverifikasi. Silakan coba beberapa saat lagi.",
      }, { status: stockCheck.reason === "insufficient" ? 409 : 503 }), log);
    }
    log.info("Jubelio stock verified before Sales Order", { itemCount: selectedItems.length });

    // ===== Calculate totals =====
    const subtotal = calculateLineItemSubtotal(
      selectedItems.map((item) => ({
        price: item.variantPrice,
        quantity: item.quantity,
      }))
    );
    const ppnRatePercent = await getPpnRatePercent();
    const pricing = calculateOrderPricing({
      subtotal,
      discount: 0,
      shippingCost: 0,
      serviceFee: 0,
      ppnRatePercent,
    });
    const total = Number(pricing.total);
    const paymentItemDetails = buildPaymentItemDetails({
      items: selectedItems.map((item) => ({
        id: item.variantId,
        name: item.productName,
        price: item.variantPrice,
        quantity: item.quantity,
      })),
      ...pricing,
    });

    // ===== Reservation TTL (minutes) from system_config (cached at boot) =====
    const ttlMinutes = await getConfigNumber("reservation.ttlMinutes", 15);

    // ===== Persist order + SO hold + create intent atomically, then run the
    // ===== SO create and Midtrans OUTSIDE the transaction =====
    const orderId = crypto.randomUUID();
    // Unique provider-facing create note/reference.
    const createReference = `OKCIR_SO_CREATE:${orderId}:${crypto.randomUUID()}`;
    // Single anchor for both the local hold clock and the Midtrans expiry
    // countdown (`expiry.start_time`) so async methods (VA/GoPay) cannot outlive
    // the reservation TTL.
    const paymentStartedAt = new Date();
    const expiresAt = new Date(paymentStartedAt.getTime() + ttlMinutes * 60_000);
    log = log.child({ orderId });
    log.info("creating order", {
      ppnRatePercent: pricing.ppnRatePercent,
      ppnAmount: pricing.ppnAmount,
      total: pricing.total,
      ttlMinutes,
    });

    const createRequest: JubelioSalesOrderCreateRequest = {
      // The verified generic Jubelio customer contact.
      contactId: -1,
      customerName: session.user.name || "Customer",
      locationId: branch[0].jubelioLocationId!,
      note: createReference,
      refNo: orderId,
      channelStatus: "Belum Bayar",
      items: selectedItems.map((item) => ({
        itemId: item.jubelioItemId!,
        quantity: item.quantity,
        price: Number(item.variantPrice),
        discAmount: 0,
        taxAmount: 0,
        unit: process.env.JUBELIO_ITEM_UNIT?.trim() || "Buah",
        // The provider FK-rejects tax_id 0; the account's "No Tax" record id
        // (sandbox 2026-09-24: 1, rate 0.00) is the safe default.
        taxId: Number(process.env.JUBELIO_ITEM_TAX_ID) || 1,
      })),
    };

    try {
      await db.transaction(async (tx) => {
        // ===== Create the order =====
        await tx.insert(orders).values({
          id: orderId,
          userId: session.user.id,
          branchId,
          status: "pending_payment",
          paymentMethod: null,
          paymentStatus: "pending",
          pickupDate: pickupDateToInstant(pickupDate),
          pickupTime,
          contactPhone: phone,
          contactEmail: email,
          subtotal: pricing.subtotal,
          shippingCost: pricing.shippingCost,
          discount: pricing.discount,
          serviceFee: pricing.serviceFee,
          ppnRate: pricing.ppnRatePercent,
          ppnAmount: pricing.ppnAmount,
          total: pricing.total,
          expiresAt,
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

        // ===== Atomically hold stock BEFORE the SO POST =====
        // Conditional UPDATE: only increments pending_remote_stock if enough
        // sellable stock remains (provider available − holds ≥ qty) and a
        // provider snapshot exists (fail closed). 0 rows means another
        // concurrent checkout took the last units → throw to roll back.
        for (const item of selectedItems) {
          const held = await tx
            .update(branchStocks)
            .set({
              pendingRemoteStock: sql`${branchStocks.pendingRemoteStock} + ${item.quantity}`,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(branchStocks.branchId, branchId),
                eq(branchStocks.productVariantId, item.variantId),
                // Never hold against a snapshot superseded by a concurrent
                // webhook, checkout, or provider refresh.
                eq(branchStocks.providerStockSyncedAt, stockCheck.observedAt),
                sql`COALESCE(${branchStocks.availableStock}, 0) - ${branchStocks.pendingRemoteStock} >= ${item.quantity}`
              )
            )
            .returning({ branchId: branchStocks.branchId });
          if (held.length === 0) {
            const snapshot = await tx
              .select({ availableStock: branchStocks.availableStock, providerStockSyncedAt: branchStocks.providerStockSyncedAt })
              .from(branchStocks)
              .where(
                and(
                  eq(branchStocks.branchId, branchId),
                  eq(branchStocks.productVariantId, item.variantId)
                )
              )
              .limit(1);
            throw new InsufficientStockError(
              item.productName,
              snapshot[0]?.availableStock == null || snapshot[0]?.providerStockSyncedAt?.getTime() !== stockCheck.observedAt.getTime()
            );
          }
          log.info("local SO hold created", {
            variantId: item.variantId,
            quantity: item.quantity,
          });
        }

        // ===== Persist the create intent BEFORE any provider POST =====
        await recordJubelioSalesIntent(tx, {
          orderId,
          type: "create",
          reference: createReference,
          payload: { type: "create", create: createRequest },
        });
      });

      // Provider call stays OUTSIDE the DB transaction: exactly one SO create
      // POST, confirmed via GET before Midtrans is involved.
      log.info("Jubelio sales order create dispatched");
      const createOutcome = await dispatchJubelioSalesCreate({
        orderId,
        create: createRequest,
        logger: log,
      });
      log.info("Jubelio sales order create completed", {
        status: createOutcome.status,
      });

      if (createOutcome.status !== "confirmed") {
        if (createOutcome.status === "rejected") {
          // Definitive pre-apply rejection: release the hold, fail the order.
          await db.transaction(async (tx) => {
            const orderRows = await tx
              .select({ branchId: orders.branchId })
              .from(orders)
              .where(eq(orders.id, orderId))
              .limit(1);
            const orderBranchId = orderRows[0]?.branchId;
            if (orderBranchId) {
              for (const item of selectedItems) {
                await tx
                  .update(branchStocks)
                  .set({
                    pendingRemoteStock: sql`GREATEST(0, ${branchStocks.pendingRemoteStock} - ${item.quantity})`,
                    updatedAt: new Date(),
                  })
                  .where(
                    and(
                      eq(branchStocks.branchId, orderBranchId),
                      eq(branchStocks.productVariantId, item.variantId)
                    )
                  );
              }
            }
            await tx
              .update(orders)
              .set({
                status: "failed_payment",
                paymentStatus: "failed",
                paymentFailureReason: createOutcome.message,
                midtransFailureStatus: "sales_order_rejected",
                updatedAt: new Date(),
              })
              .where(
                and(eq(orders.id, orderId), eq(orders.status, "pending_payment"))
              );
          });
          return withRequestId(
            NextResponse.json(
              {
                success: false,
                error:
                  "Stock produk berubah atau tidak mencukupi. Silakan periksa keranjang Anda.",
              },
              { status: 409 }
            ),
            log
          );
        }
        // manual_review / in_flight: the create may have been applied or is
        // still unknown. Keep the hold, keep the order pending, never retry.
        const message =
          "Pesanan sedang diproses. Tim kami akan mengonfirmasi ketersediaan stok — silakan cek status pesanan atau hubungi kami.";
        return withRequestId(
          NextResponse.json({ success: false, error: message }, { status: 503 }),
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
            paymentItemDetails,
            ttlMinutes,
            paymentStartedAt
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
          log.error("payment initialization failed; sales-order cancel dispatched", {
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
        ppnRatePercent: pricing.ppnRatePercent,
        ppnAmount: pricing.ppnAmount,
        total: pricing.total,
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
    } catch (checkoutError) {
      // Insufficient stock → 400 (customer can retry / pick fewer units).
      if (checkoutError instanceof InsufficientStockError) {
        log.warn("insufficient stock — checkout transaction rolled back", {
          productName: checkoutError.productName,
          missingSnapshot: checkoutError.missingSnapshot,
        });
        return withRequestId(
          NextResponse.json(
            {
              success: false,
              error: checkoutError.missingSnapshot
                ? "Stok berubah saat checkout. Silakan coba lagi."
                : checkoutError.message,
            },
            { status: checkoutError.missingSnapshot ? 503 : 400 }
          ),
          log
        );
      }
      const err = checkoutError as {
        message?: string;
        httpStatusCode?: number;
        ApiResponse?: unknown;
      };
      log.error("Midtrans payment creation failed", {
        message: err.message,
        httpStatusCode: err.httpStatusCode,
        apiResponse: err.ApiResponse,
      });
      // The compensation path marks the order failed and cancels the SO;
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
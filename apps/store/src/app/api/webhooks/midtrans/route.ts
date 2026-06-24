import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  orders,
  orderItems,
  branchStocks,
  branches,
} from "@/db";
import { eq, and, inArray } from "drizzle-orm";
import { verifyMidtransSignature } from "@/lib/midtrans";
import { sendEmail } from "@/lib/email";
import {
  pickupReadyEmailHTML,
  pickupReadyEmailText,
} from "@/lib/email-templates-order";

// 6-char pickup code alphabet (no ambiguous chars: O, I, 0, 1)
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generatePickupCode(): string {
  return Array.from(
    { length: 6 },
    () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]
  ).join("");
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const {
      order_id,
      transaction_status,
      status_code,
      gross_amount,
      signature_key,
      fraud_status,
    } = body;

    if (!order_id || !transaction_status) {
      return NextResponse.json(
        { success: false, error: "Invalid notification" },
        { status: 400 }
      );
    }

    // ===== Signature verification =====
    // Classic Snap: SHA512(order_id + status_code + gross_amount + serverKey)
    if (signature_key) {
      const isValid = verifyMidtransSignature(
        String(order_id),
        String(status_code || "200"),
        String(gross_amount),
        String(signature_key)
      );
      if (!isValid) {
        console.error("Midtrans webhook: invalid signature for order", order_id);
        return NextResponse.json(
          { success: false, error: "Invalid signature" },
          { status: 401 }
        );
      }
    }

    // ===== Load the order =====
    const orderRows = await db
      .select()
      .from(orders)
      .where(eq(orders.id, String(order_id)))
      .limit(1);

    if (orderRows.length === 0) {
      console.error("Midtrans webhook: order not found", order_id);
      return NextResponse.json(
        { success: false, error: "Order not found" },
        { status: 404 }
      );
    }

    const order = orderRows[0];

    // ===== Idempotency: skip if already paid =====
    if (order.paymentStatus === "paid") {
      return NextResponse.json({
        success: true,
        message: "Order already processed",
      });
    }

    // ===== Handle transaction status =====
    const isSuccess =
      transaction_status === "settlement" ||
      (transaction_status === "capture" && fraud_status === "accept");

    const isFailure =
      transaction_status === "deny" ||
      transaction_status === "cancel" ||
      transaction_status === "expire";

    if (isSuccess) {
      // ===== Payment success: deduct stock, generate pickup code, send email =====
      await db.transaction(async (tx) => {
        // 1. Mark as paid + processing
        await tx
          .update(orders)
          .set({
            paymentStatus: "paid",
            status: "processing",
            updatedAt: new Date(),
          })
          .where(eq(orders.id, order.id));

        // 2. Deduct branch stock for each order item
        const items = await tx
          .select()
          .from(orderItems)
          .where(eq(orderItems.orderId, order.id));

        for (const item of items) {
          const stockRow = await tx
            .select()
            .from(branchStocks)
            .where(
              and(
                eq(branchStocks.branchId, order.branchId!),
                eq(branchStocks.productVariantId, item.variantId)
              )
            )
            .limit(1);

          if (stockRow.length > 0) {
            const newStock = Math.max(0, stockRow[0].stock - item.quantity);
            await tx
              .update(branchStocks)
              .set({ stock: newStock, updatedAt: new Date() })
              .where(
                and(
                  eq(branchStocks.branchId, order.branchId!),
                  eq(branchStocks.productVariantId, item.variantId)
                )
              );
          }
        }

        // 3. Generate unique pickup code
        let pickupCode = generatePickupCode();
        // Collision check against active orders
        let attempts = 0;
        while (attempts < 10) {
          const existing = await tx
            .select({ id: orders.id })
            .from(orders)
            .where(
              and(
                eq(orders.pickupCode, pickupCode),
                inArray(orders.status, ["ready_for_pickup", "completed"])
              )
            )
            .limit(1);
          if (existing.length === 0) break;
          pickupCode = generatePickupCode();
          attempts++;
        }

        // 4. Set status to ready_for_pickup with pickup code
        await tx
          .update(orders)
          .set({
            status: "ready_for_pickup",
            pickupCode,
            updatedAt: new Date(),
          })
          .where(eq(orders.id, order.id));
      });

      // ===== Send Email #1 (outside the transaction) =====
      try {
        const [branchData, itemsForEmail] = await Promise.all([
          db
            .select()
            .from(branches)
            .where(eq(branches.id, order.branchId!))
            .limit(1),
          db
            .select({
              productName: orderItems.productName,
              variantInfo: orderItems.variantInfo,
              price: orderItems.price,
              quantity: orderItems.quantity,
            })
            .from(orderItems)
            .where(eq(orderItems.orderId, order.id)),
        ]);

        const updatedOrder = await db
          .select()
          .from(orders)
          .where(eq(orders.id, order.id))
          .limit(1);

        if (branchData.length > 0 && updatedOrder[0].pickupCode) {
          const html = pickupReadyEmailHTML({
            order: {
              id: order.id,
              total: order.total,
              subtotal: order.subtotal,
              serviceFee: order.serviceFee,
              pickupDate: order.pickupDate,
              pickupTime: order.pickupTime,
            },
            pickupCode: updatedOrder[0].pickupCode,
            branch: {
              name: branchData[0].name,
              address: branchData[0].address,
              city: branchData[0].city,
              operatingHours: branchData[0].operatingHours,
            },
            items: itemsForEmail,
          });

          const text = pickupReadyEmailText({
            order: {
              id: order.id,
              total: order.total,
              subtotal: order.subtotal,
              serviceFee: order.serviceFee,
              pickupDate: order.pickupDate,
              pickupTime: order.pickupTime,
            },
            pickupCode: updatedOrder[0].pickupCode,
            branch: {
              name: branchData[0].name,
              address: branchData[0].address,
              city: branchData[0].city,
              operatingHours: branchData[0].operatingHours,
            },
            items: itemsForEmail,
          });

          await sendEmail({
            to: order.contactEmail,
            subject: `Your Order is Ready for Pickup — #${order.id.slice(0, 8).toUpperCase()}`,
            html,
            text,
          });
        }
      } catch (emailError) {
        // Log but don't fail the webhook — Midtrans needs a 200 response
        console.error(
          "Midtrans webhook: failed to send pickup-ready email:",
          emailError
        );
      }

      console.log(
        `Midtrans webhook: order ${order_id} paid → ready_for_pickup`
      );
    } else if (isFailure) {
      // ===== Payment failure: cancel order, restore stock =====
      await db.transaction(async (tx) => {
        await tx
          .update(orders)
          .set({
            paymentStatus: "failed",
            status: "cancelled",
            updatedAt: new Date(),
          })
          .where(eq(orders.id, order.id));

        // Restore stock (only if it was deducted — but since we deduct on
        // success, and this is a failure, there's nothing to restore unless
        // the order was previously paid and is now being reversed. For safety,
        // we only restore if the order was previously "paid").
        if (order.paymentStatus === "paid") {
          const items = await tx
            .select()
            .from(orderItems)
            .where(eq(orderItems.orderId, order.id));

          for (const item of items) {
            const stockRow = await tx
              .select()
              .from(branchStocks)
              .where(
                and(
                  eq(branchStocks.branchId, order.branchId!),
                  eq(branchStocks.productVariantId, item.variantId)
                )
              )
              .limit(1);

            if (stockRow.length > 0) {
              await tx
                .update(branchStocks)
                .set({
                  stock: stockRow[0].stock + item.quantity,
                  updatedAt: new Date(),
                })
                .where(
                  and(
                    eq(branchStocks.branchId, order.branchId!),
                    eq(branchStocks.productVariantId, item.variantId)
                  )
                );
            }
          }
        }
      });

      console.log(`Midtrans webhook: order ${order_id} cancelled`);
    }
    // transaction_status === "pending" → do nothing, order stays pending_payment

    // Always return 200 to Midtrans (prevents retries)
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Midtrans webhook error:", error);
    // Still return 200 to prevent Midtrans from retrying excessively
    return NextResponse.json({ success: true });
  }
}
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { orders, orderItems, addresses, auditLogs } from "@/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { withAuth } from "@/lib/auth-guard";

export const GET = withAuth(async (
  _ctx,
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  try {
    const { id } = await params;

    const order = await db
      .select()
      .from(orders)
      .where(eq(orders.id, id))
      .limit(1);

    if (order.length === 0) {
      return NextResponse.json(
        { success: false, error: "Order not found" },
        { status: 404 }
      );
    }

    const items = await db
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, id));

    let address = null;
    if (order[0].addressId) {
      const addressResult = await db
        .select()
        .from(addresses)
        .where(eq(addresses.id, order[0].addressId))
        .limit(1);
      address = addressResult[0] || null;
    }

    return NextResponse.json({
      success: true,
      data: {
        ...order[0],
        items,
        address,
      },
    });
  } catch (error) {
    console.error("Error fetching order:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch order" },
      { status: 500 }
    );
  }
}, ["admin", "staff"]);

const updateOrderSchema = z.object({
  status: z.enum(["proses", "dikirim", "selesai", "batal"]).optional(),
  trackingNumber: z.string().optional(),
});

export const PUT = withAuth(async (
  { user },
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  try {
    const { id } = await params;
    const body = await request.json();
    const parsed = updateOrderSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid request body" },
        { status: 400 }
      );
    }

    // Get current order
    const currentOrder = await db
      .select()
      .from(orders)
      .where(eq(orders.id, id))
      .limit(1);

    if (currentOrder.length === 0) {
      return NextResponse.json(
        { success: false, error: "Order not found" },
        { status: 404 }
      );
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    const changes: Record<string, { from: unknown; to: unknown }> = {};

    if (parsed.data.status) {
      changes.status = { from: currentOrder[0].status, to: parsed.data.status };
      updates.status = parsed.data.status;
    }

    if (parsed.data.trackingNumber) {
      changes.trackingNumber = {
        from: currentOrder[0].trackingNumber,
        to: parsed.data.trackingNumber,
      };
      updates.trackingNumber = parsed.data.trackingNumber;
    }

    await db.update(orders).set(updates).where(eq(orders.id, id));

    // Create audit log
    await db.insert(auditLogs).values({
      id: crypto.randomUUID(),
      userId: user.id,
      action: "UPDATE_ORDER_STATUS",
      entityType: "order",
      entityId: id,
      changes,
    });

    return NextResponse.json({
      success: true,
      message: "Order updated",
    });
  } catch (error) {
    console.error("Error updating order:", error);
    return NextResponse.json(
      { success: false, error: "Failed to update order" },
      { status: 500 }
    );
  }
}, ["admin", "staff"]);

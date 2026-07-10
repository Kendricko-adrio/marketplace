import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { orders, auditLogs } from "@/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import crypto from "crypto";
import { withPermission, getBranchScope } from "@/lib/auth-guard";

const verifyPickupSchema = z.object({
  pickupCodeInput: z.string().min(1).max(10),
});

export const POST = withPermission(async (
  { user },
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  try {
    const { id } = await params;
    const body = await request.json();
    const parsed = verifyPickupSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid input" },
        { status: 400 }
      );
    }

    const { pickupCodeInput } = parsed.data;
    const scope = getBranchScope(user);

    // Only branch admins can verify pickup codes (HQ is read-only per spec)
    if (scope.mode !== "own") {
      return NextResponse.json(
        { success: false, error: "Only branch admins can verify pickup codes" },
        { status: 403 }
      );
    }

    // Load the order
    const orderRows = await db
      .select()
      .from(orders)
      .where(eq(orders.id, id))
      .limit(1);

    if (orderRows.length === 0) {
      return NextResponse.json(
        { success: false, error: "Order not found" },
        { status: 404 }
      );
    }

    const order = orderRows[0];

    // RBAC: must be this branch's order
    if (order.branchId !== scope.branchId) {
      return NextResponse.json(
        { success: false, error: "Forbidden — order belongs to a different branch" },
        { status: 403 }
      );
    }

    // Order must be ready_for_pickup
    if (order.status !== "ready_for_pickup") {
      return NextResponse.json(
        {
          success: false,
          error: `Order must be ready_for_pickup (current: ${order.status})`,
        },
        { status: 400 }
      );
    }

    // Constant-time comparison to avoid timing attacks
    const expected = order.pickupCode || "";
    const input = pickupCodeInput.toUpperCase().trim();
    const isMatch =
      expected.length > 0 &&
      input.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(input), Buffer.from(expected));

    if (!isMatch) {
      return NextResponse.json(
        { success: false, error: "Invalid pickup code. Please verify with the customer." },
        { status: 409 }
      );
    }

    // ===== Code matches → call the store's internal order-complete endpoint =====
    const storeUrl =
      process.env.STORE_INTERNAL_URL ||
      "http://localhost:3000";

    if (!process.env.STORE_INTERNAL_URL) {
      console.warn(
        "STORE_INTERNAL_URL is not set; falling back to http://localhost:3000"
      );
    }

    const secret = crypto
      .createHmac("sha256", process.env.BETTER_AUTH_SECRET || "")
      .update(id)
      .digest("hex");

    const completeRes = await fetch(
      `${storeUrl}/api/internal/order-complete`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: id, secret }),
      }
    );

    if (!completeRes.ok) {
      const errData = await completeRes.json().catch(() => ({}));
      console.error("order-complete call failed:", errData);
      return NextResponse.json(
        {
          success: false,
          error: "Failed to complete order. Please try again.",
        },
        { status: 502 }
      );
    }

    // Write an audit log
    await db.insert(auditLogs).values({
      id: crypto.randomUUID(),
      userId: user.id,
      action: "VERIFY_PICKUP_CODE",
      entityType: "order",
      entityId: id,
      changes: { status: { from: "ready_for_pickup", to: "completed" } },
      ipAddress: null,
    });

    return NextResponse.json({
      success: true,
      message: "Order completed successfully",
    });
  } catch (error) {
    console.error("Error verifying pickup code:", error);
    return NextResponse.json(
      { success: false, error: "Failed to verify pickup code" },
      { status: 500 }
    );
  }
}, "orders", "edit");
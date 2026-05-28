import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  orders,
  orderItems,
  carts,
  cartItems,
  productVariants,
  productImages,
  vouchers,
  addresses,
} from "@/db/schema";
import { eq, and, asc, desc } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { z } from "zod";

const createOrderSchema = z.object({
  shippingAddress: z.object({
    recipientName: z.string().min(1),
    phone: z.string().min(1),
    address: z.string().min(1),
    city: z.string().min(1),
    district: z.string(),
    postalCode: z.string(),
  }),
  shippingMethod: z.string().min(1),
  shippingCost: z.number(),
  voucherCode: z.string().optional(),
  paymentMethod: z.enum(["qris", "va"]),
});

export async function GET() {
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

    const userOrders = await db
      .select()
      .from(orders)
      .where(eq(orders.userId, session.user.id))
      .orderBy(desc(orders.createdAt));

    // Get items for each order (with productId and first image)
    const ordersWithItems = await Promise.all(
      userOrders.map(async (order) => {
        const items = await db
          .select({
            id: orderItems.id,
            orderId: orderItems.orderId,
            variantId: orderItems.variantId,
            productName: orderItems.productName,
            variantInfo: orderItems.variantInfo,
            price: orderItems.price,
            quantity: orderItems.quantity,
            createdAt: orderItems.createdAt,
            productId: productVariants.productId,
          })
          .from(orderItems)
          .innerJoin(
            productVariants,
            eq(orderItems.variantId, productVariants.id)
          )
          .where(eq(orderItems.orderId, order.id));

        const itemsWithImages = await Promise.all(
          items.map(async (item) => {
            const images = await db
              .select({ url: productImages.url })
              .from(productImages)
              .where(eq(productImages.variantId, item.variantId))
              .orderBy(asc(productImages.displayOrder))
              .limit(1);

            return {
              ...item,
              imageUrl: images[0]?.url ?? null,
            };
          })
        );

        return {
          ...order,
          items: itemsWithImages,
        };
      })
    );

    return NextResponse.json({
      success: true,
      data: ordersWithItems,
    });
  } catch (error) {
    console.error("Error fetching orders:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch orders" },
      { status: 500 }
    );
  }
}

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
    const parsed = createOrderSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid request body" },
        { status: 400 }
      );
    }

    const {
      shippingAddress,
      shippingMethod,
      shippingCost,
      voucherCode,
      paymentMethod,
    } = parsed.data;

    // Create address record from inline checkout form
    const nameParts = shippingAddress.recipientName.split(" ");
    const firstName = nameParts[0] || "";
    const lastName = nameParts.slice(1).join(" ") || "";

    const addressId = crypto.randomUUID();
    await db.insert(addresses).values({
      id: addressId,
      userId: session.user.id,
      firstName,
      lastName,
      phone: shippingAddress.phone,
      fullAddress: shippingAddress.address,
      city: shippingAddress.city,
      district: shippingAddress.district || "",
      postalCode: shippingAddress.postalCode || "",
      isDefault: false,
    });

    // Get user's cart
    const cart = await db
      .select()
      .from(carts)
      .where(eq(carts.userId, session.user.id))
      .limit(1);

    if (cart.length === 0) {
      return NextResponse.json(
        { success: false, error: "Cart is empty" },
        { status: 400 }
      );
    }

    // Get cart items
    const items = await db
      .select()
      .from(cartItems)
      .innerJoin(productVariants, eq(cartItems.variantId, productVariants.id))
      .where(eq(cartItems.cartId, cart[0].id));

    if (items.length === 0) {
      return NextResponse.json(
        { success: false, error: "Cart is empty" },
        { status: 400 }
      );
    }

    // Calculate subtotal
    let subtotal = 0;
    for (const item of items) {
      subtotal +=
        parseFloat(item.product_variant.price) * item.cart_item.quantity;
    }

    // Apply voucher discount
    let discount = 0;
    let voucherId = null;

    if (voucherCode) {
      const voucher = await db
        .select()
        .from(vouchers)
        .where(and(eq(vouchers.code, voucherCode), eq(vouchers.isActive, true)))
        .limit(1);

      if (voucher.length > 0 && voucher[0].used < voucher[0].quota) {
        const v = voucher[0];
        voucherId = v.id;

        if (subtotal >= parseFloat(v.minPurchase)) {
          if (v.discountType === "percentage") {
            discount = subtotal * (parseFloat(v.value) / 100);
            if (v.maxDiscount) {
              discount = Math.min(discount, parseFloat(v.maxDiscount));
            }
          } else if (v.discountType === "fixed") {
            discount = parseFloat(v.value);
          } else if (v.discountType === "shipping") {
            discount = Math.min(parseFloat(v.value), shippingCost);
          }
        }

        // Increment voucher usage
        await db
          .update(vouchers)
          .set({ used: v.used + 1 })
          .where(eq(vouchers.id, v.id));
      }
    }

    const serviceFee = 1000;
    const total = subtotal + shippingCost + serviceFee - discount;

    // Create order
    const orderId = crypto.randomUUID();
    await db.insert(orders).values({
      id: orderId,
      userId: session.user.id,
      addressId,
      voucherId,
      status: "proses",
      paymentMethod,
      paymentStatus: "pending",
      subtotal: subtotal.toString(),
      shippingCost: shippingCost.toString(),
      discount: discount.toString(),
      serviceFee: serviceFee.toString(),
      total: total.toString(),
      shippingCarrier: shippingMethod,
    });

    // Create order items
    for (const item of items) {
      await db.insert(orderItems).values({
        id: crypto.randomUUID(),
        orderId,
        variantId: item.product_variant.id,
        productName: "Product", // In real app, join with products table
        variantInfo: `${item.product_variant.color || ""} ${
          item.product_variant.size || ""
        }`.trim(),
        price: item.product_variant.price,
        quantity: item.cart_item.quantity,
      });

      // Reduce stock
      await db
        .update(productVariants)
        .set({
          stock: item.product_variant.stock - item.cart_item.quantity,
          updatedAt: new Date(),
        })
        .where(eq(productVariants.id, item.product_variant.id));
    }

    // Clear cart
    await db.delete(cartItems).where(eq(cartItems.cartId, cart[0].id));

    return NextResponse.json({
      success: true,
      data: {
        orderId,
        total,
        paymentMethod,
      },
    });
  } catch (error) {
    console.error("Error creating order:", error);
    return NextResponse.json(
      { success: false, error: "Failed to create order" },
      { status: 500 }
    );
  }
}

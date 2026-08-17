import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { vouchers } from "@/db";
import { eq, and, gt, lt } from "drizzle-orm";
import { computeVoucherDiscount } from "@/lib/vouchers";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { code, subtotal } = body;

    if (!code) {
      return NextResponse.json(
        { success: false, error: "Voucher code is required" },
        { status: 400 }
      );
    }

    const voucher = await db
      .select()
      .from(vouchers)
      .where(
        and(
          eq(vouchers.code, code.toUpperCase()),
          eq(vouchers.isActive, true),
          lt(vouchers.validFrom, new Date()),
          gt(vouchers.validUntil, new Date())
        )
      )
      .limit(1);

    if (voucher.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: "Voucher tidak ditemukan atau sudah tidak berlaku",
        },
        { status: 404 }
      );
    }

    const v = voucher[0];

    // Check quota
    if (v.used >= v.quota) {
      return NextResponse.json(
        { success: false, error: "Kuota voucher sudah habis" },
        { status: 400 }
      );
    }

    // Check minimum purchase
    if (subtotal && subtotal < parseFloat(v.minPurchase)) {
      return NextResponse.json(
        {
          success: false,
          error: `Minimum belanja Rp ${parseInt(v.minPurchase).toLocaleString(
            "id-ID"
          )}`,
        },
        { status: 400 }
      );
    }

    // Calculate discount
    let discount = 0;
    if (subtotal) {
      discount = computeVoucherDiscount(
        v.discountType,
        v.value,
        subtotal,
        v.maxDiscount
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        code: v.code,
        discountType: v.discountType,
        value: v.value,
        maxDiscount: v.maxDiscount,
        minPurchase: v.minPurchase,
        discount,
        validUntil: v.validUntil,
        remainingQuota: v.quota - v.used,
      },
    });
  } catch (error) {
    console.error("Error validating voucher:", error);
    return NextResponse.json(
      { success: false, error: "Failed to validate voucher" },
      { status: 500 }
    );
  }
}

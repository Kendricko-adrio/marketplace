import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const paymentSchema = z.object({
  orderId: z.string(),
  method: z.enum(["qris", "va"]),
  bank: z.string().optional(), // For VA: bca, mandiri, bni, bri
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = paymentSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid request body" },
        { status: 400 }
      );
    }

    const { orderId, method, bank } = parsed.data;

    // Mock payment response
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
    const transactionId = `TXN${Date.now()}`;

    if (method === "qris") {
      return NextResponse.json({
        success: true,
        data: {
          transactionId,
          orderId,
          method: "qris",
          qrisUrl: `https://api.qris.id/mock/${transactionId}`,
          qrisString: `00020101021226660014ID.CO.MOCKPAY.WWW011893600914${transactionId}0215${orderId}5303360540${Math.floor(
            Math.random() * 1000000
          )}5802ID5913TOKO MOCK6007JAKARTA61052710062070703${transactionId}6304`,
          expiresAt: expiresAt.toISOString(),
          status: "pending",
        },
      });
    } else {
      // VA payment
      const bankCodes: Record<string, string> = {
        bca: "888",
        mandiri: "777",
        bni: "666",
        bri: "555",
      };
      const bankCode = bankCodes[bank || "bca"] || "888";
      const vaNumber = `${bankCode}01${Date.now().toString().slice(-10)}`;

      return NextResponse.json({
        success: true,
        data: {
          transactionId,
          orderId,
          method: "va",
          bank: bank || "bca",
          vaNumber,
          expiresAt: expiresAt.toISOString(),
          status: "pending",
          instructions: [
            `1. Buka aplikasi mobile banking ${(bank || "bca").toUpperCase()}`,
            "2. Pilih menu Transfer > Virtual Account",
            `3. Masukkan nomor VA: ${vaNumber}`,
            "4. Konfirmasi nominal dan detail pembayaran",
            "5. Masukkan PIN untuk konfirmasi",
          ],
        },
      });
    }
  } catch (error) {
    console.error("Error creating payment:", error);
    return NextResponse.json(
      { success: false, error: "Failed to create payment" },
      { status: 500 }
    );
  }
}

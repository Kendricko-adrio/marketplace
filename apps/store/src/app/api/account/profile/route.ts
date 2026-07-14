import { NextResponse, type NextRequest } from "next/server";
import { headers } from "next/headers";
import { db, clients } from "@/db";
import { auth } from "@/lib/auth";
import { eq } from "drizzle-orm";
import { z } from "zod";

const phoneRegex = /^\+62\d{8,13}$/;

const updateProfileSchema = z.object({
  name: z.string().min(1, "Nama wajib diisi").max(100).optional(),
  phone: z
    .string()
    .regex(phoneRegex, "Format nomor telepon tidak valid (contoh: +628123456789).")
    .optional(),
});

export async function PATCH(request: NextRequest) {
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

    const body = await request.json().catch(() => null);
    const parsed = updateProfileSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: parsed.error.issues[0]?.message ?? "Data tidak valid",
        },
        { status: 400 }
      );
    }

    const updates: Partial<typeof clients.$inferInsert> = {};
    if (parsed.data.name !== undefined && parsed.data.name !== session.user.name) {
      updates.name = parsed.data.name;
    }
    if (parsed.data.phone !== undefined) {
      updates.phone = parsed.data.phone;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { success: false, error: "Tidak ada perubahan untuk disimpan." },
        { status: 400 }
      );
    }

    updates.updatedAt = new Date();

    await db
      .update(clients)
      .set(updates)
      .where(eq(clients.id, session.user.id));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error updating profile:", error);
    return NextResponse.json(
      { success: false, error: "Gagal memperbarui profil" },
      { status: 500 }
    );
  }
}
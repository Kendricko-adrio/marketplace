import { NextResponse, type NextRequest } from "next/server";
import { db, clients } from "@/db";
import { requireOnboardedApiSession } from "@/lib/route-access";
import { createModuleLogger, withRequestContext } from "@/lib/logger";
import { eq } from "drizzle-orm";
import { z } from "zod";

/**
 * Module logger untuk route ini: dibuat sekali di module scope, sedangkan
 * `requestId` dibaca dari scope HTTP yang aktif setiap kali log ditulis.
 */
const log = createModuleLogger("store-account-profile");

/**
 * Proyeksi teknis statis untuk jalur kegagalan tak terduga. Nilai yang
 * tertangkap (kemungkinan memuat SQL/nilai PII) tidak pernah masuk log; kontrak
 * HTTP tetap sama.
 */
class ProfileUpdateLogError extends Error {
  constructor() {
    super("account profile: gagal memperbarui profil");
    this.name = "ProfileUpdateLogError";
  }
}

const phoneRegex = /^\+62\d{8,13}$/;

const updateProfileSchema = z.object({
  name: z.string().min(1, "Nama wajib diisi").max(100).optional(),
  phone: z
    .string()
    .regex(phoneRegex, "Format nomor telepon tidak valid (contoh: +628123456789).")
    .optional(),
});

async function updateProfile(request: NextRequest) {
  try {
    const access = await requireOnboardedApiSession();
    if (!access.ok) return access.response;
    const { session } = access;

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
  } catch {
    log.error(
      "account profile update gagal (outcome error)",
      new ProfileUpdateLogError()
    );
    return NextResponse.json(
      { success: false, error: "Gagal memperbarui profil" },
      { status: 500 }
    );
  }
}

export const PATCH = withRequestContext(updateProfile, "store-account-profile");

"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db, clients } from "@/db";
import { auth } from "@/lib/auth";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { cookies } from "next/headers";

const phoneRegex = /^\+?[1-9]\d{6,14}$/;

const onboardingSchema = z.object({
  phone: z
    .string()
    .min(1, "Nomor telepon wajib diisi")
    .regex(phoneRegex, "Format nomor telepon tidak valid (contoh: +628123456789)"),
  birthDate: z.string().refine((val) => {
    if (!val) return false;
    const date = new Date(val);
    if (Number.isNaN(date.getTime())) return false;
    const age = (Date.now() - date.getTime()) / (1000 * 60 * 60 * 24 * 365.25);
    return age >= 13;
  }, "Anda harus berusia minimal 13 tahun"),
  gender: z.enum(["male", "female", "other"], {
    error: "Pilih jenis kelamin",
  }),
});

export type OnboardingState = {
  errors?: {
    phone?: string[];
    birthDate?: string[];
    gender?: string[];
  };
  message?: string;
  success?: boolean;
};

export async function completeOnboarding(
  _prevState: OnboardingState | undefined,
  formData: FormData
): Promise<OnboardingState> {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    redirect("/login?callbackUrl=/onboarding");
  }

  const raw = {
    phone: String(formData.get("phone") || "").trim(),
    birthDate: String(formData.get("birthDate") || "").trim(),
    gender: String(formData.get("gender") || "").trim(),
  };

  const parsed = onboardingSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      errors: parsed.error.flatten().fieldErrors,
      message: "Mohon periksa kembali data yang Anda masukkan.",
    };
  }

  const { phone, birthDate, gender } = parsed.data;

  try {
    await db
      .update(clients)
      .set({
        phone,
        birthDate,
        gender,
        onboardingCompleted: true,
        updatedAt: new Date(),
      })
      .where(eq(clients.id, session.user.id));

    // Set a lightweight cookie so the edge middleware can gate without a DB hit.
    // Not httpOnly so the client can clear it on logout (contains no sensitive data).
    const cookieStore = await cookies();
    cookieStore.set("client.onboarding", "1", {
      httpOnly: false,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 7, // match session lifetime
    });
  } catch (err) {
    console.error("Onboarding update error:", err);
    return {
      message: "Terjadi kesalahan saat menyimpan data Anda. Silakan coba lagi.",
    };
  }

  redirect("/");
}
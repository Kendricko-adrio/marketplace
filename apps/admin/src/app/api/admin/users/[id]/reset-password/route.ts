import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users, adminAccounts, adminSessions } from "@/db";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { withPermission } from "@/lib/auth-guard";

const PASSWORD_CHARS =
  "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%^&*";

function generatePassword(length = 16): string {
  const arr = new Uint32Array(length);
  crypto.getRandomValues(arr);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += PASSWORD_CHARS[arr[i] % PASSWORD_CHARS.length];
  }
  return out;
}

const resetPasswordSchema = z.object({
  passwordMode: z.enum(["manual", "generate"]),
  password: z.string().min(8, "Password minimal 8 karakter").optional(),
});

// POST /api/admin/users/:id/reset-password
// HQ resets a user's password. Returns the new plaintext password ONCE.
export const POST = withPermission(
  async (_ctx, request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    try {
      const { id } = await params;

      const target = await db
        .select({ id: users.id, name: users.name, role: users.role })
        .from(users)
        .where(eq(users.id, id))
        .limit(1);
      if (!target.length) {
        return NextResponse.json(
          { success: false, error: "User not found" },
          { status: 404 }
        );
      }

      const body = await request.json();
      const parsed = resetPasswordSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          {
            success: false,
            error: "Invalid request body",
            details: parsed.error.flatten().fieldErrors,
          },
          { status: 400 }
        );
      }

      const { passwordMode, password } = parsed.data;
      const finalPassword =
        passwordMode === "manual" ? password : generatePassword(16);

      if (!finalPassword || finalPassword.length < 8) {
        return NextResponse.json(
          { success: false, error: "Password minimal 8 karakter." },
          { status: 400 }
        );
      }

      const hashedPassword = await bcrypt.hash(finalPassword, 10);

      // Update the credential account password
      const account = await db
        .select({ id: adminAccounts.id })
        .from(adminAccounts)
        .where(
          and(
            eq(adminAccounts.userId, id),
            eq(adminAccounts.providerId, "credential")
          )
        )
        .limit(1);

      if (account.length) {
        await db
          .update(adminAccounts)
          .set({ password: hashedPassword, updatedAt: new Date() })
          .where(eq(adminAccounts.id, account[0].id));
      } else {
        // No credential account yet — create one
        await db.insert(adminAccounts).values({
          id: crypto.randomUUID(),
          userId: id,
          accountId: id,
          providerId: "credential",
          password: hashedPassword,
        });
      }

      // Force the user to reset their password on next login
      await db
        .update(users)
        .set({ mustResetPassword: true, updatedAt: new Date() })
        .where(eq(users.id, id));

      // Revoke all existing sessions for this user so the old password
      // can no longer be used on any device.
      await db.delete(adminSessions).where(eq(adminSessions.userId, id));

      return NextResponse.json({
        success: true,
        data: {
          // Plaintext returned ONCE. Only the bcrypt hash is persisted.
          password: finalPassword,
          mustResetPassword: true,
        },
      });
    } catch (error) {
      console.error("Error resetting admin user password:", error);
      return NextResponse.json(
        { success: false, error: "Failed to reset password" },
        { status: 500 }
      );
    }
  },
  "users",
  "edit"
);
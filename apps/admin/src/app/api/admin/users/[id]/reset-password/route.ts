import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users, adminAccounts, adminSessions } from "@/db";
import { eq, and } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { withPermission } from "@/lib/auth-guard";
import { resetPasswordSchema } from "@/lib/reset-password-contract";
import { requestLogger, serializeError, withRequestId } from "@/lib/logger";

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

// POST /api/admin/users/:id/reset-password
// HQ resets a user's password. Returns the new plaintext password ONCE.
export const POST = withPermission(
  async (ctx, request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const log = requestLogger(request, {
      module: "admin-reset-password",
      actorId: ctx.user.id,
      targetUserId: id,
    });
    const respond = (body: unknown, status = 200) =>
      withRequestId(NextResponse.json(body, { status }), log);

    try {

      const target = await db
        .select({ id: users.id, name: users.name, role: users.role })
        .from(users)
        .where(eq(users.id, id))
        .limit(1);
      if (!target.length) {
        log.warn("password reset target not found");
        return respond({ success: false, error: "User not found" }, 404);
      }

      const body = await request.json().catch(() => undefined);
      const parsed = resetPasswordSchema.safeParse(body);
      if (!parsed.success) {
        const details = parsed.error.flatten().fieldErrors;
        log.warn("invalid password reset request", {
          validationFields: Object.keys(details),
        });
        return respond(
          { success: false, error: "Invalid request body", details },
          400
        );
      }

      const { passwordMode } = parsed.data;
      const finalPassword =
        passwordMode === "manual" ? parsed.data.password : generatePassword(16);

      if (!finalPassword || finalPassword.length < 8) {
        log.warn("invalid password reset request", {
          validationFields: ["password"],
        });
        return respond(
          { success: false, error: "Password minimal 8 karakter." },
          400
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

      log.info("admin user password reset successfully", { passwordMode });
      return respond({
        success: true,
        data: {
          // Plaintext returned ONCE. Only the bcrypt hash is persisted.
          password: finalPassword,
          mustResetPassword: true,
        },
      });
    } catch (error) {
      log.error("admin user password reset failed", {
        error: serializeError(error),
      });
      return respond(
        { success: false, error: "Failed to reset password" },
        500
      );
    }
  },
  "users",
  "edit"
);
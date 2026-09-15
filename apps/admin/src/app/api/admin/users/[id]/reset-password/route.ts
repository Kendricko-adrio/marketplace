import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import bcrypt from "bcryptjs";

import { db } from "@/db";
import { users, adminAccounts } from "@/db";
import { guard } from "@/lib/rbac/guard";
import { revokeUserSessions } from "@/lib/rbac/users-service";
import { resetPasswordSchema } from "@/lib/reset-password-contract";
import { serializeError, withRequestId } from "@/lib/logger";

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
// Resets a user's password. Returns the new plaintext password ONCE.
// [users:edit]
//
// Deactivated users are rejected (409 USER_NOT_ACTIVE): a deactivated user
// cannot sign in, its sessions were already revoked at deactivation, and a
// password reset would silently grant a working credential to an account
// that is not allowed to use it.
//
// Session revocation goes through the centralized `revokeUserSessions`
// seam (users-service) so every revocation path behaves identically.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guardResult = await guard("users", "edit", { request });
  if (!guardResult.ok) return guardResult.response;
  const log = guardResult.logger;
  const actorId = guardResult.ctx.user.id;

  const { id } = await params;
  const respond = (body: unknown, status = 200) =>
    withRequestId(NextResponse.json(body, { status }), log);

  try {
    // Select the RBAC fields only — the legacy `role` column is not an
    // authorization input and is dropped in the slice-9 cutover.
    const target = await db
      .select({ id: users.id, name: users.name, isActive: users.isActive })
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    if (!target.length) {
      log.warn("admin.reset_password.target_not_found", {
        outcome: "denied",
        actorId,
        targetUserId: id,
      });
      return respond({ success: false, error: "User not found" }, 404);
    }
    if (!target[0].isActive) {
      log.warn("admin.reset_password.target_inactive", {
        outcome: "denied",
        actorId,
        targetUserId: id,
      });
      return respond(
        {
          success: false,
          error:
            "Pengguna sudah dinonaktifkan. Aktifkan kembali pengguna sebelum mengatur ulang kata sandi.",
          code: "USER_NOT_ACTIVE",
        },
        409
      );
    }

    const body = await request.json().catch(() => undefined);
    const parsed = resetPasswordSchema.safeParse(body);
    if (!parsed.success) {
      const details = parsed.error.flatten().fieldErrors;
      log.warn("admin.reset_password.invalid_body", {
        outcome: "denied",
        actorId,
        targetUserId: id,
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
      log.warn("admin.reset_password.invalid_password", {
        outcome: "denied",
        actorId,
        targetUserId: id,
        validationFields: ["password"],
      });
      return respond(
        { success: false, error: "Password minimal 8 karakter." },
        400
      );
    }

    const hashedPassword = await bcrypt.hash(finalPassword, 10);

    // Update the credential account password (upsert: a user created without
    // a credential account gets one here).
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
      await db.insert(adminAccounts).values({
        id: crypto.randomUUID(),
        userId: id,
        accountId: id,
        providerId: "credential",
        password: hashedPassword,
      });
    }

    // Force the user to reset their password on next login.
    await db
      .update(users)
      .set({ mustResetPassword: true, updatedAt: new Date() })
      .where(eq(users.id, id));

    // Revoke all existing sessions for this user so the old password can no
    // longer be used on any device (centralized revocation seam).
    await revokeUserSessions(db, id);

    log.info("admin.reset_password.success", {
      outcome: "success",
      actorId,
      targetUserId: id,
      passwordMode,
    });
    return respond({
      success: true,
      data: {
        // Plaintext returned ONCE. Only the bcrypt hash is persisted.
        password: finalPassword,
        mustResetPassword: true,
      },
    });
  } catch (error) {
    log.error("admin.reset_password.failure", {
      outcome: "error",
      actorId,
      targetUserId: id,
      error: serializeError(error),
    });
    return respond(
      { success: false, error: "Failed to reset password" },
      500
    );
  }
}
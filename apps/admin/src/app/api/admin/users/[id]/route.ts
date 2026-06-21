import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users, branches, adminSessions, adminAccounts } from "@/db";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { withAuth } from "@/lib/auth-guard";

// -----------------------------
// GET /api/admin/users/:id
// -----------------------------
export const GET = withAuth(async (_ctx, _request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const { id } = await params;
    const row = await db
      .select({
        id: users.id,
        name: users.name,
        username: users.username,
        displayUsername: users.displayUsername,
        email: users.email,
        role: users.role,
        branchId: users.branchId,
        branchName: branches.name,
        branchCode: branches.code,
        mustResetPassword: users.mustResetPassword,
        emailVerified: users.emailVerified,
        image: users.image,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
      })
      .from(users)
      .leftJoin(branches, eq(users.branchId, branches.id))
      .where(eq(users.id, id))
      .limit(1);

    if (!row.length) {
      return NextResponse.json(
        { success: false, error: "User not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data: row[0] });
  } catch (error) {
    console.error("Error fetching admin user:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch user" },
      { status: 500 }
    );
  }
}, ["hq"]);

// -----------------------------
// PATCH /api/admin/users/:id
// -----------------------------
const updateUserSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  email: z.email().optional(),
  role: z.enum(["admin", "hq"]).optional(),
  branchId: z.string().nullable().optional(),
});

export const PATCH = withAuth(async (ctx, request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const { id } = await params;
    const body = await request.json();
    const parsed = updateUserSchema.safeParse(body);
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

    // Fetch target user
    const target = await db
      .select()
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    if (!target.length) {
      return NextResponse.json(
        { success: false, error: "User not found" },
        { status: 404 }
      );
    }

    const updates: Partial<typeof users.$inferInsert> = {
      updatedAt: new Date(),
    };
    const data = parsed.data;

    if (data.name) updates.name = data.name;
    if (data.email) updates.email = data.email.toLowerCase();

    // Role + branch logic
    const newRole = data.role ?? target[0].role;
    if (data.role) updates.role = data.role;

    if (data.branchId !== undefined) {
      // Explicit branchId provided in payload
      if (newRole === "hq") {
        updates.branchId = null;
      } else {
        if (data.branchId === null) {
          return NextResponse.json(
            {
              success: false,
              error: "Admin (branch staff) wajib memiliki cabang.",
            },
            { status: 400 }
          );
        }
        const branch = await db
          .select({ id: branches.id })
          .from(branches)
          .where(eq(branches.id, data.branchId))
          .limit(1);
        if (!branch.length) {
          return NextResponse.json(
            { success: false, error: "Cabang tidak ditemukan." },
            { status: 400 }
          );
        }
        updates.branchId = data.branchId;
      }
    } else if (data.role === "hq" && target[0].role !== "hq") {
      // Role changed to HQ — clear branch
      updates.branchId = null;
    } else if (data.role === "admin" && target[0].role !== "admin") {
      // Role changed to admin — require a branchId
      return NextResponse.json(
        {
          success: false,
          error:
            "Mengubah peran ke admin wajib menyertakan branchId cabang.",
        },
        { status: 400 }
      );
    }

    // Self-protection: HQ cannot demote themselves
    if (ctx.user.id === id && data.role && data.role !== "hq") {
      return NextResponse.json(
        {
          success: false,
          error: "Anda tidak dapat menurunkan peran Anda sendiri dari HQ.",
        },
        { status: 400 }
      );
    }

    // Email uniqueness check
    if (data.email) {
      const clash = await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.email, data.email.toLowerCase())))
        .limit(1);
      if (clash.length && clash[0].id !== id) {
        return NextResponse.json(
          { success: false, error: "Email sudah digunakan." },
          { status: 409 }
        );
      }
    }

    await db.update(users).set(updates).where(eq(users.id, id));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error updating admin user:", error);
    return NextResponse.json(
      { success: false, error: "Failed to update user" },
      { status: 500 }
    );
  }
}, ["hq"]);

// -----------------------------
// DELETE /api/admin/users/:id
// -----------------------------
export const DELETE = withAuth(async (ctx, _request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const { id } = await params;

    // Cannot delete self
    if (ctx.user.id === id) {
      return NextResponse.json(
        { success: false, error: "Anda tidak dapat menghapus akun Anda sendiri." },
        { status: 400 }
      );
    }

    const target = await db
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    if (!target.length) {
      return NextResponse.json(
        { success: false, error: "User not found" },
        { status: 404 }
      );
    }

    // Prevent deleting the last HQ user
    if (target[0].role === "hq") {
      const hqCount = await db
        .select({ count: users.id })
        .from(users)
        .where(eq(users.role, "hq"));
      if (hqCount.length <= 1) {
        return NextResponse.json(
          {
            success: false,
            error:
              "Tidak dapat menghapus HQ terakhir. Sistem memerlukan minimal satu akun HQ.",
          },
          { status: 400 }
        );
      }
    }

    // Revoke all sessions first (cascade on sessions/accounts will handle DB,
    // but explicit delete ensures consistency)
    await db.delete(adminSessions).where(eq(adminSessions.userId, id));
    await db.delete(adminAccounts).where(eq(adminAccounts.userId, id));
    await db.delete(users).where(eq(users.id, id));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting admin user:", error);
    return NextResponse.json(
      { success: false, error: "Failed to delete user" },
      { status: 500 }
    );
  }
}, ["hq"]);
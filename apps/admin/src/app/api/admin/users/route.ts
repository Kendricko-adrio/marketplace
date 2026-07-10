import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users, branches, adminSessions, adminAccounts } from "@/db";
import { eq, ilike, and, desc, sql, or } from "drizzle-orm";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { withPermission } from "@/lib/auth-guard";

// -----------------------------
// GET /api/admin/users — list users (HQ only)
// -----------------------------
export const GET = withPermission(async (_ctx, request: NextRequest) => {
  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search")?.trim() || "";
    const role = searchParams.get("role")?.trim() || "";

    const conditions = [];
    if (search) {
      conditions.push(
        or(
          ilike(users.name, `%${search}%`),
          ilike(users.email, `%${search}%`),
          ilike(users.username, `%${search}%`)
        )!
      );
    }
    if (role === "admin" || role === "hq") {
      conditions.push(eq(users.role, role));
    }

    const rows = await db
      .select({
        id: users.id,
        name: users.name,
        username: users.username,
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
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(users.createdAt));

    // Last-login = most recent session.createdAt per user
    const sessionRows = await db
      .select({
        userId: adminSessions.userId,
        lastLogin: sql<Date>`max(${adminSessions.createdAt})`.as("last_login"),
      })
      .from(adminSessions)
      .groupBy(adminSessions.userId);

    const lastLoginMap = new Map<string, Date>();
    for (const r of sessionRows) {
      if (r.lastLogin) lastLoginMap.set(r.userId, r.lastLogin);
    }

    const data = rows.map((r) => ({
      ...r,
      lastLogin: lastLoginMap.get(r.id) || null,
    }));

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error("Error fetching admin users:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch users" },
      { status: 500 }
    );
  }
}, "users", "view");

// -----------------------------
// POST /api/admin/users — create user (HQ only)
// Body: { name, email, role, branchId?, passwordMode: "manual"|"generate", password? }
// -----------------------------
const createUserSchema = z.object({
  name: z.string().min(2, "Nama minimal 2 karakter").max(100),
  email: z.email("Format email tidak valid"),
  role: z.enum(["admin", "hq"]),
  branchId: z.string().nullable().optional(),
  passwordMode: z.enum(["manual", "generate"]),
  password: z.string().min(8, "Password minimal 8 karakter").optional(),
});

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

// Generate a unique username from a display name.
// Strategy: lowercase, dots for spaces, strip non-alphanumeric.
// On collision, append 2, 3, 4...
async function generateUniqueUsername(
  baseName: string,
  excludeId?: string
): Promise<string> {
  const base = baseName
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip diacritics
    .trim()
    .replace(/[^a-z0-9\s._-]/g, "")
    .replace(/[\s._-]+/g, ".")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 30);

  const candidate = base || "user";
  let username = candidate;
  let suffix = 1;

  while (true) {
    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, username))
      .limit(1);

    const clash = existing.find((u) => u.id !== excludeId);
    if (!clash) return username;

    suffix += 1;
    username = `${candidate}${suffix}`;
  }
}

export const POST = withPermission(async (ctx, request: NextRequest) => {
  try {
    const body = await request.json();
    const parsed = createUserSchema.safeParse(body);
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

    const { name, email, role, passwordMode, password } = parsed.data;
    let branchId = parsed.data.branchId ?? null;

    // Admin role must have a branch; HQ oversees all (null branch)
    if (role === "admin") {
      if (!branchId) {
        return NextResponse.json(
          {
            success: false,
            error: "Admin (branch staff) wajib memiliki cabang.",
          },
          { status: 400 }
        );
      }
      // Validate branch exists
      const branch = await db
        .select({ id: branches.id })
        .from(branches)
        .where(eq(branches.id, branchId))
        .limit(1);
      if (!branch.length) {
        return NextResponse.json(
          { success: false, error: "Cabang tidak ditemukan." },
          { status: 400 }
        );
      }
    } else {
      // HQ role — ignore any branch assignment
      branchId = null;
    }

    // Check email uniqueness
    const existingEmail = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email.toLowerCase()))
      .limit(1);
    if (existingEmail.length) {
      return NextResponse.json(
        { success: false, error: "Email sudah digunakan." },
        { status: 409 }
      );
    }

    // Resolve password
    const finalPassword =
      passwordMode === "manual"
        ? password
        : generatePassword(16);

    if (!finalPassword || finalPassword.length < 8) {
      return NextResponse.json(
        { success: false, error: "Password minimal 8 karakter." },
        { status: 400 }
      );
    }

    // Generate unique username
    const username = await generateUniqueUsername(name);

    const userId = crypto.randomUUID();
    const hashedPassword = await bcrypt.hash(finalPassword, 10);

    // Insert user
    await db.insert(users).values({
      id: userId,
      name,
      username,
      displayUsername: username,
      email: email.toLowerCase(),
      emailVerified: true, // admins are created by HQ; no email verification flow
      role,
      branchId,
      mustResetPassword: true, // force password change on first login
    });

    // Insert credential account
    await db.insert(adminAccounts).values({
      id: crypto.randomUUID(),
      userId,
      accountId: userId,
      providerId: "credential",
      password: hashedPassword,
    });

    return NextResponse.json({
      success: true,
      data: {
        id: userId,
        name,
        username,
        email: email.toLowerCase(),
        role,
        branchId,
        mustResetPassword: true,
        // Plaintext password returned ONCE to the HQ.
        // It is never persisted — only the bcrypt hash is stored.
        password: finalPassword,
      },
    });
  } catch (error) {
    console.error("Error creating admin user:", error);
    return NextResponse.json(
      { success: false, error: "Failed to create user" },
      { status: 500 }
    );
  }
}, "users", "edit");
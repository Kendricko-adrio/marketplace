import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { auditLogs, users } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";

// Middleware to check admin role
async function checkAdmin() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    return { error: "Unauthorized", status: 401 };
  }

  if (session.user.role !== "admin") {
    return { error: "Forbidden", status: 403 };
  }

  return { user: session.user };
}

export async function GET(request: NextRequest) {
  try {
    const adminCheck = await checkAdmin();
    if ("error" in adminCheck) {
      return NextResponse.json(
        { success: false, error: adminCheck.error },
        { status: adminCheck.status }
      );
    }

    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get("limit") || "50");

    const logs = await db
      .select({
        log: auditLogs,
        user: {
          id: users.id,
          name: users.name,
          email: users.email,
        },
      })
      .from(auditLogs)
      .leftJoin(users, eq(auditLogs.userId, users.id))
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit);

    const formattedLogs = logs.map((row) => ({
      ...row.log,
      user: row.user || { name: "System", email: null },
    }));

    return NextResponse.json({
      success: true,
      data: formattedLogs,
    });
  } catch (error) {
    console.error("Error fetching audit log:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch audit log" },
      { status: 500 }
    );
  }
}

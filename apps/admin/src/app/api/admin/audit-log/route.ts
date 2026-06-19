import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { auditLogs, users } from "@/db";
import { eq, desc } from "drizzle-orm";
import { withAuth } from "@/lib/auth-guard";

export const GET = withAuth(async (_ctx, request: NextRequest) => {
  try {
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
}, ["admin", "hq"]);

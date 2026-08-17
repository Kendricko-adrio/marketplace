import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { getPermissionsForRole } from "@/lib/permissions";
import { db } from "@/db";
import { branches } from "@/db";
import { eq } from "drizzle-orm";

export async function GET() {
	const session = await auth.api.getSession({ headers: await headers() });

	if (!session) {
		return NextResponse.json(
			{ success: false, error: "Unauthorized" },
			{ status: 401 }
		);
	}

	try {
		const permissions = await getPermissionsForRole(session.user.role);

		// Resolve the admin's placed branch (HQ has branchId=null → null). The
		// session user only carries branchId; the name/code/city live on the
		// branches table, so the sidebar can show "Cabang …" without a second hit.
		const branchId = (session.user as { branchId?: string | null }).branchId;
		let branch: {
			id: string;
			name: string;
			code: string;
			city: string;
		} | null = null;
		if (branchId) {
			const branchRows = await db
				.select({
					id: branches.id,
					name: branches.name,
					code: branches.code,
					city: branches.city,
				})
				.from(branches)
				.where(eq(branches.id, branchId))
				.limit(1);
			branch = branchRows[0] ?? null;
		}

		return NextResponse.json({
			success: true,
			data: {
				role: session.user.role,
				permissions,
				branch,
			},
		});
	} catch (error) {
		console.error("Error fetching current user permissions:", error);
		return NextResponse.json(
			{ success: false, error: "Failed to fetch permissions" },
			{ status: 500 }
		);
	}
}

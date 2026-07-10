import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { getPermissionsForRole } from "@/lib/permissions";

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
		return NextResponse.json({
			success: true,
			data: {
				role: session.user.role,
				permissions,
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

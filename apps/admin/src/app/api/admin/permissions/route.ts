import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { getAllPermissions, upsertPermission } from "@/lib/permissions";
import { moduleNames } from "@/db";
import type { ModuleName } from "@/db";

export async function GET() {
	const session = await auth.api.getSession({ headers: await headers() });

	if (!session) {
		return NextResponse.json(
			{ success: false, error: "Unauthorized" },
			{ status: 401 }
		);
	}

	if (session.user.role !== "hq") {
		return NextResponse.json(
			{ success: false, error: "Forbidden" },
			{ status: 403 }
		);
	}

	try {
		const rows = await getAllPermissions();
		return NextResponse.json({ success: true, data: rows });
	} catch (error) {
		console.error("Error fetching permissions:", error);
		return NextResponse.json(
			{ success: false, error: "Failed to fetch permissions" },
			{ status: 500 }
		);
	}
}

export async function PUT(request: Request) {
	const session = await auth.api.getSession({ headers: await headers() });

	if (!session) {
		return NextResponse.json(
			{ success: false, error: "Unauthorized" },
			{ status: 401 }
		);
	}

	if (session.user.role !== "hq") {
		return NextResponse.json(
			{ success: false, error: "Forbidden" },
			{ status: 403 }
		);
	}

	try {
		const body = (await request.json()) as {
			role?: string;
			module?: string;
			canView?: boolean;
			canEdit?: boolean;
			canDelete?: boolean;
		};

		const { role, module, canView, canEdit, canDelete } = body;

		if (!role || typeof role !== "string") {
			return NextResponse.json(
				{ success: false, error: "role is required" },
				{ status: 400 }
			);
		}

		if (role !== "admin") {
			return NextResponse.json(
				{ success: false, error: "Only the admin role can be modified" },
				{ status: 400 }
			);
		}

		if (!module || !moduleNames.includes(module as ModuleName)) {
			return NextResponse.json(
				{ success: false, error: "module is required" },
				{ status: 400 }
			);
		}

		if (
			typeof canView !== "boolean" ||
			typeof canEdit !== "boolean" ||
			typeof canDelete !== "boolean"
		) {
			return NextResponse.json(
				{
					success: false,
					error: "canView, canEdit, and canDelete must be booleans",
				},
				{ status: 400 }
			);
		}

		await upsertPermission(role, module as ModuleName, {
			canView,
			canEdit,
			canDelete,
		});

		return NextResponse.json({ success: true });
	} catch (error) {
		console.error("Error updating permission:", error);
		return NextResponse.json(
			{ success: false, error: "Failed to update permission" },
			{ status: 500 }
		);
	}
}

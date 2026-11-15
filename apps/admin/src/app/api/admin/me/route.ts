import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { createModuleLogger, withRequestContext } from "@/lib/logger";

/**
 * Module logger untuk route ini: dibuat sekali di module scope, sedangkan
 * `requestId` dibaca dari scope HTTP yang aktif setiap kali log ditulis
 * (`withRequestContext` di export handler membuka scope tersebut).
 */
const log = createModuleLogger("admin-me");

/**
 * Proyeksi teknis statis untuk field `error`: pesan asli dari Better Auth
 * (atau lapisan di bawahnya) tidak pernah masuk log — nilai itu bisa memuat
 * cookie/header authorization/detail SQL.
 */
class CurrentUserLogError extends Error {
  constructor() {
    super("me gagal");
    this.name = "CurrentUserLogError";
  }
}

// GET /api/admin/me
// Authentication-only identity endpoint: returns the currently signed-in
// admin user's id, name, email, assigned Role id, and Home Branch id. No
// module authorization gate — this carries no protected business data, and
// the legacy `role` name field is gone (assignment is `roleId` + `branchId`).
// Policy discovery (grants/scopes) lives in /api/admin/policy/me.
export const dynamic = "force-dynamic";

async function currentAdminUser(): Promise<Response> {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      log.warn("me: pengguna belum terautentikasi (outcome denied)");
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Id internal saja: nama/email pemilik sesi tidak pernah masuk log.
    log.info(`me.resolved (userId ${session.user.id}, outcome success)`);

    return NextResponse.json({
      success: true,
      user: {
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
        roleId: session.user.roleId ?? null,
        branchId: session.user.branchId ?? null,
      },
    });
  } catch {
    log.error("me gagal (outcome error)", new CurrentUserLogError());
    return NextResponse.json(
      { success: false, error: "Failed to fetch current user" },
      { status: 500 }
    );
  }
}

export const GET = withRequestContext(currentAdminUser, "admin-me");

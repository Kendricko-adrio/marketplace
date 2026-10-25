import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { createModuleLogger, withRequestContext } from "@/lib/logger";

/**
 * Module logger untuk route ini: dibuat sekali di module scope, sedangkan
 * `requestId` dibaca dari scope HTTP yang aktif setiap kali log ditulis.
 */
const log = createModuleLogger("admin-session-check");

/**
 * Proyeksi teknis aman untuk kegagalan lookup sesi.
 *
 * Pesan asli dari Better Auth (atau lapisan di bawahnya) tidak pernah masuk log:
 * nilai itu bisa memuat cookie, header authorization, atau detail SQL. Karena
 * itu field `error` selalu diisi turunan statis ini, tanpa `cause` ke error
 * asli — kontrak HTTP-nya tetap 200 + body unauthenticated seperti sebelumnya.
 */
class SessionLookupError extends Error {
  constructor() {
    super("Session lookup unavailable");
    this.name = "SessionLookupError";
  }
}

// GET /api/admin/session-check
// Returns whether the current session's user must reset their password.
// Called right after login to decide the redirect target.
async function sessionCheck(): Promise<Response> {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session) {
      log.info("Session check: pengguna belum terautentikasi");
      return NextResponse.json(
        { success: false, mustResetPassword: false, authenticated: false },
        { status: 200 }
      );
    }

    const mustResetPassword = Boolean(
      (session.user as { mustResetPassword?: boolean }).mustResetPassword
    );

    // Data bisnis (flag boolean) hanya ada di message, bukan field log.
    log.info(`Session check: mustResetPassword=${mustResetPassword}`);

    return NextResponse.json({
      success: true,
      authenticated: true,
      mustResetPassword,
    });
  } catch {
    log.error("Session check gagal", new SessionLookupError());
    return NextResponse.json(
      { success: false, mustResetPassword: false, authenticated: false },
      { status: 200 }
    );
  }
}

/**
 * GET tanpa argumen di source; framework tetap memanggilnya dengan request
 * runtime, yang diteruskan apa adanya oleh wrapper (`x-request-id` + completion
 * HTTP ditambahkan di sana).
 */
export const GET = withRequestContext(sessionCheck, "admin-session-check");

import { auth } from "@/lib/auth";
import { getClientAccessError } from "@/lib/client-access";
import { headers } from "next/headers";
import { NextResponse } from "next/server";

export async function requireOnboardedApiSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  const accessError = getClientAccessError(session?.user);
  if (accessError) {
    return {
      ok: false as const,
      response: NextResponse.json(
        {
          success: false,
          code: accessError.code,
          error: accessError.error,
        },
        { status: accessError.status }
      ),
    };
  }
  return { ok: true as const, session: session! };
}

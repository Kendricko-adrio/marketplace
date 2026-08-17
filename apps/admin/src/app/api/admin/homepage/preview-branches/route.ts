import { NextResponse } from "next/server";
import { withPermission } from "@/lib/auth-guard";

/**
 * Server-side proxy that forwards to the storefront /api/branches endpoint.
 * Used by the admin CMS to preview "store_banner" sections with the active
 * branches the storefront would render, without exposing the store API to
 * cross-origin requests from the browser.
 *
 * The store /api/branches endpoint already filters to status = "aktif", so the
 * preview matches what the live homepage will show.
 *
 * The admin server-to-store fetch is not subject to CORS (CORS is a browser
 * mechanism only), so this proxy avoids "Failed to fetch" errors in the admin
 * client component.
 */
export const GET = withPermission(async () => {
  try {
    const storeBase =
      process.env.NEXT_PUBLIC_STORE_URL ||
      process.env.STORE_URL ||
      "http://localhost:3000";
    const storeUrl = `${storeBase.replace(/\/+$/, "")}/api/branches`;

    const res = await fetch(storeUrl, { cache: "no-store" });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (error) {
    console.error("Error proxying branch preview:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch branch preview" },
      { status: 500 }
    );
  }
}, "homepage", "view");
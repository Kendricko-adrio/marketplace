import { NextRequest, NextResponse } from "next/server";
import { withPermission } from "@/lib/auth-guard";

/**
 * Server-side proxy that forwards product filter queries to the storefront
 * /api/products endpoint. Used by the admin CMS to preview carousel "filter"
 * mode products without exposing the store API to cross-origin requests
 * from the browser.
 *
 * The admin server-to-store fetch is not subject to CORS (CORS is a browser
 * mechanism only), so this proxy avoids "Failed to fetch" errors in the admin
 * client component.
 */
export const GET = withPermission(async (_ctx, request: NextRequest) => {
  try {
    const { searchParams } = new URL(request.url);
    // Forward only whitelisted filter params to the store API.
    const forward = new URLSearchParams();
    for (const key of [
      "search",
      "category",
      "minPrice",
      "maxPrice",
      "flashSale",
      "sortOrder",
      "sortBy",
      "page",
      "limit",
    ]) {
      const v = searchParams.get(key);
      if (v !== null) forward.set(key, v);
    }
    // Always request page 1 with the requested limit (default 10, max 20).
    if (!forward.has("limit")) forward.set("limit", "10");
    if (!forward.has("page")) forward.set("page", "1");

    const storeBase =
      process.env.NEXT_PUBLIC_STORE_URL ||
      process.env.STORE_URL ||
      "http://localhost:3000";
    const storeUrl = `${storeBase.replace(/\/+$/, "")}/api/products?${forward.toString()}`;

    const res = await fetch(storeUrl, { cache: "no-store" });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (error) {
    console.error("Error proxying product preview:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch product preview" },
      { status: 500 }
    );
  }
}, "homepage", "view");
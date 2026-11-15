import { NextRequest, NextResponse } from "next/server";
import { withPermission } from "@/lib/rbac/route-guards";
import { createModuleLogger, withRequestContext } from "@/lib/logger";

/**
 * Module logger untuk route ini: dibuat sekali di module scope, sedangkan
 * `requestId` dibaca dari scope HTTP yang aktif setiap kali log ditulis.
 */
const log = createModuleLogger("admin-homepage-preview-products");

/**
 * Proyeksi teknis statis untuk jalur kegagalan tak terduga. Nilai yang
 * tertangkap tidak pernah masuk log; kontrak HTTP tetap sama.
 */
class ProductPreviewLogError extends Error {
  constructor() {
    super("admin homepage preview-products: gagal memuat preview produk");
    this.name = "ProductPreviewLogError";
  }
}

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
async function previewProducts(
  _ctx: unknown,
  request: NextRequest
): Promise<Response> {
  try {
    const { searchParams } = new URL(request.url);
    // Forward only whitelisted filter params to the store API.
    const forward = new URLSearchParams();
    for (const key of [
      "search",
      "category",
      "brand",
      "minPrice",
      "maxPrice",
      "hasDiscount",
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
  } catch {
    log.error(
      "Preview produk gagal dimuat (outcome error)",
      new ProductPreviewLogError()
    );
    return NextResponse.json(
      { success: false, error: "Failed to fetch product preview" },
      { status: 500 }
    );
  }
}

export const GET = withRequestContext(
  withPermission(previewProducts, "homepage", "view"),
  "admin-homepage-preview-products"
);

import { NextRequest, NextResponse } from "next/server";
import { createModuleLogger, withRequestContext } from "@/lib/logger";
import { getProductDetailByIdOrSlug } from "@/features/products/get-product-detail";

/**
 * Module logger untuk route ini: dibuat sekali di module scope, sedangkan
 * `requestId` dibaca dari scope HTTP yang aktif setiap kali log ditulis
 * (`withRequestContext` di export handler membuka scope tersebut).
 */
const log = createModuleLogger("product-detail");

/**
 * Proyeksi teknis statis untuk field `error`: pesan asli dari DB/Next/provider
 * tidak pernah masuk log, hanya pesan yang ditulis module ini.
 */
class RouteLogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RouteLogError";
  }
}

/** HTTP adapter: baca produk + varian + stok cabang, map ke status/body existing. */
async function getProductDetail(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  try {
    const { id } = await params;
    const data = await getProductDetailByIdOrSlug(id);

    if (!data) {
      return NextResponse.json(
        { success: false, error: "Product not found" },
        { status: 404 }
      );
    }

    log.info(`product detail loaded: product ${data.id}`);
    return NextResponse.json({
      success: true,
      data,
    });
  } catch {
    log.error("product detail failed", new RouteLogError("product detail failed"));
    return NextResponse.json(
      { success: false, error: "Failed to fetch product" },
      { status: 500 }
    );
  }
}

/** HTTP entry: wrapper menambahkan `x-request-id` kanonik + satu baris completion. */
export const GET = withRequestContext(getProductDetail, "product-detail");

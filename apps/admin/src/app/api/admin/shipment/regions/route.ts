import { NextRequest, NextResponse } from "next/server";

import { guard } from "@/lib/rbac/guard";
import { createModuleLogger, withRequestContext } from "@/lib/logger";
import { shipmentRegions } from "@/lib/shipment-regions";
import type { RegionLevel } from "@marketplace/db/src/shipment-regions";

// =========================================================
// GET /api/admin/shipment/regions   [branches:edit]
// =========================================================
// Region picker for the branch shipping-origin form: `level` must be one of
// provinces|cities|districts|areas and every non-province level requires a
// numeric `parentId` (400 otherwise, before the provider is called). The
// provider answer is passed through unchanged; an unavailable provider is a
// plain 503, never a partial region list.
//
// Logging never includes the free-text query or provider payload — only the
// requested level, the row count and the acting user id.

/**
 * Static, module-owned projection for the unexpected path. The caught value can
 * carry provider free text (URLs, bodies), so it is never passed to a log line;
 * the caller still receives the identical 503 envelope.
 */
class ShipmentRegionsLogError extends Error {
  constructor(event: string) {
    super(`shipment regions gagal (${event})`);
    this.name = "ShipmentRegionsLogError";
  }
}

/**
 * Module logger untuk route ini: dibuat sekali di module scope, sedangkan
 * `requestId` dibaca dari scope HTTP yang aktif setiap kali log ditulis
 * (`withRequestContext` di export handler membuka scope tersebut).
 */
const log = createModuleLogger("admin-shipment-regions");

async function listShipmentRegions(request: NextRequest): Promise<Response> {
  const guardResult = await guard("branches", "edit");
  if (!guardResult.ok) return guardResult.response;
  const { ctx } = guardResult;

  const query = request.nextUrl.searchParams;
  const level = query.get("level");
  const parentId = query.get("parentId") ?? undefined;
  if (!["provinces", "cities", "districts", "areas"].includes(level ?? "") ||
      (level !== "provinces" && !/^\d{1,16}$/.test(parentId ?? ""))) {
    log.warn(
      `shipment.regions.invalid_input (level ${level ?? "missing"}, actorUserId ${ctx.user.id}, outcome denied)`
    );
    return NextResponse.json({ success: false, error: "Invalid region query" }, { status: 400 });
  }
  try {
    const data = await shipmentRegions().list(level as RegionLevel, parentId);
    log.info(
      `shipment.regions.list (level ${level}, parentId ${parentId ?? "none"}, count ${data.length}, actorUserId ${ctx.user.id}, outcome success)`
    );
    return NextResponse.json({ success: true, data });
  } catch {
    // Nilai yang tertangkap tidak pernah masuk log: bisa memuat URL/payload provider.
    log.error(
      `shipment.regions.unavailable (level ${level}, actorUserId ${ctx.user.id}, outcome error)`,
      new ShipmentRegionsLogError("shipment.regions.unavailable")
    );
    return NextResponse.json({ success: false, error: "Wilayah Shipment tidak tersedia. Silakan coba lagi." }, { status: 503 });
  }
}

/** HTTP entry: wrapper menambahkan `x-request-id` kanonik + satu baris completion. */
export const GET = withRequestContext(listShipmentRegions, "admin-shipment-regions");

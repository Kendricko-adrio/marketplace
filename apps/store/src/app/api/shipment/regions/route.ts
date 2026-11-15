import { NextResponse } from "next/server";
import { requireOnboardedApiSession } from "@/lib/route-access";
import { createModuleLogger, withRequestContext } from "@/lib/logger";
import { createShipmentRegionGateway, type RegionLevel } from "@/lib/shipment-regions";

/**
 * Module logger untuk route ini: dibuat sekali di module scope, sedangkan
 * `requestId` dibaca dari scope HTTP yang aktif setiap kali log ditulis
 * (`withRequestContext` di export handler membuka scope tersebut).
 */
const log = createModuleLogger("shipment-regions");

/** HTTP adapter: auth, validasi level/parentId, panggil gateway wilayah. */
async function listShipmentRegions(request: Request): Promise<Response> {
  try {
    const access = await requireOnboardedApiSession();
    if (!access.ok) { log.info("region request denied"); return access.response; }
    const query = new URL(request.url).searchParams;
    const level = query.get("level");
    const parentId = query.get("parentId") ?? undefined;
    if (!["provinces", "cities", "districts", "areas"].includes(level ?? "") || (level !== "provinces" && !/^\d{1,16}$/.test(parentId ?? ""))) {
      log.error("invalid region request (code INPUT_INVALID)");
      return NextResponse.json({ success: false, error: "Wilayah tidak valid." }, { status: 400 });
    }
    const data = await createShipmentRegionGateway().list(level as RegionLevel, parentId);
    log.info(`Shipment regions loaded: level ${level}, count ${data.length}`);
    return NextResponse.json({ success: true, data });
  } catch {
    log.error("Shipment region lookup failed (code REGION_UNAVAILABLE)");
    return NextResponse.json({ success: false, error: "Wilayah belum tersedia. Coba lagi." }, { status: 503 });
  }
}

/** HTTP entry: wrapper menambahkan `x-request-id` kanonik + satu baris completion. */
export const GET = withRequestContext(listShipmentRegions, "shipment-regions");

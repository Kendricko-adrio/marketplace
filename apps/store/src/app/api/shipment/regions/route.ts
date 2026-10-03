import { NextResponse } from "next/server";
import { requireOnboardedApiSession } from "@/lib/route-access";
import { createLogger } from "@/lib/logger";
import { createShipmentRegionGateway, type RegionLevel } from "@/lib/shipment-regions";
export async function GET(request: Request) {
  const log = createLogger({ module: "shipment-regions" });
  try {
    const access = await requireOnboardedApiSession();
    if (!access.ok) { log.info("region request denied"); return access.response; }
    const query = new URL(request.url).searchParams;
    const level = query.get("level");
    const parentId = query.get("parentId") ?? undefined;
    if (!["provinces", "cities", "districts", "areas"].includes(level ?? "") || (level !== "provinces" && !/^\d{1,16}$/.test(parentId ?? ""))) {
      log.error("invalid region request", { code: "INPUT_INVALID" });
      return NextResponse.json({ success: false, error: "Wilayah tidak valid." }, { status: 400 });
    }
    const data = await createShipmentRegionGateway().list(level as RegionLevel, parentId);
    log.info("Shipment regions loaded", { level, count: data.length });
    return NextResponse.json({ success: true, data });
  } catch {
    log.error("Shipment region lookup failed", { code: "REGION_UNAVAILABLE" });
    return NextResponse.json({ success: false, error: "Wilayah belum tersedia. Coba lagi." }, { status: 503 });
  }
}

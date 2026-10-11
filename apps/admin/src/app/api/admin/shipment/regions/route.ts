import { NextRequest, NextResponse } from "next/server";
import { guard } from "@/lib/rbac/guard";
import { shipmentRegions } from "@/lib/shipment-regions";
import type { RegionLevel } from "@marketplace/db/src/shipment-regions";

export async function GET(request: NextRequest) {
  const authorization = await guard("branches", "edit", { request });
  if (!authorization.ok) return authorization.response;
  const { logger } = authorization;
  const query = request.nextUrl.searchParams;
  const level = query.get("level");
  const parentId = query.get("parentId") ?? undefined;
  if (!["provinces", "cities", "districts", "areas"].includes(level ?? "") ||
      (level !== "provinces" && !/^\d{1,16}$/.test(parentId ?? ""))) {
    logger.error("shipment.regions.invalid_input", { outcome: "denied" });
    return NextResponse.json({ success: false, error: "Invalid region query" }, { status: 400 });
  }
  try {
    const data = await shipmentRegions().list(level as RegionLevel, parentId);
    logger.info("shipment.regions.list", { outcome: "success", level, count: data.length });
    return NextResponse.json({ success: true, data });
  } catch {
    logger.error("shipment.regions.unavailable", { outcome: "error", level });
    return NextResponse.json({ success: false, error: "Wilayah Shipment tidak tersedia. Silakan coba lagi." }, { status: 503 });
  }
}

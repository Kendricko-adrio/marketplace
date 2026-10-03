import { NextResponse } from "next/server";
import { db } from "@/db";
import { requireOnboardedApiSession } from "./route-access";
import { createLogger } from "./logger";
import { ClientAddressError, createClientAddressBook } from "./client-addresses";
import { createShipmentRegionGateway } from "./shipment-regions";

const requests = new Map<string, { count: number; until: number }>();
/** Shared authenticated boundary: no full addresses/phone/provider responses in logs. */
export async function addressApi(action: string, run: (book: ReturnType<typeof createClientAddressBook>, userId: string) => Promise<unknown>) {
  const log = createLogger({ module: "client-addresses", action });
  try {
    const access = await requireOnboardedApiSession();
    if (!access.ok) { log.info("address request denied", { outcome: "denied" }); return access.response; }
    const userId = access.session.user.id;
    const now = Date.now();
    for (const [key, item] of requests) if (item.until < now) requests.delete(key);
    const entry = requests.get(userId) ?? { count: 0, until: now + 60000 };
    if (++entry.count > 100) { log.info("address rate limit", { userId, outcome: "denied" }); return NextResponse.json({ success: false, error: "Terlalu banyak permintaan. Coba lagi." }, { status: 429 }); }
    requests.set(userId, entry);
    const data = await run(createClientAddressBook(db, createShipmentRegionGateway()), userId);
    log.info("address request succeeded", { userId, outcome: "success" });
    return NextResponse.json({ success: true, data: data ?? null });
  } catch (error) {
    const code = error instanceof ClientAddressError ? error.code : "UNAVAILABLE";
    log.error("address request failed", { code });
    return NextResponse.json({ success: false, error: code === "NOT_FOUND" ? "Alamat tidak ditemukan." : code === "INPUT_INVALID" || code === "REGION_INVALID" ? "Periksa alamat dan wilayah yang dipilih." : "Alamat belum dapat diproses. Coba lagi.", code }, { status: code === "NOT_FOUND" ? 404 : code === "UNAVAILABLE" ? 503 : 400 });
  }
}

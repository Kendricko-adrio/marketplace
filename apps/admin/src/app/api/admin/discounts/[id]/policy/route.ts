import { NextRequest } from "next/server";

import { guard } from "@/lib/rbac/guard";
import { createModuleLogger, withRequestContext } from "@/lib/logger";
import { discountErrorResponse } from "@/lib/discounts-http";

// =========================================================
// PATCH /api/admin/discounts/[id]/policy   [discounts:edit] — DITUTUP
// =========================================================
// Capacity/quota/budget/per-customer limit dulu ditulis langsung ke Offer live.
// Konfigurasi promo sekarang hanya berubah lewat draft menyeluruh lalu publish
// atomik. Endpoint ini sengaja mengembalikan 410 (bukan adapter diam-diam yang
// membuat draft parsial), supaya tidak ada writer lama yang bisa mem-bypass
// lifecycle draft. Lifecycle pause/aktifkan/arsip tetap di endpoint state.
export const dynamic = "force-dynamic";

const log = createModuleLogger("admin-discount-policy-moved");

type RouteContext = { params: Promise<{ id: string }> };

async function moved(_request: NextRequest, { params }: RouteContext): Promise<Response> {
  const guardResult = await guard("discounts", "edit");
  if (!guardResult.ok) return guardResult.response;
  const { id } = await params;
  log.warn(`discounts patch ditolak: writer lama ditutup (offer ${id}, outcome denied)`);
  return discountErrorResponse(
    410,
    "CONFIGURATION_MOVED_TO_DRAFT",
    "Ubah konfigurasi melalui draft, lalu publish"
  );
}

export const PATCH = withRequestContext(moved, "admin-discount-policy-moved");

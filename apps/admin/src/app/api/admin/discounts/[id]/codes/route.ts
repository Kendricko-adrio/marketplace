import { NextRequest } from "next/server";

import { guard } from "@/lib/rbac/guard";
import { createModuleLogger, withRequestContext } from "@/lib/logger";
import { discountErrorResponse } from "@/lib/discounts-http";

// =========================================================
// POST /api/admin/discounts/[id]/codes   [discounts:edit] — DITUTUP
// =========================================================
// Kode manual dulu direservasi langsung saat ditambahkan.
// Konfigurasi promo sekarang hanya berubah lewat draft menyeluruh lalu publish
// atomik. Endpoint ini sengaja mengembalikan 410 (bukan adapter diam-diam yang
// membuat draft parsial), supaya tidak ada writer lama yang bisa mem-bypass
// lifecycle draft. Lifecycle pause/aktifkan/arsip tetap di endpoint state.
export const dynamic = "force-dynamic";

const log = createModuleLogger("admin-discount-codes-moved");

type RouteContext = { params: Promise<{ id: string }> };

async function moved(_request: NextRequest, { params }: RouteContext): Promise<Response> {
  const guardResult = await guard("discounts", "edit");
  if (!guardResult.ok) return guardResult.response;
  const { id } = await params;
  log.warn(`discounts post ditolak: writer lama ditutup (offer ${id}, outcome denied)`);
  return discountErrorResponse(
    410,
    "CONFIGURATION_MOVED_TO_DRAFT",
    "Ubah konfigurasi melalui draft, lalu publish"
  );
}

export const POST = withRequestContext(moved, "admin-discount-codes-moved");

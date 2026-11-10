import { NextRequest } from "next/server";

import { guard } from "@/lib/rbac/guard";
import { createModuleLogger, withRequestContext } from "@/lib/logger";
import { discountErrorResponse } from "@/lib/discounts-http";

// =========================================================
// PATCH /api/admin/discounts/[id]/codes/[codeId]  [discounts:edit] — DITUTUP
// =========================================================
// Status kode dulu diubah langsung pada kode live. Sekarang status target
// adalah bagian dari draft (header "Kode yang sudah diterbitkan") dan baru
// berlaku saat publish, sehingga endpoint ini mengembalikan 410 alih-alih
// menulis eligibility di luar lifecycle draft.
export const dynamic = "force-dynamic";

const log = createModuleLogger("admin-discount-code-state-moved");

type RouteContext = { params: Promise<{ id: string; codeId: string }> };

async function moved(
  _request: NextRequest,
  { params }: RouteContext
): Promise<Response> {
  const guardResult = await guard("discounts", "edit");
  if (!guardResult.ok) return guardResult.response;
  const { id, codeId } = await params;
  log.warn(
    `discounts codes state ditolak: writer lama ditutup (offer ${id}, codeId ${codeId}, outcome denied)`
  );
  return discountErrorResponse(
    410,
    "CONFIGURATION_MOVED_TO_DRAFT",
    "Ubah konfigurasi melalui draft, lalu publish"
  );
}

export const PATCH = withRequestContext(moved, "admin-discount-code-state-moved");

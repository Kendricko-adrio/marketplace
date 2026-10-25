import { NextRequest } from "next/server";
import { z } from "zod";

import { guard } from "@/lib/rbac/guard";
import { createModuleLogger, withRequestContext } from "@/lib/logger";
import {
  simulateDiscountOffer,
  DiscountAdministrationError,
} from "@/lib/discounts-administration";
import {
  discountFailureResponse,
  discountSuccessResponse,
  requireActorId,
} from "@/lib/discounts-http";

// =========================================================
// POST /api/admin/discounts/[id]/simulate                [discounts:edit]
// =========================================================
// Admin-only pricing preview through the shared versioned Pricing interface
// (the same evaluator the customer path will use). The response is labelled as
// a simulation: it is not a quote, not an order, reserves no stock/capacity and
// promises no quota. The draft version is part of the request so a preview can
// never silently use different terms than the editor is looking at.
export const dynamic = "force-dynamic";

/**
 * Module logger untuk route ini: dibuat sekali di module scope, sedangkan
 * `requestId` dibaca dari scope HTTP yang aktif setiap kali log ditulis
 * (`withRequestContext` di export handler membuka scope tersebut).
 */
const log = createModuleLogger("admin-discount-simulate");

type RouteContext = { params: Promise<{ id: string }> };

const simulateSchema = z.strictObject({
  expectedDraftVersion: z.number().int().positive(),
  fulfillmentMethod: z.enum(["pickup", "delivery"]),
  shippingCost: z.union([z.string(), z.number()]).optional(),
  lines: z
    .array(
      z.strictObject({
        variantId: z.string().min(1).max(128),
        unitPrice: z.union([z.string(), z.number()]),
        quantity: z.number().int().positive(),
      })
    )
    .min(1)
    .max(50),
});

async function simulateOffer(
  request: NextRequest,
  { params }: RouteContext
): Promise<Response> {
  const guardResult = await guard("discounts", "edit");
  if (!guardResult.ok) return guardResult.response;
  const { ctx } = guardResult;

  try {
    const parsed = simulateSchema.safeParse(
      await request.json().catch(() => null)
    );
    if (!parsed.success) {
      log.warn("discounts simulate ditolak: body tidak valid (outcome denied)");
      return discountFailureResponse(
        new DiscountAdministrationError(400, "INPUT_INVALID", "Invalid request body"),
        "discounts simulate ditolak"
      );
    }

    const { id } = await params;
    const result = await simulateDiscountOffer(
      { offerId: id, ...parsed.data },
      requireActorId(ctx.user.id)
    );

    // Harga/line mentah tidak masuk log — hanya jumlah baris dan fakta hasil.
    log.info(
      `discounts simulate (offer ${id}, applied ${result.applied}, eligible ${result.eligible}, fulfillmentMethod ${parsed.data.fulfillmentMethod}, lineCount ${parsed.data.lines.length}, actor ${ctx.user.id}, outcome success)`
    );
    return discountSuccessResponse(result);
  } catch (error) {
    return discountFailureResponse(error, "discounts simulate gagal");
  }
}

/** HTTP entry: wrapper menambahkan `x-request-id` kanonik + satu baris completion. */
export const POST = withRequestContext(simulateOffer, "admin-discount-simulate");

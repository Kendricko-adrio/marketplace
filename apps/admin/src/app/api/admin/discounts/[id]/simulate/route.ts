import { NextRequest } from "next/server";
import { z } from "zod";

import { guard } from "@/lib/rbac/guard";
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

export async function POST(request: NextRequest, { params }: RouteContext) {
  const guardResult = await guard("discounts", "edit", { request });
  if (!guardResult.ok) return guardResult.response;
  const { logger, ctx } = guardResult;

  try {
    const parsed = simulateSchema.safeParse(
      await request.json().catch(() => null)
    );
    if (!parsed.success) {
      logger.warn("discounts.simulate.invalid_body", { outcome: "denied" });
      return discountFailureResponse(
        logger,
        new DiscountAdministrationError(400, "INPUT_INVALID", "Invalid request body"),
        "discounts.simulate.denied"
      );
    }

    const { id } = await params;
    const result = await simulateDiscountOffer(
      { offerId: id, ...parsed.data },
      requireActorId(ctx.user.id)
    );

    logger.info("discounts.simulate", {
      outcome: "success",
      offerId: id,
      applied: result.applied,
      eligible: result.eligible,
      fulfillmentMethod: parsed.data.fulfillmentMethod,
      lineCount: parsed.data.lines.length,
      actorId: ctx.user.id,
    });
    return discountSuccessResponse(logger, result);
  } catch (error) {
    return discountFailureResponse(logger, error, "discounts.simulate.failure");
  }
}

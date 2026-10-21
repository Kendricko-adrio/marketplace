import { NextResponse } from "next/server";

import { serializeError, withRequestId, type Logger } from "@/lib/logger";
import {
  describeDiscountAdministrationError,
  DiscountAdministrationError,
} from "./discounts-administration";

// =========================================================
// Shared HTTP envelope for the discount administration routes
// =========================================================
// One place builds the `{ success: false, error, code, requestId }` body plus
// the `x-request-id` header and decides which logger level a failure deserves.
// Successful routes log their own `info` event with the fields ops need; this
// helper only owns the failure path so a new endpoint cannot forget it.

export const DISCOUNTS_NO_STORE = { "Cache-Control": "no-store" } as const;

export function discountErrorResponse(
  logger: Logger,
  status: number,
  code: string,
  message: string
): NextResponse {
  return withRequestId(
    NextResponse.json(
      { success: false, error: message, code, requestId: logger.requestId },
      { status, headers: DISCOUNTS_NO_STORE }
    ),
    logger
  );
}

export function discountSuccessResponse<T>(
  logger: Logger,
  data: T,
  status = 200
): NextResponse {
  return withRequestId(
    NextResponse.json(
      { success: true, data },
      { status, headers: DISCOUNTS_NO_STORE }
    ),
    logger
  );
}

/**
 * Map a thrown domain/DB error onto the stable envelope. Structured `warn` for
 * expected denials, `error` with serialized context for the unexpected path.
 * Never log the request body, a request key, a review fingerprint or any
 * actor/session material.
 */
export function discountFailureResponse(
  logger: Logger,
  error: unknown,
  event: string
): NextResponse {
  const described = describeDiscountAdministrationError(error);
  if (described) {
    logger.warn(event, {
      outcome: "denied",
      code: described.code,
    });
    return discountErrorResponse(
      logger,
      described.status,
      described.code,
      described.message
    );
  }
  logger.error(event, {
    outcome: "error",
    error: serializeError(error),
  });
  return discountErrorResponse(
    logger,
    500,
    "INTERNAL",
    "Internal server error"
  );
}

/** Fail closed when the acting admin id is somehow absent from the session. */
export function requireActorId(userId: string | null | undefined): string {
  if (!userId) {
    throw new DiscountAdministrationError(
      401,
      "UNAUTHENTICATED",
      "Unauthorized"
    );
  }
  return userId;
}

import { NextResponse } from "next/server";

import { createModuleLogger, getRequestId } from "@/lib/logger";
import {
  describeDiscountAdministrationError,
  DiscountAdministrationError,
} from "./discounts-administration";

// =========================================================
// Shared HTTP envelope for the discount administration routes
// =========================================================
// One place builds the `{ success: false, error, code, requestId }` body and
// decides which logger level a failure deserves. Successful routes log their
// own `info` event with the fields ops need; this helper only owns the failure
// path so a new endpoint cannot forget it.
//
// Logging contract (maintainable-code §7): the module logger is created once
// here, so the helpers take no `logger` argument. `requestId` in the body is the
// canonical id of the active HTTP scope (`getRequestId()`, `null` outside one);
// the `x-request-id` header is added by the `withRequestContext` wrapper that
// owns the HTTP entry, not stamped here. Business facts (event name, denial
// code, outcome) travel in the `message`; the unexpected path logs a static
// projection so no DB/driver text can leak.

const log = createModuleLogger("discounts-http");

export const DISCOUNTS_NO_STORE = { "Cache-Control": "no-store" } as const;

/**
 * Static, module-owned projection for the unexpected path. The caught value can
 * carry SQL/provider free text, so it is never passed to a log line; the caller
 * still receives the identical `500 INTERNAL` envelope.
 */
class DiscountsEnvelopeLogError extends Error {
  constructor(event: string) {
    super(`discount administration envelope gagal (${event})`);
    this.name = "DiscountsEnvelopeLogError";
  }
}

export function discountErrorResponse(
  status: number,
  code: string,
  message: string
): NextResponse {
  return NextResponse.json(
    { success: false, error: message, code, requestId: getRequestId() },
    { status, headers: DISCOUNTS_NO_STORE }
  );
}

export function discountSuccessResponse<T>(
  data: T,
  status = 200
): NextResponse {
  return NextResponse.json(
    { success: true, data },
    { status, headers: DISCOUNTS_NO_STORE }
  );
}

/**
 * Map a thrown domain/DB error onto the stable envelope. Structured `warn` for
 * expected denials, `error` with a static projection for the unexpected path.
 * Never log the request body, a request key, a review fingerprint or any
 * actor/session material.
 */
export function discountFailureResponse(
  error: unknown,
  event: string
): NextResponse {
  const described = describeDiscountAdministrationError(error);
  if (described) {
    log.warn(`${event} (code ${described.code}, outcome denied)`);
    return discountErrorResponse(
      described.status,
      described.code,
      described.message
    );
  }
  log.error(
    `${event} (code INTERNAL, outcome error)`,
    new DiscountsEnvelopeLogError(event)
  );
  return discountErrorResponse(
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

import { NextResponse } from "next/server";

import { serializeError, withRequestId, type Logger } from "@/lib/logger";
import {
  describePriceChangeError,
  PriceChangeError,
} from "./price-changes-administration";

// Shared HTTP envelope for the Markdown price-change routes. Mirrors the
// discount-administration helper: stable `{success:false,code,error,requestId}`,
// no-store on every response, `warn` for expected denials and `error` for the
// unexpected path. Request keys, fingerprints and source prices of other SKUs
// are never logged.

export const PRICE_CHANGES_NO_STORE = { "Cache-Control": "no-store" } as const;

export function priceChangeErrorResponse(
  logger: Logger,
  status: number,
  code: string,
  message: string
): NextResponse {
  return withRequestId(
    NextResponse.json(
      { success: false, error: message, code, requestId: logger.requestId },
      { status, headers: PRICE_CHANGES_NO_STORE }
    ),
    logger
  );
}

export function priceChangeSuccessResponse<T>(
  logger: Logger,
  data: T,
  status = 200
): NextResponse {
  return withRequestId(
    NextResponse.json(
      { success: true, data },
      { status, headers: PRICE_CHANGES_NO_STORE }
    ),
    logger
  );
}

export function priceChangeFailureResponse(
  logger: Logger,
  error: unknown,
  event: string
): NextResponse {
  const described = describePriceChangeError(error);
  if (described) {
    logger.warn(event, { outcome: "denied", code: described.code });
    return priceChangeErrorResponse(
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
  return priceChangeErrorResponse(
    logger,
    500,
    "INTERNAL",
    "Internal server error"
  );
}

export function requirePriceActorId(
  userId: string | null | undefined
): string {
  if (!userId) {
    throw new PriceChangeError(401, "UNAUTHENTICATED", "Unauthorized");
  }
  return userId;
}

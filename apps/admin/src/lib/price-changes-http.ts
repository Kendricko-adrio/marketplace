import { NextResponse } from "next/server";

import { createModuleLogger, getRequestId } from "@/lib/logger";
import { describePriceChangeError, PriceChangeError } from "./price-changes-administration";
import type { PriceWorkbookFile } from "./price-changes-administration";

// Shared HTTP envelope for the Markdown price-change routes. Mirrors the
// discount-administration helper: stable `{success:false,code,error,requestId}`,
// no-store on every response, `warn` for expected denials and `error` for the
// unexpected path. Request keys, fingerprints and source prices of other SKUs
// are never logged.
//
// Logging contract (maintainable-code §7): the module logger is created once
// here, so no helper takes a `logger` argument. `requestId` in the body is the
// canonical id of the active HTTP scope (`getRequestId()`, `null` outside one);
// the `x-request-id` header belongs to the `withRequestContext` wrapper at the
// HTTP entry. Denial codes and the machine-readable workbook reason are static
// tokens, so they travel in the `message`; the unexpected path logs a static
// projection instead of the caught value.

const log = createModuleLogger("price-changes-http");

export const PRICE_CHANGES_NO_STORE = { "Cache-Control": "no-store" } as const;

export const WORKBOOK_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * Static, module-owned projection for the unexpected path. The caught value can
 * carry SQL/provider free text, so it is never passed to a log line; the caller
 * still receives the identical `500 INTERNAL` envelope.
 */
class PriceChangesEnvelopeLogError extends Error {
  constructor(event: string) {
    super(`price change envelope gagal (${event})`);
    this.name = "PriceChangesEnvelopeLogError";
  }
}

export function priceChangeErrorResponse(
  status: number,
  code: string,
  message: string,
  details?: { reason?: string }
): NextResponse {
  return NextResponse.json(
    {
      success: false,
      error: message,
      code,
      ...(details ? { details } : {}),
      requestId: getRequestId(),
    },
    { status, headers: PRICE_CHANGES_NO_STORE }
  );
}

export function priceChangeSuccessResponse<T>(
  data: T,
  status = 200
): NextResponse {
  return NextResponse.json(
    { success: true, data },
    { status, headers: PRICE_CHANGES_NO_STORE }
  );
}

/**
 * Binary `.xlsx` download. The bytes are built from durable row records (or a
 * blank template) — never from a stored upload — and are written as literal
 * inline strings, so no cell can become a formula.
 */
export function priceWorkbookResponse(
  file: PriceWorkbookFile
): NextResponse {
  return new NextResponse(Buffer.from(file.bytes), {
    status: 200,
    headers: {
      ...PRICE_CHANGES_NO_STORE,
      "Content-Type": WORKBOOK_CONTENT_TYPE,
      "Content-Disposition": `attachment; filename="${file.filename}"`,
      "Content-Length": String(file.bytes.length),
    },
  });
}

export function priceChangeFailureResponse(
  error: unknown,
  event: string
): NextResponse {
  const described = describePriceChangeError(error);
  if (described) {
    // `details.reason` is the workbook reject reason token (e.g.
    // WORKBOOK_CORRUPT), never free text or a price from another SKU.
    const reason = described.details?.reason;
    log.warn(
      `${event} (code ${described.code}${
        reason ? `, reason ${reason}` : ""
      }, outcome denied)`
    );
    return priceChangeErrorResponse(
      described.status,
      described.code,
      described.message,
      described.details
    );
  }
  log.error(
    `${event} (code INTERNAL, outcome error)`,
    new PriceChangesEnvelopeLogError(event)
  );
  return priceChangeErrorResponse(
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

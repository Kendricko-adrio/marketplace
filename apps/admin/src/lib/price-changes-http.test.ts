import { describe, expect, it } from "vitest";

import { getRequestId, withRequestContext } from "@/lib/logger";
import { PriceChangeError } from "./price-changes-administration";
import {
  PRICE_CHANGES_NO_STORE,
  WORKBOOK_CONTENT_TYPE,
  priceChangeErrorResponse,
  priceChangeFailureResponse,
  priceChangeSuccessResponse,
  priceWorkbookResponse,
  requirePriceActorId,
} from "./price-changes-http";

// =========================================================
// Seam — price change HTTP envelope + workbook download (no DB, no route)
// =========================================================
// The expectations are the HTTP contract the admin price-change routes
// publish: the same `{ success, data }` / `{ success:false, code, error,
// requestId }` envelope as the discount routes, `no-store` everywhere, and a
// binary download with an exact header set. The helper takes no logger, so the
// body's `requestId` must come from the active HTTP scope.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("price change HTTP envelope", () => {
  it("keeps the success envelope and the no-store policy", async () => {
    const response = priceChangeSuccessResponse({ batchId: "batch-1" });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      success: true,
      data: { batchId: "batch-1" },
    });
  });

  it("keeps the failure shape and details outside any HTTP scope", async () => {
    expect(getRequestId()).toBeNull();

    const response = priceChangeErrorResponse(
      400,
      "WORKBOOK_REJECTED",
      "Workbook ditolak",
      { reason: "WORKBOOK_CORRUPT" }
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      success: false,
      error: "Workbook ditolak",
      code: "WORKBOOK_REJECTED",
      details: { reason: "WORKBOOK_CORRUPT" },
      requestId: null,
    });
  });

  it("reports the canonical request id of the active scope in body and header", async () => {
    const handler = withRequestContext(async () =>
      priceChangeErrorResponse(403, "DENIED", "Tidak berwenang")
    );

    const response = await handler();
    const headerRequestId = response.headers.get("x-request-id");
    const body = (await response.json()) as { requestId: string };

    expect(headerRequestId).toMatch(UUID);
    expect(body.requestId).toBe(headerRequestId);
    expect(getRequestId()).toBeNull();
  });

  it("maps a described domain denial onto its status, code and reason", async () => {
    const response = priceChangeFailureResponse(
      new PriceChangeError(400, "WORKBOOK_REJECTED", "Workbook ditolak", {
        reason: "WORKBOOK_CORRUPT",
      }),
      "price-changes.stage.failure"
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      success: false,
      error: "Workbook ditolak",
      code: "WORKBOOK_REJECTED",
      details: { reason: "WORKBOOK_CORRUPT" },
      requestId: null,
    });
  });

  it("answers 500 INTERNAL for an unexpected error and never echoes its text", async () => {
    const response = priceChangeFailureResponse(
      new Error("password=hunter2 host=db-internal"),
      "price-changes.stage.failure"
    );

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({
      success: false,
      error: "Internal server error",
      code: "INTERNAL",
      requestId: null,
    });
    expect(JSON.stringify(body)).not.toContain("hunter2");
  });

  it("downloads the workbook byte-for-byte with the exact header set", async () => {
    const bytes = new Uint8Array([80, 75, 3, 4]);
    const response = priceWorkbookResponse({ filename: "laporan.xlsx", bytes });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      PRICE_CHANGES_NO_STORE["Cache-Control"]
    );
    expect(response.headers.get("content-type")).toBe(WORKBOOK_CONTENT_TYPE);
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="laporan.xlsx"'
    );
    expect(response.headers.get("content-length")).toBe("4");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
  });

  it("fails closed when the acting admin id is absent", () => {
    expect(() => requirePriceActorId(null)).toThrowError(PriceChangeError);
    try {
      requirePriceActorId(null);
    } catch (error) {
      expect((error as PriceChangeError).status).toBe(401);
      expect((error as PriceChangeError).code).toBe("UNAUTHENTICATED");
    }
    expect(requirePriceActorId("admin-1")).toBe("admin-1");
  });
});

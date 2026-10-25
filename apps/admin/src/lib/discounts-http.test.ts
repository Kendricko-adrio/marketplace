import { describe, expect, it } from "vitest";

import { getRequestId, withRequestContext } from "@/lib/logger";
import { DiscountAdministrationError } from "./discounts-administration";
import {
  discountErrorResponse,
  discountFailureResponse,
  discountSuccessResponse,
  requireActorId,
} from "./discounts-http";

// =========================================================
// Seam — discount administration HTTP envelope (no DB, no route)
// =========================================================
// The expectations are the HTTP contract the admin discount routes publish:
// `{ success, data }` on success, `{ success:false, error, code, requestId }`
// on failure, `Cache-Control: no-store` on every response, and the canonical
// request id of the active HTTP scope. They do not describe the implementation:
// the helpers take no logger, so there is nothing to assert about one.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("discount administration HTTP envelope", () => {
  it("keeps the success envelope and the no-store policy", async () => {
    const response = discountSuccessResponse({ id: "offer-1" });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      success: true,
      data: { id: "offer-1" },
    });
  });

  it("honours a caller-chosen success status", async () => {
    const response = discountSuccessResponse({ id: "offer-1" }, 201);

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      success: true,
      data: { id: "offer-1" },
    });
  });

  it("keeps the failure shape outside any HTTP scope (requestId null, no invented id)", async () => {
    // The facade's canonical id only exists inside a request scope; a helper
    // must not mint its own UUID per call.
    expect(getRequestId()).toBeNull();

    const response = discountErrorResponse(
      409,
      "STALE_REVISION",
      "Versi offer sudah berubah"
    );

    expect(response.status).toBe(409);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      success: false,
      error: "Versi offer sudah berubah",
      code: "STALE_REVISION",
      requestId: null,
    });
  });

  it("reports the canonical request id of the active scope in body and header", async () => {
    const handler = withRequestContext(async () =>
      discountErrorResponse(400, "INPUT_INVALID", "Invalid request body")
    );

    const response = await handler();
    const headerRequestId = response.headers.get("x-request-id");
    const body = (await response.json()) as { requestId: string };

    expect(headerRequestId).toMatch(UUID);
    expect(body.requestId).toBe(headerRequestId);
    // The scope is closed once the wrapped handler resolves.
    expect(getRequestId()).toBeNull();
  });

  it("maps a described domain denial onto its status and code", async () => {
    const response = discountFailureResponse(
      new DiscountAdministrationError(
        409,
        "STALE_REVISION",
        "Versi offer sudah berubah"
      ),
      "discounts.draft.failure"
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      success: false,
      error: "Versi offer sudah berubah",
      code: "STALE_REVISION",
      requestId: null,
    });
  });

  it("answers 500 INTERNAL for an unexpected error and never echoes its text", async () => {
    const response = discountFailureResponse(
      new Error("password=hunter2 host=db-internal"),
      "discounts.draft.failure"
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

  it("fails closed when the acting admin id is absent", () => {
    expect(() => requireActorId(null)).toThrowError(DiscountAdministrationError);
    expect(() => requireActorId(undefined)).toThrowError(
      DiscountAdministrationError
    );
    try {
      requireActorId(null);
    } catch (error) {
      expect((error as DiscountAdministrationError).status).toBe(401);
      expect((error as DiscountAdministrationError).code).toBe(
        "UNAUTHENTICATED"
      );
    }
    expect(requireActorId("admin-1")).toBe("admin-1");
  });
});

import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { proxy } from "./proxy";

/**
 * Login-return contract: the protected-route redirect must carry BOTH the
 * pathname and its query, otherwise `/checkout/result?order_id=...` loses the
 * order identity while the customer signs in and can never return to the same
 * result page. Cookie prefix, matcher, and access rules stay untouched.
 */
function callbackUrlFor(request: NextRequest): string | null {
  const response = proxy(request);
  const location = response.headers.get("location");
  if (!location) return null;
  return new URL(location).searchParams.get("callbackUrl");
}

describe("store proxy login-return", () => {
  it("keeps the query string of a protected page", () => {
    const request = new NextRequest(
      "http://localhost:3000/checkout/result?order_id=INV-42&transaction_status=pending"
    );
    expect(callbackUrlFor(request)).toBe(
      "/checkout/result?order_id=INV-42&transaction_status=pending"
    );
  });

  it("keeps a bare pathname unchanged", () => {
    const request = new NextRequest("http://localhost:3000/account");
    expect(callbackUrlFor(request)).toBe("/account");
  });

  it("does not redirect a public result page that carries the order id", () => {
    const request = new NextRequest(
      "http://localhost:3000/products?search=sepatu"
    );
    expect(proxy(request).headers.get("location")).toBeNull();
  });
});

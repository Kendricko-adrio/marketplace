import { describe, expect, it } from "vitest";
import {
  buildSalesOrderPayload,
  createJubelioSalesGateway,
  type JubelioSalesGateway,
} from "./jubelio-sales-client";
import type { Logger } from "./logger";

type RecordedRequest = {
  method: string;
  url: string;
  path: string;
  query?: string;
  body?: unknown;
  authorization?: string;
};

function stubFetch(
  handler: (
    request: RecordedRequest
  ) => Response | Promise<Response> | never
): { fetchImpl: typeof fetch; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = [];
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const body =
      typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    const request: RecordedRequest = {
      method: init.method ?? "GET",
      url: url.origin + url.pathname,
      path: url.pathname,
      query: url.search,
      body,
      authorization:
        typeof init.headers === "object" && init.headers !== null
          ? (init.headers as Record<string, string>).authorization
          : undefined,
    };
    requests.push(request);
    return handler(request);
  };
  return { fetchImpl, requests };
}

const passThroughScheduler = () => ({
  schedule: <T>(task: () => Promise<T>) => task(),
  activeCount: 0,
  queuedCount: 0,
});

type SchedulerStub = {
  schedule: <T>(
    task: () => Promise<T>,
    options?: { priority?: number }
  ) => Promise<T>;
  activeCount: number;
  queuedCount: number;
};

function makeGateway(overrides: {
  fetchImpl?: typeof fetch;
  scheduler?: SchedulerStub;
  env?: Record<string, string>;
  logger?: Logger;
}): JubelioSalesGateway {
  return createJubelioSalesGateway({
    env: overrides.env ?? {
      // Explicit, default-OFF opt-in: the sales gateway has no mock runtime,
      // so every behavior test drives the pinned live test-account runtime
      // with placeholder credentials over stubbed fetch.
      NODE_ENV: "development",
      JUBELIO_SALES_TEST_ACCOUNT_ENABLED: "true",
      JUBELIO_API_BASE_URL: "https://api2.jubelio.com",
      JUBELIO_EMAIL: "test-account@example.test",
      JUBELIO_PASSWORD: "test-account-placeholder-password",
    },
    fetchImpl:
      overrides.fetchImpl ??
      (async () => new Response("{}", { status: 200 }) as Response),
    scheduler: overrides.scheduler ?? passThroughScheduler(),
    logger: overrides.logger,
  });
}

const salesOrderItemInput = {
  itemId: 101187,
  quantity: 1,
  price: 1_300_000,
  discAmount: 0,
  taxAmount: 0,
  unit: "Buah",
  taxId: 1,
};

const salesOrderCreateInput = {
  contactId: -1,
  customerName: "Pelanggan Umum",
  locationId: 15,
  note: "OKCIR order note",
  items: [salesOrderItemInput],
};

function mockSalesOrderGet(orderId: number): Record<string, unknown> {
  return {
    salesorder_id: orderId,
    salesorder_no: `SO-${String(orderId).padStart(9, "0")}`,
    contact_id: -1,
    customer_name: "Pelanggan Umum",
    transaction_date: "2026-09-23T16:48:13.000Z",
    location_id: 15,
    source: 1,
    sub_total: 1_300_000,
    total_disc: 0,
    total_tax: 0,
    grand_total: 1_300_000,
    note: "OKCIR order note",
    ref_no: "",
    is_canceled: false,
    invoice_id: null,
    invoice_no: null,
    items: [
      {
        salesorder_detail_id: 0,
        item_id: 101187,
        qty_in_base: 1,
        price: 1_300_000,
        unit: "Buah",
        tax_id: 1,
        disc_amount: 0,
        tax_amount: 0,
        amount: 1_300_000,
        location_id: 15,
      },
    ],
  };
}

function canceledSnapshot(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return { ...mockSalesOrderGet(68378), is_canceled: true, ...overrides };
}

describe("resolveJubelioSalesRuntime (default-OFF fail-closed, pinned live hosts)", () => {
  it("allows an explicit non-production E2E loopback seam without enabling live writes", () => {
    const gateway = createJubelioSalesGateway({ env: {
      NODE_ENV: "development", E2E_PROVIDER_MOCKS: "true",
      JUBELIO_SALES_MOCK_API_BASE_URL: "http://127.0.0.1:3112",
      JUBELIO_SALES_TEST_ACCOUNT_ENABLED: "false",
    } });
    expect(gateway).toBeDefined();
  });

  it.each([undefined, "", "invalid"])("reports the E2E origin contract for a missing/malformed URL %s", (baseUrl) => {
    expect(() => createJubelioSalesGateway({ env: {
      NODE_ENV: "development", E2E_PROVIDER_MOCKS: "true", JUBELIO_SALES_MOCK_API_BASE_URL: baseUrl,
    } })).toThrow("E2E sales mock requires a bare HTTP loopback origin");
  });

  it.each(["https://api2.jubelio.com", "http://evil.test:3112", "http://127.0.0.1:3112/api", "http://user:pass@127.0.0.1:3112", "http://127.0.0.1:3112/?x=1"])("rejects unsafe E2E provider origin %s instead of falling back live", (baseUrl) => {
    expect(() => createJubelioSalesGateway({ env: {
      NODE_ENV: "development", E2E_PROVIDER_MOCKS: "true",
      JUBELIO_SALES_MOCK_API_BASE_URL: baseUrl,
      JUBELIO_SALES_TEST_ACCOUNT_ENABLED: "true", JUBELIO_API_BASE_URL: "https://api2.jubelio.com",
    } })).toThrow();
  });
  it.each([{ NODE_ENV: "production", APP_ENV: "production" }, { NODE_ENV: "development", APP_ENV: "production" }])("never unlocks E2E mocks in production %o", (environment) => {
    expect(() => createJubelioSalesGateway({ env: {
      ...environment, E2E_PROVIDER_MOCKS: "true", JUBELIO_SALES_MOCK_API_BASE_URL: "http://127.0.0.1:3112",
      JUBELIO_STOCK_WRITES_ENABLED: "true", JUBELIO_API_BASE_URL: "https://api2.jubelio.com",
    } })).toThrow(/forbidden in production/);
  });

  it("drives the full create flow through the pinned live test-account runtime with environment credentials", async () => {
    let loginBody: unknown;
    const { fetchImpl, requests } = stubFetch((request) => {
      if (request.path === "/login") {
        loginBody = request.body;
        return Response.json({ token: "test-account-token" });
      }
      if (request.path === "/sales/orders/" && request.method === "POST") {
        return Response.json({ id: 68378 });
      }
      if (request.path === "/sales/orders/68378") {
        return Response.json(mockSalesOrderGet(68378));
      }
      throw new Error(`Unexpected request: ${request.method} ${request.path}`);
    });
    // Placeholder credentials come from the environment; fetch is stubbed,
    // so no real Jubelio request is ever made.
    const gateway = makeGateway({ fetchImpl });

    const result = await gateway.createSalesOrder({
      ...salesOrderCreateInput,
      operationId: "op-1",
    });

    expect(result.salesOrderId).toBe(68378);
    expect(loginBody).toEqual({
      email: "test-account@example.test",
      password: "test-account-placeholder-password",
    });
    expect(requests[0].url).toBe("https://api2.jubelio.com/login");
    expect(requests.map((request) => `${request.method} ${request.path}`)).toEqual([
      "POST /login",
      "POST /sales/orders/",
      "GET /sales/orders/68378",
    ]);
    expect(requests[1].body).toMatchObject({
      salesorder_id: 0,
      salesorder_no: "[auto]",
      contact_id: -1,
      customer_name: "Pelanggan Umum",
      location_id: 15,
      source: 1,
      note: "OKCIR order note",
      items: [
        {
          item_id: 101187,
          qty_in_base: 1,
          price: 1_300_000,
          amount: 1_300_000,
          location_id: 15,
        },
      ],
    });
  });

  it("fails closed before any request outside production when the test-account opt-in is absent, even with a live URL configured", () => {
    const { fetchImpl, requests } = stubFetch(() => {
      throw new Error("fetch must never be called for a disabled sales gateway");
    });
    // A live Jubelio URL is configured, but the explicit opt-in is absent:
    // construction must fail closed instead of falling back to the mock.
    expect(() =>
      makeGateway({
        fetchImpl,
        env: {
          NODE_ENV: "development",
          JUBELIO_API_BASE_URL: "https://api2.jubelio.com",
        },
      })
    ).toThrow(/JUBELIO_SALES_TEST_ACCOUNT_ENABLED/);
    expect(requests).toHaveLength(0);
  });

  it("opts in to the real Jubelio test-account URL outside production only when the key is exactly 'true'", async () => {
    const { fetchImpl, requests } = stubFetch((request) => {
      if (request.path === "/login") {
        return Response.json({ token: "test-account-token" });
      }
      if (request.path === "/sales/orders/" && request.method === "POST") {
        return Response.json({ id: 68378 });
      }
      if (request.path === "/sales/orders/68378") {
        return Response.json(mockSalesOrderGet(68378));
      }
      throw new Error(`Unexpected request: ${request.method} ${request.path}`);
    });
    // Explicit, default-OFF opt-in with pinned https Jubelio host. The
    // credentials come from the environment (placeholder test values here);
    // fetch is stubbed, so no real Jubelio request is ever made.
    const gateway = makeGateway({
      fetchImpl,
      env: {
        NODE_ENV: "development",
        JUBELIO_SALES_TEST_ACCOUNT_ENABLED: "true",
        JUBELIO_API_BASE_URL: "https://api2.jubelio.com/",
        JUBELIO_EMAIL: "test-account@example.test",
        JUBELIO_PASSWORD: "test-account-placeholder-password",
      },
    });

    const result = await gateway.createSalesOrder({
      ...salesOrderCreateInput,
      operationId: "opt-on",
    });

    expect(result.salesOrderId).toBe(68378);
    expect(requests[0].url).toBe("https://api2.jubelio.com/login");
    expect(requests[0].body).toEqual({
      email: "test-account@example.test",
      password: "test-account-placeholder-password",
    });
  });

  it("treats any test-account opt-in value other than exactly 'true' as OFF and fails closed", () => {
    for (const offValue of ["TRUE", "1", "yes", "true ", "false", ""]) {
      const { fetchImpl, requests } = stubFetch(() => {
        throw new Error("fetch must never be called for a disabled sales gateway");
      });
      expect(() =>
        makeGateway({
          fetchImpl,
          env: {
            NODE_ENV: "development",
            JUBELIO_SALES_TEST_ACCOUNT_ENABLED: offValue,
            JUBELIO_API_BASE_URL: "https://api2.jubelio.com",
          },
        })
      ).toThrow(/JUBELIO_SALES_TEST_ACCOUNT_ENABLED/);
      expect(requests).toHaveLength(0);
    }
  });

  it("fails closed when the test-account opt-in is set without JUBELIO_API_BASE_URL", () => {
    expect(() =>
      createJubelioSalesGateway({
        env: {
          NODE_ENV: "development",
          JUBELIO_SALES_TEST_ACCOUNT_ENABLED: "true",
          // No JUBELIO_API_BASE_URL: refuse to guess any host.
        },
        fetchImpl: async () => new Response("{}", { status: 200 }),
      })
    ).toThrow(/JUBELIO_API_BASE_URL/);
  });

  it("fails closed when the opted-in test-account URL is not the bare pinned origin https://api2.jubelio.com", () => {
    for (const unsafeUrl of [
      "http://api2.jubelio.com",
      "https://evil.example.com",
      "https://api2.jubelio.com.evil.test",
      "not-a-url",
      // Only the bare origin is permitted: reject embedded credentials,
      // non-default ports, and any path/query/hash components.
      "https://user:pass@api2.jubelio.com",
      "https://api2.jubelio.com:8443",
      "https://api2.jubelio.com/api",
      "https://api2.jubelio.com/?source=env",
      "https://api2.jubelio.com/#token",
      "https://api2.jubelio.com/api?x=1#y",
    ]) {
      expect(() =>
        createJubelioSalesGateway({
          env: {
            NODE_ENV: "development",
            JUBELIO_SALES_TEST_ACCOUNT_ENABLED: "true",
            JUBELIO_API_BASE_URL: unsafeUrl,
          },
          fetchImpl: async () => new Response("{}", { status: 200 }),
        })
      ).toThrow(/api2\.jubelio\.com/);
    }
  });

  it("fails closed in production too when the live URL is not the bare pinned origin", () => {
    for (const unsafeUrl of [
      "https://user:pass@api2.jubelio.com",
      "https://api2.jubelio.com:8443",
      "https://api2.jubelio.com/api",
      "https://api2.jubelio.com/?x=1",
      "https://api2.jubelio.com/#y",
      "http://api2.jubelio.com",
    ]) {
      expect(() =>
        createJubelioSalesGateway({
          env: {
            APP_ENV: "production",
            NODE_ENV: "production",
            JUBELIO_STOCK_WRITES_ENABLED: "true",
            JUBELIO_API_BASE_URL: unsafeUrl,
          },
          fetchImpl: async () => new Response("{}", { status: 200 }),
        })
      ).toThrow(/api2\.jubelio\.com/);
    }
  });

  it("does not let the test-account opt-in bypass the production live-write guard", () => {
    expect(() =>
      createJubelioSalesGateway({
        env: {
          APP_ENV: "production",
          NODE_ENV: "production",
          JUBELIO_SALES_TEST_ACCOUNT_ENABLED: "true",
          JUBELIO_API_BASE_URL: "https://api2.jubelio.com",
          // JUBELIO_STOCK_WRITES_ENABLED deliberately absent.
        },
        fetchImpl: async () => new Response("{}", { status: 200 }),
      })
    ).toThrow("JUBELIO_STOCK_WRITES_ENABLED=true");
  });

  it("requires an explicit JUBELIO_API_BASE_URL in production instead of silently defaulting (P1-B)", () => {
    expect(() =>
      createJubelioSalesGateway({
        env: {
          APP_ENV: "production",
          NODE_ENV: "production",
          JUBELIO_STOCK_WRITES_ENABLED: "true",
          // JUBELIO_API_BASE_URL deliberately absent: no implicit default.
        },
        fetchImpl: async () => new Response("{}", { status: 200 }),
      })
    ).toThrow(/JUBELIO_API_BASE_URL/);
  });

  it("pins live mode and real credentials only for explicitly enabled production", () => {
    expect(() =>
      createJubelioSalesGateway({
        env: {
          APP_ENV: "production",
          NODE_ENV: "production",
          JUBELIO_API_BASE_URL: "https://api2.jubelio.com",
        },
        fetchImpl: async () => new Response("{}", { status: 200 }),
      })
    ).toThrow("JUBELIO_STOCK_WRITES_ENABLED=true");

    const gateway = createJubelioSalesGateway({
      env: {
        APP_ENV: "production",
        NODE_ENV: "production",
        JUBELIO_API_BASE_URL: "https://api2.jubelio.com/",
        JUBELIO_STOCK_WRITES_ENABLED: "true",
      },
      fetchImpl: async () => new Response("{}", { status: 200 }),
    });
    expect(gateway).toBeDefined();
  });
});

describe("buildSalesOrderPayload", () => {
  it("does not invent a channel marker absent from the persisted request", () => {
    const payload = buildSalesOrderPayload(salesOrderCreateInput);
    expect(payload).not.toHaveProperty("channel_status");
  });
  it("derives item and header totals from the evidenced zero-tax/zero-discount worked example", () => {
    // Worked example: 2 × 50_000 with no discount and no tax. This is the
    // only money shape the live canary (T0–T2, disc_amount=0, tax rate 0)
    // evidences; any other shape is rejected until proven in the sandbox.
    expect(
      buildSalesOrderPayload({
        contactId: 7,
        customerName: "Test Customer",
        locationId: 61,
        note: "note-1",
        refNo: "REF-1",
        transactionDate: new Date("2026-09-23T00:00:00.000Z"),
        items: [
          {
            itemId: 101187,
            quantity: 2,
            price: 50_000,
            discAmount: 0,
            taxAmount: 0,
            unit: "Buah",
            taxId: 1,
          },
        ],
      })
    ).toEqual({
      salesorder_id: 0,
      salesorder_no: "[auto]",
      contact_id: 7,
      customer_name: "Test Customer",
      transaction_date: "2026-09-23T00:00:00.000Z",
      is_tax_included: false,
      note: "note-1",
      ref_no: "REF-1",
      location_id: 61,
      source: 1,
      sub_total: 100_000,
      total_disc: 0,
      total_tax: 0,
      grand_total: 100_000,
      add_fee: 0,
      add_disc: 0,
      service_fee: 0,
      items: [
        {
          salesorder_detail_id: 0,
          item_id: 101187,
          qty_in_base: 2,
          price: 50_000,
          disc: 0,
          disc_amount: 0,
          tax_amount: 0,
          amount: 100_000,
          unit: "Buah",
          tax_id: 1,
          location_id: 61,
        },
      ],
    });
  });
});

describe("Jubelio sales gateway createSalesOrder", () => {
  it("includes Belum Bayar in the single create POST and reports marker-only divergence after the core GET", async () => {
    const { fetchImpl, requests } = stubFetch((request) => {
      if (request.path === "/login") return Response.json({ token: "stub-token" });
      if (request.path === "/sales/orders/" && request.method === "POST") return Response.json({ id: 68378 });
      if (request.path === "/sales/orders/68378" && request.method === "GET") {
        return Response.json({ ...mockSalesOrderGet(68378), channel_status: "Operator changed marker" });
      }
      throw new Error(`Unexpected request: ${request.method} ${request.path}`);
    });
    const result = await makeGateway({ fetchImpl }).createSalesOrder({
      ...salesOrderCreateInput, channelStatus: "Belum Bayar",
    });
    expect(requests.map(({ method, path }) => `${method} ${path}`)).toEqual([
      "POST /login", "POST /sales/orders/", "GET /sales/orders/68378",
    ]);
    expect(requests[1].body).toMatchObject({ channel_status: "Belum Bayar" });
    expect(result.order.channelStatus).toBe("Operator changed marker");
  });
  it("POSTs the sales order exactly once, parses the positive id and confirms the order by GET", async () => {
    const { fetchImpl, requests } = stubFetch((request) => {
      if (request.path === "/login") {
        return Response.json({ token: "mock-token" });
      }
      if (request.path === "/sales/orders/" && request.method === "POST") {
        return Response.json({ id: 68378 });
      }
      if (request.path === "/sales/orders/68378" && request.method === "GET") {
        return Response.json(mockSalesOrderGet(68378));
      }
      throw new Error(`Unexpected request: ${request.method} ${request.path}`);
    });
    const gateway = makeGateway({ fetchImpl });

    const result = await gateway.createSalesOrder({
      ...salesOrderCreateInput,
      operationId: "op-1",
    });

    expect(result).toEqual({
      salesOrderId: 68378,
      order: {
        salesorderId: 68378,
        salesorderNo: "SO-000068378",
        source: 1,
        refNo: "",
        contactId: -1,
        customerName: "Pelanggan Umum",
        locationId: 15,
        note: "OKCIR order note",
        isCanceled: false,
        invoiceId: null,
        channelStatus: null,
        subTotal: 1_300_000,
        totalDisc: 0,
        totalTax: 0,
        grandTotal: 1_300_000,
        items: [
          {
            itemId: 101187,
            quantity: 1,
            price: 1_300_000,
            amount: 1_300_000,
            unit: "Buah",
          },
        ],
      },
    });
    const posts = requests.filter(
      (request) => request.method === "POST" && request.path === "/sales/orders/"
    );
    expect(posts).toHaveLength(1);
    const confirmations = requests.filter(
      (request) => request.method === "GET" && request.path === "/sales/orders/68378"
    );
    expect(confirmations).toHaveLength(1);
  });
});
describe("Jubelio sales gateway create ambiguity safety", () => {
  it("treats a 500 create response as ambiguous and never repeats the POST or probes an undocumented list fallback", async () => {
    const { fetchImpl, requests } = stubFetch((request) => {
      if (request.path === "/login") {
        return Response.json({ token: "mock-token" });
      }
      if (request.path === "/sales/orders/" && request.method === "POST") {
        return Response.json(
          { statusCode: "500", error: "Internal Server Error", code: "23100" },
          { status: 500 }
        );
      }
      throw new Error(`Unexpected request: ${request.method} ${request.path}${request.query ?? ""}`);
    });
    const gateway = makeGateway({ fetchImpl });

    await expect(
      gateway.createSalesOrder({ ...salesOrderCreateInput, operationId: "op-1" })
    ).rejects.toMatchObject({
      name: "JubelioSalesGatewayError",
      options: { ambiguous: true, retryable: false },
    });

    const createPosts = requests.filter(
      (request) => request.method === "POST" && request.path === "/sales/orders/"
    );
    expect(createPosts).toHaveLength(1);
    // No undocumented `GET /sales/orders/?q=note` reconciliation fallback.
    expect(
      requests.filter((request) => request.method === "GET")
    ).toHaveLength(0);
  });

  it("treats a timeout before a create response as ambiguous without repeating the POST", async () => {
    const { fetchImpl, requests } = stubFetch((request) => {
      if (request.path === "/login") {
        return Response.json({ token: "mock-token" });
      }
      if (request.path === "/sales/orders/" && request.method === "POST") {
        return Promise.reject(new DOMException("This operation was aborted", "TimeoutError"));
      }
      throw new Error(`Unexpected request: ${request.method} ${request.path}`);
    });
    const gateway = makeGateway({ fetchImpl });

    await expect(
      gateway.createSalesOrder({ ...salesOrderCreateInput, operationId: "op-2" })
    ).rejects.toMatchObject({
      options: { ambiguous: true, retryable: false },
    });
    expect(
      requests.filter((request) => request.method === "POST" && request.path === "/sales/orders/")
    ).toHaveLength(1);
  });

  it("treats a 2xx create response without a positive id as ambiguous and never repeats the POST", async () => {
    const { fetchImpl, requests } = stubFetch((request) => {
      if (request.path === "/login") {
        return Response.json({ token: "mock-token" });
      }
      if (request.path === "/sales/orders/" && request.method === "POST") {
        // Mock's "malformed-success-after-apply" scenario shape: the write has
        // been applied remotely but no id was returned.
        return Response.json({ status: "ok" });
      }
      throw new Error(`Unexpected request: ${request.method} ${request.path}`);
    });
    const gateway = makeGateway({ fetchImpl });

    await expect(
      gateway.createSalesOrder({ ...salesOrderCreateInput, operationId: "op-3" })
    ).rejects.toMatchObject({
      message: expect.stringContaining("positive id"),
      options: { ambiguous: true, retryable: false, httpStatus: 200 },
    });
    expect(
      requests.filter(
        (request) => request.method === "POST" && request.path === "/sales/orders/"
      )
    ).toHaveLength(1);
    expect(requests.filter((request) => request.method === "GET")).toHaveLength(0);
  });

  it("treats a non-positive create id (0, negative, non-numeric) as ambiguous without a confirmation read", async () => {
    for (const malformed of [0, -5, "68378abc"]) {
      const { fetchImpl, requests } = stubFetch((request) => {
        if (request.path === "/login") {
          return Response.json({ token: "mock-token" });
        }
        if (request.path === "/sales/orders/" && request.method === "POST") {
          return Response.json({ id: malformed });
        }
        throw new Error(`Unexpected request: ${request.method} ${request.path}`);
      });
      const gateway = makeGateway({ fetchImpl });
      await expect(
        gateway.createSalesOrder({ ...salesOrderCreateInput, operationId: "op-4" })
      ).rejects.toMatchObject({ options: { ambiguous: true } });
      expect(requests.filter((request) => request.method === "GET")).toHaveLength(0);
    }
  });

  it("does not repeat the create POST on 401 and reports a definite rejection", async () => {
    const { fetchImpl, requests } = stubFetch((request) => {
      if (request.path === "/login") {
        return Response.json({ token: "mock-token" });
      }
      if (request.path === "/sales/orders/" && request.method === "POST") {
        return Response.json({ statusCode: "401", error: "Unauthorized" }, { status: 401 });
      }
      throw new Error(`Unexpected request: ${request.method} ${request.path}`);
    });
    const gateway = makeGateway({ fetchImpl });

    await expect(
      gateway.createSalesOrder({ ...salesOrderCreateInput, operationId: "op-5" })
    ).rejects.toMatchObject({
      options: { ambiguous: false, retryable: false, httpStatus: 401 },
    });
    expect(
      requests.filter((request) => request.method === "POST" && request.path === "/sales/orders/")
    ).toHaveLength(1);
  });

  it("does not repeat the create POST on 429; the caller may retry deliberately later", async () => {
    const { fetchImpl, requests } = stubFetch((request) => {
      if (request.path === "/login") {
        return Response.json({ token: "mock-token" });
      }
      if (request.path === "/sales/orders/" && request.method === "POST") {
        return Response.json({ statusCode: "429", error: "Too Many Requests" }, { status: 429 });
      }
      throw new Error(`Unexpected request: ${request.method} ${request.path}`);
    });
    const gateway = makeGateway({ fetchImpl });

    await expect(
      gateway.createSalesOrder({ ...salesOrderCreateInput, operationId: "op-6" })
    ).rejects.toMatchObject({
      options: { ambiguous: false, retryable: true, httpStatus: 429 },
    });
    expect(
      requests.filter((request) => request.method === "POST" && request.path === "/sales/orders/")
    ).toHaveLength(1);
  });

  it("reports an ambiguous error when the confirmation GET shows a different order", async () => {
    const { fetchImpl, requests } = stubFetch((request) => {
      if (request.path === "/login") {
        return Response.json({ token: "mock-token" });
      }
      if (request.path === "/sales/orders/" && request.method === "POST") {
        return Response.json({ id: 68378 });
      }
      if (request.path === "/sales/orders/68378" && request.method === "GET") {
        const confirmed = mockSalesOrderGet(68378) as Record<string, unknown>;
        // Remote state diverges from the requested order.
        return Response.json({ ...confirmed, location_id: 99 });
      }
      throw new Error(`Unexpected request: ${request.method} ${request.path}`);
    });
    const gateway = makeGateway({ fetchImpl });

    await expect(
      gateway.createSalesOrder({ ...salesOrderCreateInput, operationId: "op-7" })
    ).rejects.toMatchObject({
      message: expect.stringContaining("location"),
      options: { ambiguous: true, retryable: false },
    });
    expect(
      requests.filter((request) => request.method === "POST" && request.path === "/sales/orders/")
    ).toHaveLength(1);
  });

  it("reports an ambiguous error when the confirmation GET fails after the create POST", async () => {
    const { fetchImpl, requests } = stubFetch((request) => {
      if (request.path === "/login") {
        return Response.json({ token: "mock-token" });
      }
      if (request.path === "/sales/orders/" && request.method === "POST") {
        return Response.json({ id: 68378 });
      }
      if (request.path === "/sales/orders/68378" && request.method === "GET") {
        return Response.json({ statusCode: "500" }, { status: 500 });
      }
      throw new Error(`Unexpected request: ${request.method} ${request.path}`);
    });
    const gateway = makeGateway({ fetchImpl });

    await expect(
      gateway.createSalesOrder({ ...salesOrderCreateInput, operationId: "op-8" })
    ).rejects.toMatchObject({ options: { ambiguous: true, retryable: false } });
    expect(
      requests.filter(
        (request) => request.method === "POST" && request.path === "/sales/orders/"
      )
    ).toHaveLength(1);
  });
});

describe("Jubelio sales gateway post-apply body-read failure (P1-A)", () => {
  const unreadableResponse = {
    status: 200,
    ok: true,
    text: () => Promise.reject(new Error("response stream failed after delivery")),
  } as unknown as Response;

  it("classifies a 2xx create response whose body cannot be read as ambiguous and never repeats the POST", async () => {
    const { fetchImpl, requests } = stubFetch((request) => {
      if (request.path === "/login") {
        return Response.json({ token: "test-account-token" });
      }
      if (request.path === "/sales/orders/" && request.method === "POST") {
        // The response arrived (the write may be applied) but its body is
        // unreadable: the outcome is unknown, not a definite failure.
        return Promise.resolve(unreadableResponse);
      }
      throw new Error(`Unexpected request: ${request.method} ${request.path}`);
    });
    const gateway = makeGateway({ fetchImpl });

    await expect(
      gateway.createSalesOrder({ ...salesOrderCreateInput, operationId: "bodyread-1" })
    ).rejects.toMatchObject({
      name: "JubelioSalesGatewayError",
      options: { ambiguous: true, retryable: false },
    });
    expect(
      requests.filter((request) => request.method === "POST" && request.path === "/sales/orders/")
    ).toHaveLength(1);
    // No undocumented reconciliation fallback for an unconfirmed create.
    expect(requests.filter((request) => request.method === "GET")).toHaveLength(0);
  });

  it("reconciles a cancel whose 2xx body read fails with an independent GET of the known sales order", async () => {
    const { fetchImpl, requests } = stubFetch((request) => {
      if (request.path === "/login") {
        return Response.json({ token: "test-account-token" });
      }
      if (request.path === "/sales/orders/68378" && request.method === "GET") {
        return Response.json(
          requests.some(
            (candidate) =>
              candidate.method === "POST" && candidate.path === "/sales/orders/cancel/"
          )
            ? canceledSnapshot()
            : mockSalesOrderGet(68378)
        );
      }
      if (request.path === "/sales/orders/cancel/" && request.method === "POST") {
        return Promise.resolve(unreadableResponse);
      }
      throw new Error(`Unexpected request: ${request.method} ${request.path}`);
    });
    const gateway = makeGateway({ fetchImpl });

    const result = await gateway.cancelSalesOrder({
      salesOrderId: 68378,
      operationId: "bodyread-2",
    });

    expect(result.order.isCanceled).toBe(true);
    expect(result.alreadyCanceled).toBe(false);
    expect(
      requests.filter(
        (request) => request.method === "POST" && request.path === "/sales/orders/cancel/"
      )
    ).toHaveLength(1);
    // Pre-cancel read + post-apply reconciliation GET of the known SO id.
    expect(
      requests.filter(
        (request) => request.method === "GET" && request.path === "/sales/orders/68378"
      )
    ).toHaveLength(2);
  });
});

describe("Jubelio sales gateway cancelSalesOrder", () => {
  it("reads pre-invoice state, POSTs the cancel exactly once and confirms is_canceled by GET", async () => {
    const { fetchImpl, requests } = stubFetch((request) => {
      if (request.path === "/login") {
        return Response.json({ token: "mock-token" });
      }
      if (request.path === "/sales/orders/68378" && request.method === "GET") {
        // First read: pre-invoice; second read: canceled.
        return Response.json(
          requests.some(
            (candidate) =>
              candidate.method === "POST" && candidate.path === "/sales/orders/cancel/"
          )
            ? canceledSnapshot()
            : mockSalesOrderGet(68378)
        );
      }
      if (request.path === "/sales/orders/cancel/" && request.method === "POST") {
        return Response.json({ status: "ok" });
      }
      throw new Error(`Unexpected request: ${request.method} ${request.path}`);
    });
    const gateway = makeGateway({ fetchImpl });

    const result = await gateway.cancelSalesOrder({ salesOrderId: 68378 });

    expect(result.salesOrderId).toBe(68378);
    expect(result.alreadyCanceled).toBe(false);
    expect(result.order.isCanceled).toBe(true);
    const cancelPosts = requests.filter(
      (request) => request.method === "POST" && request.path === "/sales/orders/cancel/"
    );
    expect(cancelPosts).toHaveLength(1);
    expect(cancelPosts[0].body).toEqual({ ids: [68378] });
    expect(
      requests.filter(
        (request) => request.method === "GET" && request.path === "/sales/orders/68378"
      )
    ).toHaveLength(2);
  });

  it("does not POST a cancel when the pre-cancel GET already shows is_canceled", async () => {
    const { fetchImpl, requests } = stubFetch((request) => {
      if (request.path === "/login") {
        return Response.json({ token: "mock-token" });
      }
      if (request.path === "/sales/orders/68378" && request.method === "GET") {
        return Response.json(canceledSnapshot());
      }
      throw new Error(`Unexpected request: ${request.method} ${request.path}`);
    });
    const gateway = makeGateway({ fetchImpl });

    const result = await gateway.cancelSalesOrder({ salesOrderId: 68378 });

    expect(result.alreadyCanceled).toBe(true);
    expect(result.order.isCanceled).toBe(true);
    expect(
      requests.filter(
        (request) => request.method === "POST" && request.path === "/sales/orders/cancel/"
      )
    ).toHaveLength(0);
  });

  it("refuses to cancel an invoiced sales order without any POST", async () => {
    const { fetchImpl, requests } = stubFetch((request) => {
      if (request.path === "/login") {
        return Response.json({ token: "mock-token" });
      }
      if (request.path === "/sales/orders/68378" && request.method === "GET") {
        return Response.json(
          { ...mockSalesOrderGet(68378), invoice_id: 222, invoice_no: "INV-000000222" }
        );
      }
      throw new Error(`Unexpected request: ${request.method} ${request.path}`);
    });
    const gateway = makeGateway({ fetchImpl });

    await expect(gateway.cancelSalesOrder({ salesOrderId: 68378 })).rejects.toMatchObject({
      message: expect.stringContaining("invoice"),
      options: { ambiguous: false, retryable: false },
    });
    expect(requests.filter((request) => request.method === "POST")).toHaveLength(1);
    expect(
      requests.filter(
        (request) => request.method === "POST" && request.path === "/sales/orders/cancel/"
      )
    ).toHaveLength(0);
  });

  it("does not POST a cancel for an unknown sales order", async () => {
    const { fetchImpl, requests } = stubFetch((request) => {
      if (request.path === "/login") {
        return Response.json({ token: "mock-token" });
      }
      if (request.path === "/sales/orders/99999" && request.method === "GET") {
        return Response.json({ statusCode: "404", code: "E000001" }, { status: 404 });
      }
      throw new Error(`Unexpected request: ${request.method} ${request.path}`);
    });
    const gateway = makeGateway({ fetchImpl });

    await expect(gateway.cancelSalesOrder({ salesOrderId: 99999 })).rejects.toMatchObject({
      options: { ambiguous: false, httpStatus: 404 },
    });
    expect(
      requests.filter(
        (request) => request.method === "POST" && request.path === "/sales/orders/cancel/"
      )
    ).toHaveLength(0);
  });

  it("reconciles an ambiguous (500) cancel POST with one confirmation GET instead of repeating it", async () => {
    // Mock "timeout-after-apply" shape: the cancellation was applied, the
    // client saw a server error, and only a GET can reveal the outcome.
    const { fetchImpl, requests } = stubFetch((request) => {
      if (request.path === "/login") {
        return Response.json({ token: "mock-token" });
      }
      if (request.path === "/sales/orders/68378" && request.method === "GET") {
        return Response.json(
          requests.some(
            (candidate) =>
              candidate.method === "POST" && candidate.path === "/sales/orders/cancel/"
          )
            ? canceledSnapshot()
            : mockSalesOrderGet(68378)
        );
      }
      if (request.path === "/sales/orders/cancel/" && request.method === "POST") {
        return Response.json(
          { statusCode: "500", error: "Internal Server Error" },
          { status: 500 }
        );
      }
      throw new Error(`Unexpected request: ${request.method} ${request.path}`);
    });
    const gateway = makeGateway({ fetchImpl });

    const result = await gateway.cancelSalesOrder({ salesOrderId: 68378 });

    expect(result.order.isCanceled).toBe(true);
    expect(result.alreadyCanceled).toBe(false);
    expect(
      requests.filter(
        (request) => request.method === "POST" && request.path === "/sales/orders/cancel/"
      )
    ).toHaveLength(1);
  });

  it("never retries cancel when its post-send confirmation GET fails", async () => {
    const { fetchImpl, requests } = stubFetch((request) => {
      if (request.path === "/login") return Response.json({ token: "test-token" });
      if (request.path === "/sales/orders/68378" && request.method === "GET") {
        if (requests.some((entry) => entry.path === "/sales/orders/cancel/")) {
          throw new Error("confirmation GET unavailable");
        }
        return Response.json(mockSalesOrderGet(68378));
      }
      if (request.path === "/sales/orders/cancel/" && request.method === "POST") {
        return Response.json({ status: "ok" });
      }
      throw new Error(`Unexpected request: ${request.method} ${request.path}`);
    });
    await expect(makeGateway({ fetchImpl }).cancelSalesOrder({ salesOrderId: 68378 }))
      .rejects.toMatchObject({ options: { ambiguous: true, retryable: false } });
    expect(requests.filter((entry) => entry.path === "/sales/orders/cancel/")).toHaveLength(1);
  });

  it("reports an ambiguous cancel when the POST outcome is unknown and the confirmation GET shows the order still active", async () => {
    const { fetchImpl, requests } = stubFetch((request) => {
      if (request.path === "/login") {
        return Response.json({ token: "mock-token" });
      }
      if (request.path === "/sales/orders/68378" && request.method === "GET") {
        return Response.json(mockSalesOrderGet(68378));
      }
      if (request.path === "/sales/orders/cancel/" && request.method === "POST") {
        return Promise.reject(new DOMException("This operation was aborted", "TimeoutError"));
      }
      throw new Error(`Unexpected request: ${request.method} ${request.path}`);
    });
    const gateway = makeGateway({ fetchImpl });

    await expect(gateway.cancelSalesOrder({ salesOrderId: 68378 })).rejects.toMatchObject({
      message: expect.stringContaining("ambiguous"),
      options: { ambiguous: true, retryable: false },
    });
    expect(
      requests.filter(
        (request) => request.method === "POST" && request.path === "/sales/orders/cancel/"
      )
    ).toHaveLength(1);
  });

  it("reports an ambiguous cancel when the cancel POST returns a malformed 2xx body", async () => {
    // Mock "malformed-success-after-apply" shape for cancel: empty object.
    const { fetchImpl, requests } = stubFetch((request) => {
      if (request.path === "/login") {
        return Response.json({ token: "mock-token" });
      }
      if (request.path === "/sales/orders/68378" && request.method === "GET") {
        return Response.json(mockSalesOrderGet(68378));
      }
      if (request.path === "/sales/orders/cancel/" && request.method === "POST") {
        return Response.json({});
      }
      throw new Error(`Unexpected request: ${request.method} ${request.path}`);
    });
    const gateway = makeGateway({ fetchImpl });

    await expect(gateway.cancelSalesOrder({ salesOrderId: 68378 })).rejects.toMatchObject({
      options: { ambiguous: true, retryable: false },
    });
    expect(
      requests.filter(
        (request) => request.method === "POST" && request.path === "/sales/orders/cancel/"
      )
    ).toHaveLength(1);
  });

  it("reports a definite rejection without a confirmation read when the cancel POST is rate-limited (429)", async () => {
    const { fetchImpl, requests } = stubFetch((request) => {
      if (request.path === "/login") {
        return Response.json({ token: "mock-token" });
      }
      if (request.path === "/sales/orders/68378" && request.method === "GET") {
        return Response.json(mockSalesOrderGet(68378));
      }
      if (request.path === "/sales/orders/cancel/" && request.method === "POST") {
        return Response.json({ statusCode: "429" }, { status: 429 });
      }
      throw new Error(`Unexpected request: ${request.method} ${request.path}`);
    });
    const gateway = makeGateway({ fetchImpl });

    await expect(gateway.cancelSalesOrder({ salesOrderId: 68378 })).rejects.toMatchObject({
      options: { ambiguous: false, retryable: true, httpStatus: 429 },
    });
    expect(
      requests.filter(
        (request) =>
          request.method === "GET" && request.path === "/sales/orders/68378"
      )
    ).toHaveLength(1);
  });
});

describe("Jubelio sales gateway pre-POST failures are never ambiguous", () => {
  it("rejects duplicate item ids before login or a sales-order write", async () => {
    const { fetchImpl, requests } = stubFetch(() => {
      throw new Error("no HTTP request is allowed for duplicate line items");
    });
    const gateway = makeGateway({ fetchImpl });
    await expect(gateway.createSalesOrder({
      ...salesOrderCreateInput,
      items: [salesOrderItemInput, { ...salesOrderItemInput, quantity: 1 }],
    })).rejects.toMatchObject({
      options: { ambiguous: false, retryable: false },
    });
    expect(requests).toHaveLength(0);
  });
  it("classifies a login 500 during create as a non-ambiguous, retryable failure and never POSTs the sales order", async () => {
    const { fetchImpl, requests } = stubFetch((request) => {
      if (request.path === "/login") {
        return Response.json(
          { statusCode: "500", error: "Internal Server Error" },
          { status: 500 }
        );
      }
      throw new Error(`Unexpected request: ${request.method} ${request.path}`);
    });
    const gateway = makeGateway({ fetchImpl });

    await expect(
      gateway.createSalesOrder({ ...salesOrderCreateInput, operationId: "pre-1" })
    ).rejects.toMatchObject({
      options: { ambiguous: false, retryable: true },
    });
    // Only the login POST happened; no sales-order POST was ever sent.
    expect(requests.map((request) => `${request.method} ${request.path}`)).toEqual([
      "POST /login",
    ]);
  });

  it("classifies missing Jubelio credentials as a non-ambiguous failure with no request at all", async () => {
    const { fetchImpl, requests } = stubFetch(() => {
      throw new Error("fetch must never be called for an unconfigured gateway");
    });
    const gateway = createJubelioSalesGateway({
      env: {
        APP_ENV: "production",
        NODE_ENV: "production",
        JUBELIO_API_BASE_URL: "https://api2.jubelio.com/",
        JUBELIO_STOCK_WRITES_ENABLED: "true",
        // No JUBELIO_EMAIL / JUBELIO_PASSWORD: pure configuration failure.
      },
      fetchImpl,
      scheduler: passThroughScheduler(),
    });

    await expect(
      gateway.createSalesOrder({ ...salesOrderCreateInput, operationId: "pre-2" })
    ).rejects.toMatchObject({
      message: expect.stringContaining("not configured"),
      options: { ambiguous: false, retryable: false },
    });
    expect(requests).toHaveLength(0);
  });

  it("classifies a login network timeout as a non-ambiguous failure and never POSTs the sales order", async () => {
    const { fetchImpl, requests } = stubFetch((request) => {
      if (request.path === "/login") {
        return Promise.reject(
          new DOMException("This operation was aborted", "TimeoutError")
        );
      }
      throw new Error(`Unexpected request: ${request.method} ${request.path}`);
    });
    const gateway = makeGateway({ fetchImpl });

    await expect(
      gateway.createSalesOrder({ ...salesOrderCreateInput, operationId: "pre-3" })
    ).rejects.toMatchObject({
      options: { ambiguous: false, retryable: true },
    });
    expect(
      requests.filter(
        (request) =>
          request.method === "POST" && request.path === "/sales/orders/"
      )
    ).toHaveLength(0);
  });

  it("classifies a pre-send login failure during cancel as non-ambiguous without a reconciliation read", async () => {
    const { fetchImpl, requests } = stubFetch((request) => {
      if (request.path === "/login") {
        return Response.json(
          { statusCode: "500", error: "Internal Server Error" },
          { status: 500 }
        );
      }
      throw new Error(`Unexpected request: ${request.method} ${request.path}`);
    });
    const gateway = makeGateway({ fetchImpl });

    await expect(
      gateway.cancelSalesOrder({ salesOrderId: 68378 })
    ).rejects.toMatchObject({
      options: { ambiguous: false, retryable: true },
    });
    expect(
      requests.filter(
        (request) =>
          request.method === "POST" && request.path === "/sales/orders/cancel/"
      )
    ).toHaveLength(0);
  });
});

describe("Jubelio sales gateway input validation (before any POST)", () => {
  const invalidCases: Array<[string, Record<string, unknown>]> = [
    ["an empty item list", { items: [] }],
    ["a NaN price", { items: [{ ...salesOrderItemInput, price: NaN }] }],
    [
      "an Infinite tax amount",
      { items: [{ ...salesOrderItemInput, taxAmount: Infinity }] },
    ],
    [
      "a negative discount amount",
      { items: [{ ...salesOrderItemInput, discAmount: -1 }] },
    ],
    ["a zero quantity", { items: [{ ...salesOrderItemInput, quantity: 0 }] }],
    [
      "a fractional quantity",
      { items: [{ ...salesOrderItemInput, quantity: 1.5 }] },
    ],
    ["a negative price", { items: [{ ...salesOrderItemInput, price: -1 }] }],
    [
      "a non-positive item id",
      { items: [{ ...salesOrderItemInput, itemId: 0 }] },
    ],
    ["a non-integer location id", { locationId: 15.5 }],
    ["a non-finite contact id", { contactId: NaN }],
    ["an empty customer name", { customerName: "" }],
    ["an empty operation note", { note: "" }],
    ["a non-finite tax id", { items: [{ ...salesOrderItemInput, taxId: NaN }] }],
    ["an empty unit", { items: [{ ...salesOrderItemInput, unit: "" }] }],
  ];

  for (const [label, override] of invalidCases) {
    it(`rejects ${label} before any request`, async () => {
      const { fetchImpl, requests } = stubFetch(() =>
        Response.json({ token: "must-never-be-fetched" })
      );
      const gateway = makeGateway({ fetchImpl });

      await expect(
        gateway.createSalesOrder({
          ...salesOrderCreateInput,
          ...override,
          operationId: "validate",
        })
      ).rejects.toMatchObject({
        name: "JubelioSalesGatewayError",
        options: { ambiguous: false, retryable: false },
      });
      // Not even the login: the request is invalid before anything is sent.
      expect(requests).toHaveLength(0);
    });
  }

  it("fail-closes on a nonzero discount amount until the money formula is evidenced", async () => {
    const { fetchImpl, requests } = stubFetch(() =>
      Response.json({ token: "must-never-be-fetched" })
    );
    const gateway = makeGateway({ fetchImpl });

    await expect(
      gateway.createSalesOrder({
        ...salesOrderCreateInput,
        items: [{ ...salesOrderItemInput, discAmount: 10_000 }],
        operationId: "money-disc",
      })
    ).rejects.toMatchObject({
      message: expect.stringContaining("discount"),
      options: { ambiguous: false, retryable: false },
    });
    expect(requests).toHaveLength(0);
  });

  it("fail-closes on a nonzero tax amount until the money formula is evidenced", async () => {
    const { fetchImpl, requests } = stubFetch(() =>
      Response.json({ token: "must-never-be-fetched" })
    );
    const gateway = makeGateway({ fetchImpl });

    await expect(
      gateway.createSalesOrder({
        ...salesOrderCreateInput,
        items: [{ ...salesOrderItemInput, taxAmount: 5_000 }],
        operationId: "money-tax",
      })
    ).rejects.toMatchObject({
      message: expect.stringContaining("tax"),
      options: { ambiguous: false, retryable: false },
    });
    expect(requests).toHaveLength(0);
  });
});

describe("Jubelio sales gateway confirmation money verification", () => {
  it("reports an ambiguous mismatch when the confirmation GET shows a different item price", async () => {
    const { fetchImpl, requests } = stubFetch((request) => {
      if (request.path === "/login") {
        return Response.json({ token: "mock-token" });
      }
      if (request.path === "/sales/orders/" && request.method === "POST") {
        return Response.json({ id: 68378 });
      }
      if (request.path === "/sales/orders/68378" && request.method === "GET") {
        const confirmed = mockSalesOrderGet(68378) as Record<string, unknown>;
        const confirmedItems = confirmed.items as Array<Record<string, unknown>>;
        return Response.json({ ...confirmed, items: [{ ...confirmedItems[0], price: 999_999 }] });
      }
      throw new Error(`Unexpected request: ${request.method} ${request.path}`);
    });
    const gateway = makeGateway({ fetchImpl });

    await expect(
      gateway.createSalesOrder({ ...salesOrderCreateInput, operationId: "money-price" })
    ).rejects.toMatchObject({
      message: expect.stringContaining("price"),
      options: { ambiguous: true, retryable: false },
    });
    expect(
      requests.filter(
        (request) =>
          request.method === "POST" && request.path === "/sales/orders/"
      )
    ).toHaveLength(1);
  });

  it("reports an ambiguous mismatch when the confirmation GET shows a different item amount", async () => {
    const { fetchImpl } = stubFetch((request) => {
      if (request.path === "/login") {
        return Response.json({ token: "mock-token" });
      }
      if (request.path === "/sales/orders/" && request.method === "POST") {
        return Response.json({ id: 68378 });
      }
      if (request.path === "/sales/orders/68378" && request.method === "GET") {
        const confirmed = mockSalesOrderGet(68378) as Record<string, unknown>;
        const confirmedItems = confirmed.items as Array<Record<string, unknown>>;
        return Response.json({ ...confirmed, items: [{ ...confirmedItems[0], amount: 1_400_000 }] });
      }
      throw new Error(`Unexpected request: ${request.method} ${request.path}`);
    });
    const gateway = makeGateway({ fetchImpl });

    await expect(
      gateway.createSalesOrder({ ...salesOrderCreateInput, operationId: "money-amount" })
    ).rejects.toMatchObject({
      message: expect.stringContaining("amount"),
      options: { ambiguous: true, retryable: false },
    });
  });

  it("reports an ambiguous mismatch when the confirmation GET header totals diverge from the requested order", async () => {
    const { fetchImpl, requests } = stubFetch((request) => {
      if (request.path === "/login") {
        return Response.json({ token: "mock-token" });
      }
      if (request.path === "/sales/orders/" && request.method === "POST") {
        return Response.json({ id: 68378 });
      }
      if (request.path === "/sales/orders/68378" && request.method === "GET") {
        const confirmed = mockSalesOrderGet(68378) as Record<string, unknown>;
        return Response.json({ ...confirmed, grand_total: 1_500_000 });
      }
      throw new Error(`Unexpected request: ${request.method} ${request.path}`);
    });
    const gateway = makeGateway({ fetchImpl });

    await expect(
      gateway.createSalesOrder({ ...salesOrderCreateInput, operationId: "money-header" })
    ).rejects.toMatchObject({
      message: expect.stringContaining("grand total"),
      options: { ambiguous: true, retryable: false },
    });
    expect(
      requests.filter(
        (request) =>
          request.method === "POST" && request.path === "/sales/orders/"
      )
    ).toHaveLength(1);
  });

  it("reports an ambiguous mismatch when the confirmation GET shows an empty item list", async () => {
    const { fetchImpl } = stubFetch((request) => {
      if (request.path === "/login") {
        return Response.json({ token: "mock-token" });
      }
      if (request.path === "/sales/orders/" && request.method === "POST") {
        return Response.json({ id: 68378 });
      }
      if (request.path === "/sales/orders/68378" && request.method === "GET") {
        const confirmed = mockSalesOrderGet(68378) as Record<string, unknown>;
        return Response.json({ ...confirmed, items: [] });
      }
      throw new Error(`Unexpected request: ${request.method} ${request.path}`);
    });
    const gateway = makeGateway({ fetchImpl });

    await expect(
      gateway.createSalesOrder({ ...salesOrderCreateInput, operationId: "money-empty" })
    ).rejects.toMatchObject({
      options: { ambiguous: true, retryable: false },
    });
  });
});

describe("Jubelio sales gateway reads, backpressure and logging", () => {
  it("schedules cancel above reads and create through the shared scheduler", async () => {
    const scheduledPriorities: number[] = [];
    const { fetchImpl } = stubFetch((request) => {
      if (request.path === "/login") {
        return Response.json({ token: "mock-token" });
      }
      if (request.path === "/sales/orders/68378" && request.method === "GET") {
        return Response.json(
          scheduledPriorities.includes(10)
            ? canceledSnapshot()
            : mockSalesOrderGet(68378)
        );
      }
      if (request.path === "/sales/orders/cancel/" && request.method === "POST") {
        return Response.json({ status: "ok" });
      }
      throw new Error(`Unexpected request: ${request.method} ${request.path}`);
    });
    const gateway = makeGateway({
      fetchImpl,
      scheduler: {
        schedule: (task, options) => {
          scheduledPriorities.push(options?.priority ?? 0);
          return task();
        },
        activeCount: 0,
        queuedCount: 0,
      },
    });

    await gateway.getSalesOrder(68378);
    await gateway.cancelSalesOrder({ salesOrderId: 68378 });

    // One scheduled request per HTTP call: login(5), read(5), pre-cancel
    // read(5), cancel POST(10), confirmation read(5).
    expect(scheduledPriorities).toEqual([5, 5, 5, 10, 5]);
  });

  it("re-authenticates and repeats only the READ on a 401, never a POST", async () => {
    // Realistic stale-token flow: the first login hands out a token the API
    // rejects with 401; only the re-login returns the accepted token.
    let logins = 0;
    const { fetchImpl, requests } = stubFetch((request) => {
      if (request.path === "/login") {
        logins += 1;
        return Response.json({ token: logins === 1 ? "stale-token" : "fresh-token" });
      }
      if (request.path === "/sales/orders/68378" && request.method === "GET") {
        if (request.authorization !== "fresh-token") {
          return Response.json({ statusCode: "401" }, { status: 401 });
        }
        return Response.json(mockSalesOrderGet(68378));
      }
      throw new Error(`Unexpected request: ${request.method} ${request.path}`);
    });
    const gateway = makeGateway({ fetchImpl });

    const snapshot = await gateway.getSalesOrder(68378);
    expect(snapshot.salesorderId).toBe(68378);
    expect(
      requests.filter(
        (request) => request.method === "GET" && request.path === "/sales/orders/68378"
      )
    ).toHaveLength(2);
    // Exactly one re-authentication login; no order write POST at all.
    expect(requests.filter((request) => request.method === "POST" && request.path === "/login")).toHaveLength(2);
    expect(
      requests.filter((request) => request.method === "POST" && request.path !== "/login")
    ).toHaveLength(0);
  });

  it("logs structured info/error with credentials and tokens redacted", async () => {
    const events: Array<{
      level: string;
      message: string;
      context?: Record<string, unknown>;
    }> = [];
    const makeLog = (bound: Record<string, unknown> = {}): Logger => ({
      requestId: "request-sales-1",
      debug: (message, context) =>
        events.push({ level: "debug", message, context: { ...bound, ...context } }),
      info: (message, context) =>
        events.push({ level: "info", message, context: { ...bound, ...context } }),
      warn: (message, context) =>
        events.push({ level: "warn", message, context: { ...bound, ...context } }),
      error: (message, context) =>
        events.push({ level: "error", message, context: { ...bound, ...context } }),
      child: (context) => makeLog({ ...bound, ...context }),
    });
    const { fetchImpl } = stubFetch((request) => {
      if (request.path === "/login") {
        return Response.json({ token: "secret-token" });
      }
      if (request.path === "/sales/orders/" && request.method === "POST") {
        return Response.json(
          { statusCode: "500", error: "Internal Server Error", customer_name: "Private Customer", email: "private@example.test" },
          { status: 500 }
        );
      }
      throw new Error(`Unexpected request: ${request.method} ${request.path}`);
    });
    const gateway = makeGateway({
      fetchImpl,
      logger: makeLog(),
    });

    await expect(
      gateway.createSalesOrder({ ...salesOrderCreateInput, operationId: "log-op" })
    ).rejects.toMatchObject({ options: { ambiguous: true } });

    expect(
      events.some(
        (event) =>
          event.message === "Jubelio HTTP request started" &&
          event.context?.path === "/sales/orders/"
      )
    ).toBe(true);
    expect(
      events.some(
        (event) =>
          event.message === "Jubelio sales write outcome unknown" &&
          event.level === "error"
      )
    ).toBe(true);
    expect(JSON.stringify(events)).not.toContain("secret-token");
    expect(JSON.stringify(events)).not.toContain("test-account@example.test");
    expect(JSON.stringify(events)).not.toContain("test-account-placeholder-password");
    expect(JSON.stringify(events)).not.toContain(salesOrderCreateInput.customerName);
    expect(JSON.stringify(events)).not.toContain("Private Customer");
    expect(JSON.stringify(events)).not.toContain("private@example.test");
  });
});

// =========================================================
// Settlement (Path 1): invoice conversion → verified GET → payment.
// Shapes match the sandbox observations of 2026-09-24 (see
// docs/features/jubelio-sales-orders.md).
// =========================================================

describe("Jubelio sales gateway createInvoice (Path 1)", () => {
  it("POSTs the conversion once, verifies the invoice GET and cross-checks the SO linkage", async () => {
    const { fetchImpl, requests } = stubFetch((request) => {
      if (request.path === "/login") {
        return Response.json({ token: "mock-token" });
      }
      if (request.path === "/sales/packlists/create-invoice" && request.method === "POST") {
        return Response.json({ status: "ok", id: 45934 });
      }
      if (request.path === "/sales/invoices/45934") {
        return Response.json({
          invoice_id: 45934,
          invoice_no: "INV-000045934",
          // Runtime shape: salesorder_id is null on the invoice GET.
          salesorder_id: null,
          contact_id: -1,
          location_id: 15,
          sub_total: "1300000.0000",
          total_disc: "0.0000",
          total_tax: "0.0000",
          grand_total: "1300000.0000",
          is_canceled: false,
          items: [
            { item_id: 101187, qty_in_base: "1.0000", price: "1300000.0000", amount: "1300000.0000", unit: "Buah" },
          ],
        });
      }
      if (request.path === "/sales/orders/68378") {
        return Response.json({ ...mockSalesOrderGet(68378), invoice_id: 45934 });
      }
      throw new Error(`Unexpected request: ${request.method} ${request.path}`);
    });
    const gateway = makeGateway({ fetchImpl });

    const result = await gateway.createInvoice({ salesOrderId: 68378, operationId: "op-inv" });

    expect(result.invoiceId).toBe(45934);
    expect(result.invoice.grandTotal).toBe(1300000);
    expect(result.invoice.salesorderId).toBeNull();
    const posts = requests.filter(
      (r) => r.method === "POST" && r.path === "/sales/packlists/create-invoice"
    );
    expect(posts).toHaveLength(1);
  });

  it("refuses the invoice when the SO GET does not reference it (fail closed)", async () => {
    const { fetchImpl } = stubFetch((request) => {
      if (request.path === "/login") {
        return Response.json({ token: "mock-token" });
      }
      if (request.path === "/sales/packlists/create-invoice") {
        return Response.json({ status: "ok", id: 45999 });
      }
      if (request.path === "/sales/invoices/45999") {
        return Response.json({
          invoice_id: 45999,
          contact_id: -1, location_id: 15,
          sub_total: "1300000.0000",
          total_disc: "0.0000",
          total_tax: "0.0000",
          grand_total: "1300000.0000",
          items: [{ item_id: 101187, qty_in_base: 1, price: 1300000, amount: 1300000, unit: "Buah" }],
        });
      }
      if (request.path === "/sales/orders/68378") {
        // SO still shows no invoice → linkage mismatch.
        return Response.json(mockSalesOrderGet(68378));
      }
      throw new Error(`Unexpected request: ${request.method} ${request.path}`);
    });
    const gateway = makeGateway({ fetchImpl });

    await expect(
      gateway.createInvoice({ salesOrderId: 68378, operationId: "op-inv" })
    ).rejects.toThrow(/does not reference invoice/);
  });

  it("rejects an invoice linked to the SO but containing a different item", async () => {
    const { fetchImpl } = stubFetch((request) => {
      if (request.path === "/login") return Response.json({ token: "mock-token" });
      if (request.path === "/sales/packlists/create-invoice") return Response.json({ status: "ok", id: 45934 });
      if (request.path === "/sales/invoices/45934") return Response.json({
        invoice_id: 45934, contact_id: -1, location_id: 15, salesorder_id: null,
        sub_total: 1300000, total_disc: 0, total_tax: 0, grand_total: 1300000,
        items: [{ item_id: 99999, qty_in_base: 1, price: 1300000, amount: 1300000, unit: "Buah" }],
      });
      if (request.path === "/sales/orders/68378") return Response.json({ ...mockSalesOrderGet(68378), invoice_id: 45934 });
      throw new Error(`Unexpected request: ${request.path}`);
    });
    await expect(makeGateway({ fetchImpl }).createInvoice({ salesOrderId: 68378 }))
      .rejects.toThrow(/item lines/);
  });

  it("treats an unreadable conversion id as ambiguous (the conversion may exist)", async () => {
    const { fetchImpl } = stubFetch((request) => {
      if (request.path === "/login") {
        return Response.json({ token: "mock-token" });
      }
      if (request.path === "/sales/packlists/create-invoice") {
        return Response.json({ status: "ok" });
      }
      throw new Error(`Unexpected request: ${request.method} ${request.path}`);
    });
    const gateway = makeGateway({ fetchImpl });

    await expect(
      gateway.createInvoice({ salesOrderId: 68378, operationId: "op-inv" })
    ).rejects.toMatchObject({ options: { ambiguous: true } });
  });
});

describe("Jubelio sales gateway createInvoicePayment (Path 1)", () => {
  it("does not confirm a payment without an invoice association", async () => {
    const { fetchImpl } = stubFetch((request) => {
      if (request.path === "/login") return Response.json({ token: "mock-token" });
      if (request.path === "/sales/payments/" && request.method === "POST") return Response.json({ status: "ok", id: 18 });
      if (request.path === "/sales/payments/18") return Response.json({ payment_id: 18, amount: "1000.0000", invoices: [] });
      throw new Error(`Unexpected request: ${request.path}`);
    });
    await expect(makeGateway({ fetchImpl }).createInvoicePayment({
      payment: { invoiceId: 45934, accountId: 2, amount: 1000, contactId: -1, paymentType: 0 },
    })).rejects.toThrow(/no single line for invoice/);
  });
  it("POSTs the payment once with a numeric payment_type and verifies the association via GET", async () => {
    const { fetchImpl, requests } = stubFetch((request) => {
      if (request.path === "/login") {
        return Response.json({ token: "mock-token" });
      }
      if (request.path === "/sales/payments/" && request.method === "POST") {
        return Response.json({ status: "ok", id: 12 });
      }
      if (request.path === "/sales/payments/12") {
        return Response.json({
          payment_id: 12,
          payment_no: "CP-000000003",
          contact_id: -1,
          amount: "1000.0000",
          payment_type: 0,
          invoices: [
            { invoice_id: 45934, payment_amount: 1000, salesorder_id: 68378 },
          ],
        });
      }
      throw new Error(`Unexpected request: ${request.method} ${request.path}`);
    });
    const gateway = makeGateway({ fetchImpl });

    const result = await gateway.createInvoicePayment({
      payment: {
        invoiceId: 45934,
        accountId: 2,
        amount: 1000,
        contactId: -1,
        contactName: "Customer",
        paymentType: 0,
        note: "OKCIR probe",
      },
      operationId: "op-pay",
    });

    expect(result.paymentId).toBe(12);
    expect(result.payment.invoices).toEqual([
      { invoiceId: 45934, paymentAmount: 1000, salesorderId: 68378 },
    ]);
    const post = requests.find(
      (request) => request.method === "POST" && request.path === "/sales/payments/"
    );
    expect((post?.body as Record<string, unknown>).payment_type).toBe(0);
    expect((post?.body as Record<string, unknown>).payment_no).toBe("[auto]");
  });

  it("treats a payment response without a usable id as ambiguous and never retries", async () => {
    const { fetchImpl, requests } = stubFetch((request) => {
      if (request.path === "/login") {
        return Response.json({ token: "mock-token" });
      }
      if (request.path === "/sales/payments/") {
        return Response.json({ status: "ok" });
      }
      throw new Error(`Unexpected request: ${request.method} ${request.path}`);
    });
    const gateway = makeGateway({ fetchImpl });

    await expect(
      gateway.createInvoicePayment({
        payment: {
          invoiceId: 45934,
          accountId: 2,
          amount: 1000,
          contactId: -1,
          paymentType: 0,
        },
        operationId: "op-pay",
      })
    ).rejects.toMatchObject({ options: { ambiguous: true } });
    const posts = requests.filter(
      (request) => request.method === "POST" && request.path === "/sales/payments/"
    );
    expect(posts).toHaveLength(1);
  });

  it("fails closed when the payment GET links a different amount", async () => {
    const { fetchImpl } = stubFetch((request) => {
      if (request.path === "/login") {
        return Response.json({ token: "mock-token" });
      }
      if (request.path === "/sales/payments/" && request.method === "POST") {
        return Response.json({ status: "ok", id: 13 });
      }
      if (request.path === "/sales/payments/13") {
        return Response.json({
          payment_id: 13,
          amount: "999.0000",
          invoices: [{ invoice_id: 45934, payment_amount: 999, salesorder_id: 68378 }],
        });
      }
      throw new Error(`Unexpected request: ${request.method} ${request.path}`);
    });
    const gateway = makeGateway({ fetchImpl });

    await expect(
      gateway.createInvoicePayment({
        payment: {
          invoiceId: 45934,
          accountId: 2,
          amount: 1000,
          contactId: -1,
          paymentType: 0,
        },
        operationId: "op-pay",
      })
    ).rejects.toThrow(/is 999, expected 1000/);
  });
});

// =====================================================================
// Ticket #03 — Siap Proses channel-status edit (full-payload, fail-closed).
// Every edit GETs the current SO first, then POSTs the full documented
// `saveSalesOrderRequest` envelope built ONLY from that verified read with
// the SO id, SO number, detail ids, identity, location, items and money
// preserved verbatim; `channel_status` is the ONLY intended change. Any
// unsafe shape → zero POST. All requests are stubbed; no real Jubelio
// traffic is ever made here.
// =====================================================================

import {
  buildSalesOrderEditPayload,
  type JubelioSalesOrderEditSnapshot,
} from "./jubelio-sales-client";

const EDIT_SO_ID = 68_399;
const EDIT_DETAIL_ID = 74_682; // one-shot evidence: detail ids are preserved

/** A verified pre-edit GET shape for an invoiced, active INTERNAL SO. */
function editSnapshotBody(
  overrides: Record<string, unknown> = {},
  itemOverrides: Record<string, unknown> = {}
): Record<string, unknown> {
  const baseItem = {
    salesorder_detail_id: EDIT_DETAIL_ID,
    item_id: 43842,
    qty_in_base: 1,
    price: 1000,
    unit: "Buah",
    tax_id: 1,
    disc: 0,
    disc_amount: 0,
    tax_amount: 0,
    amount: 1000,
    location_id: 7,
  };
  return {
    salesorder_id: EDIT_SO_ID,
    salesorder_no: "SO-000068399",
    contact_id: -1,
    customer_name: "Pelanggan Umum",
    transaction_date: "2026-09-26T17:00:00.000Z",
    is_tax_included: false,
    note: "OKCIR_SO_CREATE:order-1:op-1",
    ref_no: "",
    location_id: 7,
    source: 1,
    is_canceled: false,
    invoice_id: 45945,
    channel_status: "Belum Bayar",
    sub_total: 1000,
    total_disc: 0,
    total_tax: 0,
    grand_total: 1000,
    add_fee: 0,
    add_disc: 0,
    service_fee: "0.0000",
    items: [baseItem],
    ...overrides,
    ...(Object.keys(itemOverrides).length > 0
      ? { items: [{ ...baseItem, ...itemOverrides }] }
      : {}),
  };
}

function readEditSnapshot(): JubelioSalesOrderEditSnapshot {
  return {
    salesorderId: EDIT_SO_ID,
    salesorderNo: "SO-000068399",
    source: 1,
    refNo: "",
    contactId: -1,
    customerName: "Pelanggan Umum",
    locationId: 7,
    note: "OKCIR_SO_CREATE:order-1:op-1",
    transactionDate: "2026-09-26T17:00:00.000Z",
    isTaxIncluded: false,
    invoiceId: 45945,
    isCanceled: false,
    channelStatus: "Belum Bayar",
    subTotal: 1000,
    totalDisc: 0,
    totalTax: 0,
    grandTotal: 1000,
    addFee: 0,
    addDisc: 0,
    serviceFee: 0,
    items: [
      {
        salesorderDetailId: EDIT_DETAIL_ID,
        itemId: 43842,
        quantity: 1,
        price: 1000,
        disc: 0,
        discAmount: 0,
        taxAmount: 0,
        amount: 1000,
        unit: "Buah",
        taxId: 1,
        locationId: 7,
      },
    ],
  };
}

describe("buildSalesOrderEditPayload (full-payload allowlist, marker-only diff)", () => {
  it("preserves the SO id, SO number, detail ids, identity, location, items and money verbatim; only channel_status changes", () => {
    const payload = buildSalesOrderEditPayload(readEditSnapshot(), "Siap Proses");
    expect(payload).toEqual({
      salesorder_id: EDIT_SO_ID,
      salesorder_no: "SO-000068399",
      contact_id: -1,
      customer_name: "Pelanggan Umum",
      transaction_date: "2026-09-26T17:00:00.000Z",
      is_tax_included: false,
      note: "OKCIR_SO_CREATE:order-1:op-1",
      ref_no: "",
      location_id: 7,
      source: 1,
      channel_status: "Siap Proses",
      sub_total: 1000,
      total_disc: 0,
      total_tax: 0,
      grand_total: 1000,
      add_fee: 0,
      add_disc: 0,
      service_fee: 0,
      items: [
        {
          salesorder_detail_id: EDIT_DETAIL_ID,
          item_id: 43842,
          qty_in_base: 1,
          price: 1000,
          disc: 0,
          disc_amount: 0,
          tax_amount: 0,
          amount: 1000,
          unit: "Buah",
          tax_id: 1,
          location_id: 7,
        },
      ],
    });
  });

  it("fail-closes before serializing on a missing detail id (the [auto]/0 rewrite risk)", () => {
    const edit = readEditSnapshot();
    edit.items = [{ ...edit.items[0], salesorderDetailId: 0 }];
    expect(() => buildSalesOrderEditPayload(edit, "Siap Proses")).toThrow(
      /sales order detail id/
    );
  });

  it("fail-closes before serializing on a canceled or non-INTERNAL source", () => {
    expect(() =>
      buildSalesOrderEditPayload(
        { ...readEditSnapshot(), isCanceled: true },
        "Siap Proses"
      )
    ).toThrow(/canceled/);
    expect(() =>
      buildSalesOrderEditPayload({ ...readEditSnapshot(), source: 3 }, "Siap Proses")
    ).toThrow(/source/);
  });

  it("fail-closes before serializing on an unevidenced nonzero discount/tax/fee envelope", () => {
    const edit = readEditSnapshot();
    edit.items[0].discAmount = 5;
    expect(() => buildSalesOrderEditPayload(edit, "Siap Proses")).toThrow(
      /money envelope/
    );
  });
});

describe("Jubelio sales gateway getSalesOrderForEdit (strict edit pre-read)", () => {
  it("parses the full edit snapshot including detail ids and fee fields", async () => {
    const { fetchImpl } = stubFetch((request) => {
      if (request.path === "/login") return Response.json({ token: "mock-token" });
      if (request.path === `/sales/orders/${EDIT_SO_ID}`) {
        return Response.json(editSnapshotBody());
      }
      throw new Error(`Unexpected request: ${request.method} ${request.path}`);
    });
    const gateway = makeGateway({ fetchImpl });

    const snapshot = await gateway.getSalesOrderForEdit(EDIT_SO_ID);

    expect(snapshot).toMatchObject({
      salesorderId: EDIT_SO_ID,
      salesorderNo: "SO-000068399",
      source: 1,
      invoiceId: 45945,
      channelStatus: "Belum Bayar",
      serviceFee: 0,
      items: [{ salesorderDetailId: EDIT_DETAIL_ID, itemId: 43842 }],
    });
  });

  it("accepts Jubelio's loc_id field for the item location in the edit pre-read", async () => {
    const { fetchImpl } = stubFetch((request) => {
      if (request.path === "/login") return Response.json({ token: "mock-token" });
      if (request.path === `/sales/orders/${EDIT_SO_ID}`) {
        return Response.json(
          editSnapshotBody({}, { location_id: undefined, loc_id: 7 })
        );
      }
      throw new Error(`Unexpected request: ${request.method} ${request.path}`);
    });
    const gateway = makeGateway({ fetchImpl });

    const snapshot = await gateway.getSalesOrderForEdit(EDIT_SO_ID);

    expect(snapshot.items[0].locationId).toBe(7);
  });

  it("fail-closes when the GET shape has no positive detail id (zero-POST rule)", async () => {
    const { fetchImpl } = stubFetch((request) => {
      if (request.path === "/login") return Response.json({ token: "mock-token" });
      if (request.path === `/sales/orders/${EDIT_SO_ID}`) {
        return Response.json(
          editSnapshotBody({}, { salesorder_detail_id: 0 })
        );
      }
      throw new Error(`Unexpected request: ${request.method} ${request.path}`);
    });
    const gateway = makeGateway({ fetchImpl });

    await expect(gateway.getSalesOrderForEdit(EDIT_SO_ID)).rejects.toThrow(
      /detail id/
    );
  });

  it("fail-closes on a canceled SO or non-INTERNAL source", async () => {
    for (const body of [
      editSnapshotBody({ is_canceled: true }),
      editSnapshotBody({ source: 2 }),
    ]) {
      const { fetchImpl } = stubFetch((request) => {
        if (request.path === "/login") return Response.json({ token: "mock-token" });
        if (request.path === `/sales/orders/${EDIT_SO_ID}`) {
          return Response.json(body);
        }
        throw new Error(`Unexpected request: ${request.method} ${request.path}`);
      });
      const gateway = makeGateway({ fetchImpl });
      await expect(gateway.getSalesOrderForEdit(EDIT_SO_ID)).rejects.toThrow(
        /canceled|source/
      );
    }
  });

  it("fail-closes on unevidenced money (nonzero discount or diverging totals)", async () => {
    const { fetchImpl } = stubFetch((request) => {
      if (request.path === "/login") return Response.json({ token: "mock-token" });
      if (request.path === `/sales/orders/${EDIT_SO_ID}`) {
        return Response.json(
          editSnapshotBody({ total_disc: 10 }, { disc_amount: 10, amount: 990 })
        );
      }
      throw new Error(`Unexpected request: ${request.method} ${request.path}`);
    });
    const gateway = makeGateway({ fetchImpl });

    await expect(gateway.getSalesOrderForEdit(EDIT_SO_ID)).rejects.toThrow(
      /money envelope/
    );
  });
});

describe("Jubelio sales gateway editSalesOrder (one full-payload POST + GET confirm)", () => {
  it("POSTs the full preserved payload exactly once and confirms the marker and core attributes by GET", async () => {
    const { fetchImpl, requests } = stubFetch((request) => {
      if (request.path === "/login") return Response.json({ token: "mock-token" });
      if (request.path === "/sales/orders/" && request.method === "POST") {
        return Response.json({ id: EDIT_SO_ID });
      }
      if (request.path === `/sales/orders/${EDIT_SO_ID}`) {
        return Response.json(editSnapshotBody({ channel_status: "Siap Proses" }));
      }
      throw new Error(`Unexpected request: ${request.method} ${request.path}`);
    });
    const gateway = makeGateway({ fetchImpl });

    const result = await gateway.editSalesOrder({
      edit: readEditSnapshot(),
      targetChannelStatus: "Siap Proses",
      operationId: "op-edit-1",
    });

    expect(result.salesOrderId).toBe(EDIT_SO_ID);
    expect(result.order.channelStatus).toBe("Siap Proses");
    expect(
      requests.map((request) => `${request.method} ${request.path}`)
    ).toEqual([
      "POST /login",
      "POST /sales/orders/",
      `GET /sales/orders/${EDIT_SO_ID}`,
    ]);
    // Full-payload edit: everything preserved verbatim, only the marker.
    expect(requests[1].body).toMatchObject({
      salesorder_id: EDIT_SO_ID,
      salesorder_no: "SO-000068399",
      note: "OKCIR_SO_CREATE:order-1:op-1",
      location_id: 7,
      source: 1,
      channel_status: "Siap Proses",
      grand_total: 1000,
      items: [{ salesorder_detail_id: EDIT_DETAIL_ID, item_id: 43842, amount: 1000 }],
    });
  });

  it("treats serialization money noise in the confirmation GET as matching (tolerant, real mismatch still fails)", async () => {
    // Decimal-string / float-noise money from the provider must not turn a
    // successful edit into an ambiguous outcome.
    const { fetchImpl, requests } = stubFetch((request) => {
      if (request.path === "/login") return Response.json({ token: "mock-token" });
      if (request.path === "/sales/orders/" && request.method === "POST") {
        return Response.json({ id: EDIT_SO_ID });
      }
      if (request.path === `/sales/orders/${EDIT_SO_ID}`) {
        return Response.json(
          editSnapshotBody({
            channel_status: "Siap Proses",
            sub_total: "1000.0000000001",
            grand_total: "1000.0000000001",
          })
        );
      }
      throw new Error(`Unexpected request: ${request.method} ${request.path}`);
    });
    const gateway = makeGateway({ fetchImpl });

    const result = await gateway.editSalesOrder({
      edit: readEditSnapshot(),
      targetChannelStatus: "Siap Proses",
    });
    expect(result.salesOrderId).toBe(EDIT_SO_ID);
    expect(requests).toHaveLength(3); // login + one POST + confirmation GET

    // A REAL money divergence is still ambiguous, never accepted as success.
    const divergent = stubFetch((request) => {
      if (request.path === "/login") return Response.json({ token: "mock-token" });
      if (request.path === "/sales/orders/" && request.method === "POST") {
        return Response.json({ id: EDIT_SO_ID });
      }
      if (request.path === `/sales/orders/${EDIT_SO_ID}`) {
        return Response.json(
          editSnapshotBody({ channel_status: "Siap Proses", sub_total: 1001, grand_total: 1001 })
        );
      }
      throw new Error(`Unexpected request: ${request.method} ${request.path}`);
    });
    const divergentGateway = makeGateway({ fetchImpl: divergent.fetchImpl });
    await expect(
      divergentGateway.editSalesOrder({
        edit: readEditSnapshot(),
        targetChannelStatus: "Siap Proses",
      })
    ).rejects.toMatchObject({ options: { ambiguous: true } });
  });

  it("treats a 500 edit response as ambiguous and never repeats the POST", async () => {
    let postCount = 0;
    const { fetchImpl } = stubFetch((request) => {
      if (request.path === "/login") return Response.json({ token: "mock-token" });
      if (request.path === "/sales/orders/" && request.method === "POST") {
        postCount++;
        return Response.json({ statusCode: 500, message: "boom" }, { status: 500 });
      }
      throw new Error(`Unexpected request: ${request.method} ${request.path}`);
    });
    const gateway = makeGateway({ fetchImpl });

    await expect(
      gateway.editSalesOrder({
        edit: readEditSnapshot(),
        targetChannelStatus: "Siap Proses",
      })
    ).rejects.toMatchObject({ options: { ambiguous: true } });
    expect(postCount).toBe(1);
  });

  it("treats a 4xx edit response as a definite pre-apply rejection (non-ambiguous)", async () => {
    const { fetchImpl } = stubFetch((request) => {
      if (request.path === "/login") return Response.json({ token: "mock-token" });
      if (request.path === "/sales/orders/" && request.method === "POST") {
        return Response.json({ statusCode: 400, message: "bad" }, { status: 400 });
      }
      throw new Error(`Unexpected request: ${request.method} ${request.path}`);
    });
    const gateway = makeGateway({ fetchImpl });

    await expect(
      gateway.editSalesOrder({
        edit: readEditSnapshot(),
        targetChannelStatus: "Siap Proses",
      })
    ).rejects.toMatchObject({ options: { ambiguous: false } });
  });

  it("treats a confirmation GET without the target marker as ambiguous (outcome unknown)", async () => {
    const { fetchImpl } = stubFetch((request) => {
      if (request.path === "/login") return Response.json({ token: "mock-token" });
      if (request.path === "/sales/orders/" && request.method === "POST") {
        return Response.json({ id: EDIT_SO_ID });
      }
      if (request.path === `/sales/orders/${EDIT_SO_ID}`) {
        // The vendor-lag case: the marker did not (yet) appear.
        return Response.json(editSnapshotBody({ channel_status: "Belum Bayar" }));
      }
      throw new Error(`Unexpected request: ${request.method} ${request.path}`);
    });
    const gateway = makeGateway({ fetchImpl });

    await expect(
      gateway.editSalesOrder({
        edit: readEditSnapshot(),
        targetChannelStatus: "Siap Proses",
      })
    ).rejects.toMatchObject({ options: { ambiguous: true } });
  });

  it("treats a confirmation GET failure after the edit POST as ambiguous and never re-POSTs", async () => {
    let postCount = 0;
    const { fetchImpl } = stubFetch((request) => {
      if (request.path === "/login") return Response.json({ token: "mock-token" });
      if (request.path === "/sales/orders/" && request.method === "POST") {
        postCount++;
        return Response.json({ id: EDIT_SO_ID });
      }
      if (request.path === `/sales/orders/${EDIT_SO_ID}`) {
        return new Response(null, { status: 500 });
      }
      throw new Error(`Unexpected request: ${request.method} ${request.path}`);
    });
    const gateway = makeGateway({ fetchImpl });

    await expect(
      gateway.editSalesOrder({
        edit: readEditSnapshot(),
        targetChannelStatus: "Siap Proses",
      })
    ).rejects.toMatchObject({ options: { ambiguous: true } });
    expect(postCount).toBe(1);
  });
});

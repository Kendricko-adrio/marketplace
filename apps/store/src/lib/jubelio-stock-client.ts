export type JubelioStockRuntime = {
  mode: "mock" | "live";
  baseUrl: string;
};

type JubelioStockEnvironment = Partial<
  Record<
    | "NODE_ENV"
    | "APP_ENV"
    | "JUBELIO_API_BASE_URL"
    | "JUBELIO_MOCK_API_BASE_URL"
    | "JUBELIO_STOCK_WRITES_ENABLED",
    string
  >
>;

export function resolveJubelioStockRuntime(
  env: JubelioStockEnvironment
): JubelioStockRuntime {
  const appEnv = env.APP_ENV ?? env.NODE_ENV ?? "development";
  if (appEnv !== "production" || env.NODE_ENV !== "production") {
    return {
      mode: "mock",
      baseUrl: (env.JUBELIO_MOCK_API_BASE_URL || "http://127.0.0.1:3002").replace(
        /\/$/,
        ""
      ),
    };
  }

  if (env.JUBELIO_STOCK_WRITES_ENABLED !== "true") {
    throw new Error(
      "Production Jubelio stock writes require JUBELIO_STOCK_WRITES_ENABLED=true"
    );
  }

  const baseUrl = (env.JUBELIO_API_BASE_URL || "https://api2.jubelio.com").replace(
    /\/$/,
    ""
  );
  const url = new URL(baseUrl);
  if (url.protocol !== "https:" || url.hostname !== "api2.jubelio.com") {
    throw new Error(
      "Production Jubelio stock writes require https://api2.jubelio.com"
    );
  }

  return { mode: "live", baseUrl };
}

export type StockAdjustmentItemInput = {
  itemId: number;
  quantity: number;
  description: string;
  unit: string;
  cost: number;
  accountId: number;
  binId: number;
};

export type StockAdjustmentPayload = {
  item_adj_id: number;
  item_adj_no: string;
  transaction_date: string;
  note: string;
  location_id: number;
  is_opening_balance: boolean;
  items: Array<{
    item_adj_detail_id: number;
    original_item_adj_detail_id: number;
    item_id: number;
    description: string;
    serial_no: null;
    batch_no: null;
    qty_in_base: number;
    unit: string;
    cost: number;
    amount: number;
    location_id: number;
    account_id: number;
    expired_date: null;
    bin_id: number;
  }>;
};

export function buildStockAdjustmentPayload(input: {
  kind: "reserve" | "release";
  orderId: string;
  operationId: string;
  locationId: number;
  transactionDate: Date;
  items: StockAdjustmentItemInput[];
}): StockAdjustmentPayload {
  const direction = input.kind === "reserve" ? -1 : 1;
  const label = input.kind === "reserve" ? "RESERVE" : "RELEASE";
  return {
    item_adj_id: 0,
    item_adj_no: "[auto]",
    transaction_date: input.transactionDate.toISOString(),
    note: `OKCIR_${label}:${input.orderId}:${input.operationId}`,
    location_id: input.locationId,
    is_opening_balance: false,
    items: input.items.map((item) => {
      const quantity = direction * item.quantity;
      return {
        item_adj_detail_id: 0,
        original_item_adj_detail_id: 0,
        item_id: item.itemId,
        description: item.description,
        serial_no: null,
        batch_no: null,
        qty_in_base: quantity,
        unit: item.unit,
        cost: item.cost,
        amount: quantity * item.cost,
        location_id: input.locationId,
        account_id: item.accountId,
        expired_date: null,
        bin_id: item.binId,
      };
    }),
  };
}

export type JubelioAdjustmentRequest = {
  kind: "reserve" | "release";
  orderId: string;
  operationId: string;
  locationId: number;
  items: Array<{
    itemId: number;
    quantity: number;
    description: string;
    observedStock: number;
  }>;
};

export type JubelioAdjustmentResult = {
  adjustmentId: number;
  stocks: Array<{ itemId: number; onHand: number }>;
};

export class JubelioStockGatewayError extends Error {
  constructor(
    message: string,
    public readonly options: {
      code?: string;
      httpStatus?: number;
      ambiguous: boolean;
      retryable: boolean;
    }
  ) {
    super(message);
    this.name = "JubelioStockGatewayError";
  }
}

export type JubelioStockGateway = {
  applyAdjustment(input: JubelioAdjustmentRequest): Promise<JubelioAdjustmentResult>;
  findAdjustmentByNote(note: string): Promise<number | null>;
  getStocks(locationId: number, itemIds: number[]): Promise<Array<{ itemId: number; onHand: number }>>;
};

type GatewayEnvironment = JubelioStockEnvironment &
  Partial<
    Record<
      | "JUBELIO_EMAIL"
      | "JUBELIO_PASSWORD"
      | "JUBELIO_ADJUSTMENT_ACCOUNT_ID"
      | "JUBELIO_STOCK_TIMEOUT_MS",
      string
    >
  >;

type ItemMetadata = {
  item_id: number;
  item_full_name?: string;
  item_name?: string;
  average_cost?: string | number;
  buy_price?: string | number;
  buy_unit?: string;
};

export function createJubelioStockGateway(options: {
  env?: GatewayEnvironment;
  fetchImpl?: typeof fetch;
  logger?: Logger;
} = {}): JubelioStockGateway {
  const env = options.env ?? process.env;
  const runtime = resolveJubelioStockRuntime(env);
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = Math.max(100, Number(env.JUBELIO_STOCK_TIMEOUT_MS || 8_000));
  const log = (options.logger ?? createLogger({ module: "jubelio-http" })).child({
    service: "jubelio",
    runtime: runtime.mode,
  });
  let token: string | null = null;

  function sanitizeForLog(value: unknown, key?: string, depth = 0): unknown {
    if (key && /token|password|authorization|cookie|secret/i.test(key)) {
      return "[REDACTED]";
    }
    if (depth > 5 || value == null || typeof value !== "object") return value;
    if (Array.isArray(value)) {
      return value.map((item) => sanitizeForLog(item, undefined, depth + 1));
    }
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        sanitizeForLog(entryValue, entryKey, depth + 1),
      ])
    );
  }

  function requestBodyForLog(init: RequestInit): unknown {
    if (!init.body) return undefined;
    if (typeof init.body !== "string") return "[NON_TEXT_BODY]";
    try {
      return sanitizeForLog(JSON.parse(init.body));
    } catch {
      return init.body;
    }
  }

  function logRequest(path: string, init: RequestInit, context?: Record<string, unknown>): void {
    log.info("Jubelio HTTP request started", {
      method: init.method ?? "GET",
      path,
      input: requestBodyForLog(init),
      ...context,
    });
  }

  function logResponse(
    path: string,
    response: Response,
    output: unknown,
    durationMs: number,
    context?: Record<string, unknown>
  ): void {
    log.info("Jubelio HTTP response received", {
      method: context?.method ?? "GET",
      path,
      status: response.status,
      ok: response.ok,
      durationMs,
      output: sanitizeForLog(output),
      ...context,
    });
  }

  async function parseBody(response: Response): Promise<Record<string, unknown>> {
    const text = await response.text();
    if (!text) return {};
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      return { message: text };
    }
  }

  async function login(): Promise<string> {
    const email = runtime.mode === "mock" ? "mock@jubelio.local" : env.JUBELIO_EMAIL;
    const password = runtime.mode === "mock" ? "mock" : env.JUBELIO_PASSWORD;
    if (!email || !password) {
      throw new JubelioStockGatewayError("Jubelio credentials are not configured", {
        ambiguous: false,
        retryable: false,
      });
    }
    const path = "/login";
    const init: RequestInit = {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
      signal: AbortSignal.timeout(timeoutMs),
    };
    logRequest(path, { ...init, body: JSON.stringify({ credentialsConfigured: true }) }, {
      authRequest: true,
    });
    const startedAt = Date.now();
    let response: Response;
    try {
      response = await fetchImpl(`${runtime.baseUrl}${path}`, init);
    } catch (error) {
      log.error("Jubelio HTTP request failed", {
        method: "POST",
        path,
        durationMs: Date.now() - startedAt,
        error: serializeError(error),
      });
      throw error;
    }
    const body = await parseBody(response);
    logResponse(path, response, body, Date.now() - startedAt, {
      method: "POST",
      authResponse: true,
    });
    if (!response.ok || typeof body.token !== "string") {
      throw new JubelioStockGatewayError("Jubelio login failed", {
        httpStatus: response.status,
        ambiguous: false,
        retryable: response.status >= 500,
      });
    }
    token = body.token;
    return token;
  }

  async function authenticatedFetch(
    path: string,
    init: RequestInit = {},
    relogin = true
  ): Promise<Response> {
    const authToken = token ?? (await login());
    const requestInit: RequestInit = {
      ...init,
      headers: {
        authorization: authToken,
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...(init.headers || {}),
      },
      signal: init.signal ?? AbortSignal.timeout(timeoutMs),
    };
    logRequest(path, requestInit);
    const startedAt = Date.now();
    let response: Response;
    try {
      response = await fetchImpl(`${runtime.baseUrl}${path}`, requestInit);
    } catch (error) {
      log.error("Jubelio HTTP request failed", {
        method: requestInit.method ?? "GET",
        path,
        input: requestBodyForLog(requestInit),
        durationMs: Date.now() - startedAt,
        error: serializeError(error),
      });
      throw error;
    }
    logResponse(path, response, undefined, Date.now() - startedAt, {
      method: requestInit.method ?? "GET",
      outputPending: true,
    });
    if (response.status === 401 && relogin) {
      token = null;
      await login();
      return authenticatedFetch(path, init, false);
    }
    return response;
  }

  async function readJson<T>(path: string, init: RequestInit = {}): Promise<T> {
    let response: Response;
    try {
      response = await authenticatedFetch(path, init);
    } catch (error) {
      throw new JubelioStockGatewayError(
        error instanceof Error ? error.message : "Jubelio request failed",
        { ambiguous: false, retryable: true }
      );
    }
    const body = await parseBody(response);
    log.info("Jubelio HTTP response output", {
      method: init.method ?? "GET",
      path,
      status: response.status,
      output: sanitizeForLog(body),
    });
    if (!response.ok) {
      throw new JubelioStockGatewayError(
        String(body.message || body.error || `Jubelio request failed (${response.status})`),
        {
          code: typeof body.code === "string" ? body.code : undefined,
          httpStatus: response.status,
          ambiguous: false,
          retryable: response.status === 429 || response.status >= 500,
        }
      );
    }
    return body as T;
  }

  async function ensureMockStocks(input: JubelioAdjustmentRequest): Promise<void> {
    if (runtime.mode !== "mock") return;
    for (const item of input.items) {
      const path = "/__control/stocks/ensure";
      const init: RequestInit = {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          locationId: input.locationId,
          itemId: item.itemId,
          onHand: item.observedStock,
          description: item.description,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      };
      logRequest(path, init, { mockControl: true });
      const startedAt = Date.now();
      let response: Response;
      try {
        response = await fetchImpl(`${runtime.baseUrl}${path}`, init);
      } catch (error) {
        log.error("Jubelio HTTP request failed", {
          method: "POST",
          path,
          input: requestBodyForLog(init),
          durationMs: Date.now() - startedAt,
          error: serializeError(error),
          mockControl: true,
        });
        throw error;
      }
      const body = await parseBody(response);
      logResponse(path, response, body, Date.now() - startedAt, {
        method: "POST",
        mockControl: true,
      });
      if (!response.ok) {
        throw new JubelioStockGatewayError("Jubelio mock stock initialization failed", {
          httpStatus: response.status,
          ambiguous: false,
          retryable: true,
        });
      }
    }
  }

  async function getItemMetadata(
    locationId: number,
    itemIds: number[]
  ): Promise<Map<number, ItemMetadata>> {
    const wanted = new Set(itemIds);
    const found = new Map<number, ItemMetadata>();
    const pageSize = 500;
    for (let page = 1; page <= 100 && found.size < wanted.size; page++) {
      const result = await readJson<{ data?: ItemMetadata[]; totalCount?: number }>(
        `/inventory/items/to-stock/${locationId}?page=${page}&pageSize=${pageSize}`
      );
      const rows = result.data ?? [];
      for (const row of rows) if (wanted.has(row.item_id)) found.set(row.item_id, row);
      if (rows.length === 0 || page * pageSize >= Number(result.totalCount ?? rows.length)) break;
    }
    const missing = itemIds.filter((itemId) => !found.has(itemId));
    if (missing.length > 0) {
      throw new JubelioStockGatewayError(
        `Jubelio adjustment metadata missing for item(s): ${missing.join(", ")}`,
        { ambiguous: false, retryable: false }
      );
    }
    return found;
  }

  async function getStocks(
    locationId: number,
    itemIds: number[]
  ): Promise<Array<{ itemId: number; onHand: number }>> {
    const result = await readJson<{
      data?: Array<{
        item_id: number;
        location_stocks?: Array<{ location_id: number; on_hand?: number }>;
      }>;
    }>("/inventory/items/all-stocks/", {
      method: "POST",
      body: JSON.stringify({ ids: itemIds }),
    });
    return itemIds.map((itemId) => {
      const item = (result.data ?? []).find((row) => row.item_id === itemId);
      const location = item?.location_stocks?.find(
        (stock) => Number(stock.location_id) === locationId
      );
      if (!location || !Number.isFinite(Number(location.on_hand))) {
        throw new JubelioStockGatewayError(
          `Jubelio stock response missing item ${itemId} at location ${locationId}`,
          { ambiguous: false, retryable: true }
        );
      }
      return { itemId, onHand: Number(location.on_hand) };
    });
  }

  async function applyAdjustment(
    input: JubelioAdjustmentRequest
  ): Promise<JubelioAdjustmentResult> {
    await ensureMockStocks(input);
    const [bin, metadata] = await Promise.all([
      readJson<{ bin_id: number | string }>(`/wms/default-bin/${input.locationId}`),
      getItemMetadata(input.locationId, input.items.map((item) => item.itemId)),
    ]);
    const binId = Number(bin.bin_id);
    if (!Number.isFinite(binId)) {
      throw new JubelioStockGatewayError("Jubelio default bin is invalid", {
        ambiguous: false,
        retryable: false,
      });
    }
    const accountId = Number(env.JUBELIO_ADJUSTMENT_ACCOUNT_ID || 75);
    const payload = buildStockAdjustmentPayload({
      kind: input.kind,
      orderId: input.orderId,
      operationId: input.operationId,
      locationId: input.locationId,
      transactionDate: new Date(),
      items: input.items.map((item) => {
        const detail = metadata.get(item.itemId)!;
        const cost = Number(detail.average_cost ?? detail.buy_price ?? 0);
        return {
          itemId: item.itemId,
          quantity: item.quantity,
          description: detail.item_full_name || detail.item_name || item.description,
          unit: detail.buy_unit || "Buah",
          cost: Number.isFinite(cost) ? cost : 0,
          accountId,
          binId,
        };
      }),
    });

    const adjustmentPath = "/inventory/adjustments/";
    const adjustmentInit: RequestInit = {
      method: "POST",
      body: JSON.stringify(payload),
    };
    logRequest(adjustmentPath, adjustmentInit, {
      operationKind: input.kind,
      orderId: input.orderId,
      operationId: input.operationId,
    });
    const adjustmentStartedAt = Date.now();
    let response: Response;
    try {
      response = await authenticatedFetch(adjustmentPath, adjustmentInit);
    } catch (error) {
      throw new JubelioStockGatewayError(
        error instanceof Error ? error.message : "Jubelio adjustment timed out",
        { ambiguous: true, retryable: true }
      );
    }
    const responseBody = await parseBody(response);
    logResponse(adjustmentPath, response, responseBody, Date.now() - adjustmentStartedAt, {
      method: "POST",
      operationKind: input.kind,
      orderId: input.orderId,
      operationId: input.operationId,
    });
    if (!response.ok) {
      const code = typeof responseBody.code === "string" ? responseBody.code : undefined;
      const definitelyRejected =
        response.status === 400 || response.status === 409 || code === "P9005";
      throw new JubelioStockGatewayError(
        String(
          responseBody.message ||
            responseBody.error ||
            `Jubelio adjustment failed (${response.status})`
        ),
        {
          code,
          httpStatus: response.status,
          ambiguous: !definitelyRejected,
          retryable: !definitelyRejected,
        }
      );
    }
    const adjustmentId = Number(responseBody.id);
    if (!Number.isFinite(adjustmentId)) {
      throw new JubelioStockGatewayError(
        "Jubelio adjustment response is missing its id",
        { httpStatus: response.status, ambiguous: true, retryable: true }
      );
    }
    return {
      adjustmentId,
      stocks: await getStocks(input.locationId, input.items.map((item) => item.itemId)),
    };
  }

  async function findAdjustmentByNote(note: string): Promise<number | null> {
    const pageSize = 100;
    for (let page = 1; page <= 10; page++) {
      const result = await readJson<{
        data?: Array<{ item_adj_id: number; note?: string }>;
        totalCount?: number;
      }>(
        `/inventory/adjustments/?page=${page}&pageSize=${pageSize}&sortBy=transaction_date&sortDirection=desc`
      );
      const match = (result.data ?? []).find((row) => row.note === note);
      if (match) return Number(match.item_adj_id);
      if (page * pageSize >= Number(result.totalCount ?? 0)) break;
    }
    return null;
  }

  return { applyAdjustment, findAdjustmentByNote, getStocks };
}
import { createLogger, serializeError, type Logger } from "./logger";

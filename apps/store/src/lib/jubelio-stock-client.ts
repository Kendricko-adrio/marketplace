import {
  JubelioRequestQueueError,
  getSharedJubelioRequestScheduler,
  type JubelioRequestScheduler,
} from "./jubelio-request-scheduler";

export type JubelioAdjustmentKind = "reserve" | "release" | "reacquire";

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
  kind: JubelioAdjustmentKind;
  orderId: string;
  operationId: string;
  locationId: number;
  transactionDate: Date;
  items: StockAdjustmentItemInput[];
}): StockAdjustmentPayload {
  const direction = input.kind === "release" ? 1 : -1;
  const label =
    input.kind === "reserve"
      ? "RESERVE"
      : input.kind === "release"
        ? "RELEASE"
        : "REACQUIRE";
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

export type JubelioAdjustmentSnapshot = {
  description: string;
  unit: string;
  cost: number;
  binId: number;
  reserveAccountId: number;
  releaseAccountId: number;
};

export type JubelioPreparedAdjustmentItem = {
  itemId: number;
  snapshot: JubelioAdjustmentSnapshot;
};

export type JubelioAdjustmentRequest = {
  kind: JubelioAdjustmentKind;
  orderId: string;
  operationId: string;
  locationId: number;
  items: Array<{
    itemId: number;
    quantity: number;
    description: string;
    observedStock: number;
    snapshot?: JubelioAdjustmentSnapshot;
  }>;
  onPrepared?: (items: JubelioPreparedAdjustmentItem[]) => Promise<void>;
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
      | "JUBELIO_ADJUSTMENT_PLUS_ACCOUNT_ID"
      | "JUBELIO_ADJUSTMENT_MINUS_ACCOUNT_ID"
      | "JUBELIO_STOCK_TIMEOUT_MS"
      | "JUBELIO_STOCK_MAX_REQUESTS_PER_MINUTE"
      | "JUBELIO_STOCK_CONCURRENCY"
      | "JUBELIO_STOCK_MAX_QUEUED"
      | "JUBELIO_STOCK_QUEUE_TIMEOUT_MS",
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
  scheduler?: JubelioRequestScheduler;
} = {}): JubelioStockGateway {
  const env = options.env ?? process.env;
  const runtime = resolveJubelioStockRuntime(env);
  const fetchImpl = options.fetchImpl ?? fetch;
  const positiveNumber = (value: string | undefined, fallback: number) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  };
  const timeoutMs = Math.max(
    100,
    positiveNumber(env.JUBELIO_STOCK_TIMEOUT_MS, 8_000)
  );
  const maxRequestsPerMinute = Math.min(
    600,
    positiveNumber(env.JUBELIO_STOCK_MAX_REQUESTS_PER_MINUTE, 450)
  );
  const maxConcurrent = positiveNumber(env.JUBELIO_STOCK_CONCURRENCY, 10);
  const maxQueued = positiveNumber(env.JUBELIO_STOCK_MAX_QUEUED, 1_000);
  const configuredQueueTimeoutMs = Math.max(
    1,
    positiveNumber(env.JUBELIO_STOCK_QUEUE_TIMEOUT_MS, 5_000)
  );
  // Queue expiry must happen before the HTTP timeout starts classifying a
  // potentially-sent adjustment as ambiguous.
  const queueTimeoutMs = Math.min(
    configuredQueueTimeoutMs,
    Math.max(1, timeoutMs - 100)
  );
  const scheduler =
    options.scheduler ??
    (options.fetchImpl
      ? {
          schedule: <T>(task: () => Promise<T>) => task(),
          activeCount: 0,
          queuedCount: 0,
        }
      : getSharedJubelioRequestScheduler({
          key: runtime.baseUrl,
          maxConcurrent,
          maxRequestsPerMinute,
          maxQueued,
          queueTimeoutMs,
        }));
  const log = (options.logger ?? createLogger({ module: "jubelio-http" })).child({
    service: "jubelio",
    runtime: runtime.mode,
  });
  let token: string | null = null;
  let loginPromise: Promise<string> | null = null;
  let accountMappingPromise: Promise<{
    adjp_acct_id?: number | string;
    adjm_acct_id?: number | string;
  }> | null = null;
  const defaultBinPromises = new Map<number, Promise<number>>();

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

  async function login(priority = 0): Promise<string> {
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
      response = await scheduler.schedule(
        () => fetchImpl(`${runtime.baseUrl}${path}`, init),
        { priority }
      );
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

  async function getAuthToken(priority = 0): Promise<string> {
    if (token) return token;
    if (!loginPromise) {
      loginPromise = login(priority).finally(() => {
        loginPromise = null;
      });
    }
    return loginPromise;
  }

  async function authenticatedFetch(
    path: string,
    init: RequestInit = {},
    relogin = true,
    priority = 0
  ): Promise<Response> {
    const authToken = await getAuthToken(priority);
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
      response = await scheduler.schedule(
        () => fetchImpl(`${runtime.baseUrl}${path}`, requestInit),
        { priority }
      );
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
      if (token === authToken) token = null;
      await getAuthToken(priority);
      return authenticatedFetch(path, init, false, priority);
    }
    return response;
  }

  async function readJson<T>(
    path: string,
    init: RequestInit = {},
    priority = 0
  ): Promise<T> {
    let response: Response;
    try {
      response = await authenticatedFetch(path, init, true, priority);
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

  async function getDefaultBinId(locationId: number, priority: number): Promise<number> {
    const cached = defaultBinPromises.get(locationId);
    if (cached) return cached;
    const pending = readJson<{ bin_id: number | string }>(
      `/wms/default-bin/${locationId}`,
      {},
      priority
    )
      .then((result) => {
        const binId = Number(result.bin_id);
        if (!Number.isFinite(binId)) {
          throw new JubelioStockGatewayError("Jubelio default bin is invalid", {
            ambiguous: false,
            retryable: false,
          });
        }
        return binId;
      })
      .catch((error) => {
        defaultBinPromises.delete(locationId);
        throw error;
      });
    defaultBinPromises.set(locationId, pending);
    return pending;
  }

  async function getItemMetadata(
    locationId: number,
    itemIds: number[],
    priority: number
  ): Promise<Map<number, ItemMetadata>> {
    const wanted = new Set(itemIds);
    const rows = await readJson<
      Array<{
        item_id: number;
        item_name?: string;
        item_full_name?: string;
        unit?: string;
        cost?: string | number;
      }>
    >(
      "/inventory/items/to-adjust/",
      {
        method: "POST",
        body: JSON.stringify({ ids: [...wanted], location_id: locationId }),
      },
      priority
    );
    if (!Array.isArray(rows)) {
      throw new JubelioStockGatewayError(
        "Jubelio adjustment metadata response is invalid",
        { ambiguous: false, retryable: false }
      );
    }

    const found = new Map<number, ItemMetadata>();
    for (const row of rows) {
      const itemId = Number(row.item_id);
      if (!wanted.has(itemId)) continue;
      found.set(itemId, {
        item_id: itemId,
        item_name: row.item_name,
        item_full_name: row.item_full_name,
        average_cost: row.cost,
        buy_unit: row.unit,
      });
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

  async function getAdjustmentAccountIds(priority: number): Promise<{
    reserveAccountId: number;
    releaseAccountId: number;
  }> {
    if (!accountMappingPromise) {
      accountMappingPromise = readJson<{
        adjp_acct_id?: number | string;
        adjm_acct_id?: number | string;
      }>("/systemsetting/account-mapping", {}, priority).catch((error) => {
        accountMappingPromise = null;
        throw error;
      });
    }
    const mapping = await accountMappingPromise;
    const reserveAccountId = Number(
      env.JUBELIO_ADJUSTMENT_PLUS_ACCOUNT_ID || mapping.adjp_acct_id
    );
    const releaseAccountId = Number(
      env.JUBELIO_ADJUSTMENT_MINUS_ACCOUNT_ID || mapping.adjm_acct_id
    );
    if (!Number.isInteger(reserveAccountId) || reserveAccountId <= 0) {
      throw new JubelioStockGatewayError(
        "Jubelio reserve adjustment account mapping is invalid",
        { ambiguous: false, retryable: false }
      );
    }
    if (!Number.isInteger(releaseAccountId) || releaseAccountId <= 0) {
      throw new JubelioStockGatewayError(
        "Jubelio release adjustment account mapping is invalid",
        { ambiguous: false, retryable: false }
      );
    }
    return { reserveAccountId, releaseAccountId };
  }

  async function getStocks(
    locationId: number,
    itemIds: number[],
    priority = 5
  ): Promise<Array<{ itemId: number; onHand: number }>> {
    const result = await readJson<{
      data?: Array<{
        item_id: number;
        location_stocks?: Array<{ location_id: number; on_hand?: number }>;
      }>;
    }>(
      "/inventory/items/all-stocks/",
      {
        method: "POST",
        body: JSON.stringify({ ids: itemIds }),
      },
      priority
    );
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
    const priority =
      input.kind === "reacquire" ? 20 : input.kind === "release" ? 10 : 0;
    let preparedItems: JubelioPreparedAdjustmentItem[];
    if (input.items.every((item) => item.snapshot != null)) {
      preparedItems = input.items.map((item) => ({
        itemId: item.itemId,
        snapshot: item.snapshot!,
      }));
    } else {
      const [binId, metadata, accountIds] = await Promise.all([
        getDefaultBinId(input.locationId, priority),
        getItemMetadata(
          input.locationId,
          input.items.map((item) => item.itemId),
          priority
        ),
        getAdjustmentAccountIds(priority),
      ]);
      preparedItems = input.items.map((item) => {
        const detail = metadata.get(item.itemId)!;
        const cost = Number(detail.average_cost ?? detail.buy_price);
        const unit = detail.buy_unit?.trim();
        if (!Number.isFinite(cost) || cost < 0) {
          throw new JubelioStockGatewayError(
            `Jubelio adjustment cost is invalid for item ${item.itemId}`,
            { ambiguous: false, retryable: false }
          );
        }
        if (!unit) {
          throw new JubelioStockGatewayError(
            `Jubelio adjustment unit is missing for item ${item.itemId}`,
            { ambiguous: false, retryable: false }
          );
        }
        return {
          itemId: item.itemId,
          snapshot: {
            description:
              detail.item_full_name || detail.item_name || item.description,
            unit,
            cost,
            binId,
            ...accountIds,
          },
        };
      });
    }

    for (const prepared of preparedItems) {
      const snapshot = prepared.snapshot;
      if (
        !snapshot.description ||
        !snapshot.unit ||
        !Number.isFinite(snapshot.cost) ||
        snapshot.cost < 0 ||
        !Number.isInteger(snapshot.binId) ||
        snapshot.binId <= 0 ||
        !Number.isInteger(snapshot.reserveAccountId) ||
        snapshot.reserveAccountId <= 0 ||
        !Number.isInteger(snapshot.releaseAccountId) ||
        snapshot.releaseAccountId <= 0
      ) {
        throw new JubelioStockGatewayError(
          `Jubelio adjustment snapshot is invalid for item ${prepared.itemId}`,
          { ambiguous: false, retryable: false }
        );
      }
    }
    try {
      await input.onPrepared?.(preparedItems);
    } catch (error) {
      throw new JubelioStockGatewayError(
        error instanceof Error
          ? error.message
          : "Jubelio adjustment snapshot could not be persisted",
        {
          code: "SNAPSHOT_PERSIST_FAILED",
          ambiguous: false,
          retryable: true,
        }
      );
    }

    const preparedByItem = new Map(
      preparedItems.map((item) => [item.itemId, item.snapshot])
    );
    const payload = buildStockAdjustmentPayload({
      kind: input.kind,
      orderId: input.orderId,
      operationId: input.operationId,
      locationId: input.locationId,
      transactionDate: new Date(),
      items: input.items.map((item) => {
        const snapshot = preparedByItem.get(item.itemId)!;
        return {
          itemId: item.itemId,
          quantity: item.quantity,
          description: snapshot.description,
          unit: snapshot.unit,
          cost: snapshot.cost,
          accountId:
            input.kind === "release"
              ? snapshot.releaseAccountId
              : snapshot.reserveAccountId,
          binId: snapshot.binId,
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
      response = await authenticatedFetch(
        adjustmentPath,
        adjustmentInit,
        true,
        priority
      );
    } catch (error) {
      if (error instanceof JubelioRequestQueueError) {
        throw new JubelioStockGatewayError(error.message, {
          code: error.code,
          ambiguous: false,
          retryable: true,
        });
      }
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
      stocks: await getStocks(
        input.locationId,
        input.items.map((item) => item.itemId),
        priority
      ),
    };
  }

  async function findAdjustmentByNote(note: string): Promise<number | null> {
    const pageSize = 100;
    for (let page = 1; page <= 10; page++) {
      const result = await readJson<{
        data?: Array<{ item_adj_id: number; note?: string }>;
        totalCount?: number;
      }>(
        `/inventory/adjustments/?page=${page}&pageSize=${pageSize}&sortBy=transaction_date&sortDirection=desc`,
        {},
        5
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

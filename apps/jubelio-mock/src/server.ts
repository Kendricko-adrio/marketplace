import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";

type Scenario =
  | "success"
  | "insufficient-stock"
  | "server-error"
  | "rate-limit-once"
  | "unauthorized-once"
  | "timeout-before-apply"
  | "timeout-after-apply"
  | "malformed-success";

type MockStock = {
  locationId: number;
  itemId: number;
  onHand: number;
  description: string;
  cost: number;
  unit: string;
};

type Adjustment = {
  id: number;
  number: string;
  note: string;
  locationId: number;
  transactionDate: string;
  items: Array<Record<string, unknown>>;
};

const stocks = new Map<string, MockStock>();
const adjustments = new Map<number, Adjustment>();
const requests: Array<{ method: string; path: string; body: unknown }> = [];
let nextAdjustmentId = 1;
let scenario: Scenario = "success";
let scenarioHits = 0;

function stockKey(locationId: number, itemId: number): string {
  return `${locationId}:${itemId}`;
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

export function resetMockState(): void {
  stocks.clear();
  adjustments.clear();
  requests.length = 0;
  nextAdjustmentId = 1;
  scenario = "success";
  scenarioHits = 0;
}

function authorized(request: IncomingMessage): boolean {
  return request.headers.authorization === "mock-token";
}

export const jubelioMockServer = createServer(async (request, response) => {
  const method = request.method || "GET";
  const url = new URL(request.url || "/", "http://127.0.0.1");
  const body = method === "POST" || method === "PUT" ? await readJson(request) : {};
  requests.push({ method, path: url.pathname, body });

  if (method === "GET" && url.pathname === "/health") {
    return json(response, 200, { status: "ok" });
  }

  if (method === "POST" && url.pathname === "/__control/reset") {
    resetMockState();
    return json(response, 200, { status: "ok" });
  }
  if (method === "PUT" && url.pathname === "/__control/scenario") {
    scenario = String(body.scenario || "success") as Scenario;
    scenarioHits = 0;
    return json(response, 200, { status: "ok", scenario });
  }
  if (method === "GET" && url.pathname === "/__control/requests") {
    return json(response, 200, { data: requests });
  }
  if (method === "POST" && url.pathname === "/__control/stocks/ensure") {
    const locationId = Number(body.locationId);
    const itemId = Number(body.itemId);
    const key = stockKey(locationId, itemId);
    if (!stocks.has(key)) {
      stocks.set(key, {
        locationId,
        itemId,
        onHand: Number(body.onHand),
        description: String(body.description || `Item ${itemId}`),
        cost: Number(body.cost || 100_000),
        unit: String(body.unit || "Buah"),
      });
    }
    return json(response, 200, { status: "ok" });
  }

  if (method === "POST" && url.pathname === "/login") {
    return json(response, 200, { token: "mock-token" });
  }

  if (!authorized(request)) {
    return json(response, 401, { statusCode: "401", error: "Unauthorized" });
  }

  const defaultBin = url.pathname.match(/^\/wms\/default-bin\/(\d+)$/);
  if (method === "GET" && defaultBin) {
    const locationId = Number(defaultBin[1]);
    return json(response, 200, {
      bin_id: locationId * 10 + 1,
      location_id: locationId,
      bin_final_code: `MOCK-${locationId}`,
      acknowledge_stock: true,
    });
  }

  const toStock = url.pathname.match(/^\/inventory\/items\/to-stock\/(\d+)$/);
  if (method === "GET" && toStock) {
    const locationId = Number(toStock[1]);
    const data = [...stocks.values()]
      .filter((stock) => stock.locationId === locationId)
      .map((stock) => ({
        item_id: stock.itemId,
        item_group_id: Math.floor(stock.itemId / 10),
        item_code: `MOCK-${stock.itemId}`,
        item_name: stock.description,
        item_full_name: `${stock.itemId} - ${stock.description}`,
        buy_price: stock.cost.toFixed(4),
        buy_unit: stock.unit,
        average_cost: stock.cost.toFixed(12),
        invt_acct_id: 4,
        end_qty: stock.onHand,
        available_qty: stock.onHand,
      }));
    return json(response, 200, { data, totalCount: data.length });
  }

  if (method === "POST" && url.pathname === "/inventory/adjustments/") {
    scenarioHits++;
    if (scenario === "unauthorized-once" && scenarioHits === 1) {
      return json(response, 401, { statusCode: "401", error: "Unauthorized" });
    }
    if (scenario === "rate-limit-once" && scenarioHits === 1) {
      response.setHeader("retry-after", "0");
      return json(response, 429, { statusCode: "429", error: "Too Many Requests" });
    }
    if (scenario === "server-error") {
      return json(response, 500, {
        statusCode: "500",
        error: "Internal Server Error",
        message: "Mock server error",
        code: "MOCK_500",
      });
    }
    if (scenario === "timeout-before-apply") {
      return setTimeout(() => json(response, 504, { error: "late timeout" }), 30_000);
    }

    const locationId = Number(body.location_id);
    const items = Array.isArray(body.items)
      ? (body.items as Array<Record<string, unknown>>)
      : [];
    const invalid = items.find((item) => {
      const stock = stocks.get(stockKey(locationId, Number(item.item_id)));
      return !stock || stock.onHand + Number(item.qty_in_base) < 0;
    });
    if (scenario === "insufficient-stock" || invalid) {
      return json(response, 500, {
        statusCode: "500",
        error: "Internal Server Error",
        message: "This transaction will cause the inventory Qty on the shelf to be minus.",
        code: "P9005",
      });
    }

    for (const item of items) {
      const stock = stocks.get(stockKey(locationId, Number(item.item_id)))!;
      stock.onHand += Number(item.qty_in_base);
    }
    const id = nextAdjustmentId++;
    adjustments.set(id, {
      id,
      number: `ADJ-${String(id).padStart(9, "0")}`,
      note: String(body.note || ""),
      locationId,
      transactionDate: String(body.transaction_date || new Date().toISOString()),
      items,
    });

    if (scenario === "timeout-after-apply") {
      return setTimeout(() => json(response, 200, { status: "ok", id }), 30_000);
    }
    if (scenario === "malformed-success") {
      return json(response, 200, { status: "ok" });
    }
    return json(response, 200, { status: "ok", id });
  }

  if (method === "GET" && url.pathname === "/inventory/adjustments/") {
    const data = [...adjustments.values()].reverse().map((adjustment) => ({
      item_adj_id: adjustment.id,
      item_adj_no: adjustment.number,
      transaction_date: adjustment.transactionDate,
      created_date: adjustment.transactionDate,
      note: adjustment.note,
      location_id: adjustment.locationId,
      location_name: `Mock location ${adjustment.locationId}`,
      is_opening_balance: false,
      is_warehouse: true,
      is_from_opname: false,
      adjustment_type: null,
      created_by: "mock@jubelio.local",
    }));
    return json(response, 200, { data, totalCount: data.length });
  }

  const adjustmentDetail = url.pathname.match(/^\/inventory\/adjustments\/(\d+)$/);
  if (method === "GET" && adjustmentDetail) {
    const adjustment = adjustments.get(Number(adjustmentDetail[1]));
    if (!adjustment) return json(response, 404, { error: "Not Found" });
    return json(response, 200, {
      item_adj_id: adjustment.id,
      item_adj_no: adjustment.number,
      transaction_date: adjustment.transactionDate,
      note: adjustment.note,
      location_id: adjustment.locationId,
      items: adjustment.items,
    });
  }

  if (method === "POST" && url.pathname === "/inventory/items/all-stocks/") {
    const ids = Array.isArray(body.ids) ? body.ids.map(Number) : [];
    const data = ids.map((itemId) => ({
      item_id: itemId,
      item_code: `MOCK-${itemId}`,
      item_group_id: Math.floor(itemId / 10),
      location_stocks: [...stocks.values()]
        .filter((stock) => stock.itemId === itemId)
        .map((stock) => ({
          location_id: stock.locationId,
          on_hand: stock.onHand,
          reserved: 0,
          available: stock.onHand,
        })),
    }));
    return json(response, 200, { locations: [], data });
  }

  return json(response, 404, { error: "Not Found", path: url.pathname });
});

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.JUBELIO_MOCK_PORT || 3002);
  const host = process.env.JUBELIO_MOCK_HOST || "127.0.0.1";
  jubelioMockServer.listen(port, host, () => {
    console.log(`jubelio-mock listening on http://${host}:${port}`);
  });
}

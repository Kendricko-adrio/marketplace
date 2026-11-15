// Test-only loopback Jubelio fixture for the full bootstrap import.
// Never imported by runtime code and never talks to a real tenant.

import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";

export interface BootstrapFixtureScenario {
  /** Product groups exposed by /inventory/items/masters (default 201). */
  productGroups?: number;
  /** SKUs per group index; default is group 0 → 2 SKUs, others → 1 (202). */
  skusPerGroup?: number[];
  /** Provider locations; default 2. */
  locations?: number;
  /** Drop this many (SKU, location) stock observations. */
  missingStockPairs?: number;
  /** Stop serving groups after this page (simulates an interrupted pull). */
  failAfterPage?: number;
  /** Drop the last group during the second enumeration pass. */
  driftOnRecheck?: boolean;
}

export interface BootstrapFixtureServer {
  url: string;
  requests: {
    login: number;
    masters: number;
    catalog: number;
    stock: number;
  };
  /** Switch behaviour between runs and reset the per-run enumeration counter. */
  configure(next: BootstrapFixtureScenario): void;
  close(): Promise<void>;
}

const PAGE_SIZE_CAP = 1000;
const CATEGORY_USED = 900;
const CATEGORY_UNUSED = 901;

function readBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        resolve({});
      }
    });
    request.on("error", reject);
  });
}

function json(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
  });
  response.end(payload);
}

export async function startJubelioBootstrapFixture(
  scenarioInput: BootstrapFixtureScenario = {}
): Promise<BootstrapFixtureServer> {
  const state = {
    missingStockPairs: scenarioInput.missingStockPairs ?? 0,
    /** Remaining pairs to drop across the whole run (not per request). */
    remainingMissingPairs: scenarioInput.missingStockPairs ?? 0,
    driftOnRecheck: scenarioInput.driftOnRecheck ?? false,
    failAfterPage: scenarioInput.failAfterPage ?? null,
    /** Enumeration pass (0 = first full pull, 1 = drift recheck). */
    pass: 0,
    lastPage: 0,
  };
  const productGroups = scenarioInput.productGroups ?? 201;
  const locations = scenarioInput.locations ?? 2;

  const groupIds = Array.from(
    { length: productGroups },
    (_, index) => 100_000 + index
  );
  const skuCounts = groupIds.map(
    (_, index) => scenarioInput.skusPerGroup?.[index] ?? (index === 0 ? 2 : 1)
  );
  const skusByGroup = new Map<number, number[]>();
  let nextSku = 500_000;
  for (const [index, groupId] of groupIds.entries()) {
    const count = skuCounts[index] ?? 1;
    skusByGroup.set(
      groupId,
      Array.from({ length: count }, () => nextSku++)
    );
  }
  const groupBySku = new Map<number, number>();
  for (const [groupId, skus] of skusByGroup) {
    for (const sku of skus) groupBySku.set(sku, groupId);
  }

  const requests = { login: 0, masters: 0, catalog: 0, stock: 0 };

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const pathname = url.pathname;

    if (request.method === "POST" && pathname === "/login") {
      requests.login += 1;
      json(response, 200, { token: "fixture-token" });
      return;
    }

    if (pathname === "/locations/list") {
      json(response, 200, {
        data: Array.from({ length: locations }, (_, index) => ({
          location_id: index + 1,
          location_name: `Outlet ${index + 1}`,
          location_code: `OUT${index + 1}`,
          is_pos_outlet: true,
          is_active: true,
          city: "Kota Fixture",
          address: `Jalan Fixture ${index + 1}`,
        })),
        totalCount: locations,
      });
      return;
    }

    if (pathname === "/inventory/categories/item-categories/") {
      json(response, 200, [
        { category_id: CATEGORY_USED, category_name: "Terpakai", parent_id: 0, has_children: false },
        { category_id: CATEGORY_UNUSED, category_name: "Tidak Terpakai", parent_id: 0, has_children: false },
      ]);
      return;
    }

    if (pathname === "/inventory/items/masters") {
      requests.masters += 1;
      const page = Number(url.searchParams.get("page") ?? "1");
      const pageSize = Math.min(
        Number(url.searchParams.get("pageSize") ?? "200"),
        PAGE_SIZE_CAP
      );
      // A page-1 request that follows a later page starts the next enumeration
      // (the importer's drift recheck), independent of the configured page size.
      if (page === 1 && state.lastPage > 1) state.pass += 1;
      state.lastPage = page;
      const secondPass = state.pass > 0;
      if (state.failAfterPage !== null && page > state.failAfterPage) {
        json(response, 500, { error: "fixture failure" });
        return;
      }
      const effectiveGroups =
        state.driftOnRecheck && secondPass ? groupIds.slice(0, -1) : groupIds;
      const start = (page - 1) * pageSize;
      const slice = effectiveGroups.slice(start, start + pageSize);
      json(response, 200, {
        totalCount: effectiveGroups.length,
        data: slice.map((groupId) => ({
          item_group_id: groupId,
          item_name: `Produk ${groupId}`,
          item_category_id: CATEGORY_USED,
          sell_price: 100_000,
          thumbnail: `https://cdn.invalid/${groupId}.jpg`,
          variants: (skusByGroup.get(groupId) ?? []).map((itemId) => ({
            item_id: itemId,
            item_code: `SKU-${itemId}`,
            variation_values: [],
            sell_price: 100_000,
            barcode: null,
            available_qty: 10,
            end_qty: 10,
          })),
        })),
      });
      return;
    }

    const catalogMatch = pathname.match(/^\/inventory\/catalog\/(\d+)$/);
    if (catalogMatch) {
      requests.catalog += 1;
      const groupId = Number(catalogMatch[1]);
      json(response, 200, {
        item_group_id: groupId,
        item_group_name: `Produk ${groupId}`,
        description: null,
        sell_price: 100_000,
        item_category_id: CATEGORY_USED,
        selected_brand_name: "Fixture Brand",
        is_active: true,
        images: [],
        product_skus: (skusByGroup.get(groupId) ?? []).map((itemId) => ({
          item_id: itemId,
          item_code: `SKU-${itemId}`,
          sell_price: 100_000,
          barcode: null,
          variation_values: [],
        })),
      });
      return;
    }

    const itemMatch = pathname.match(/^\/inventory\/items\/(\d+)$/);
    if (itemMatch) {
      json(response, 200, { item_id: Number(itemMatch[1]) });
      return;
    }

    if (
      request.method === "POST" &&
      pathname === "/inventory/items/all-stocks/"
    ) {
      requests.stock += 1;
      const body = (await readBody(request)) as { ids?: unknown };
      const ids = Array.isArray(body.ids)
        ? body.ids.filter((id): id is number => typeof id === "number")
        : [];
      let dropRemaining = state.remainingMissingPairs;
      const data = ids.map((itemId) => {
        const locationStocks = Array.from({ length: locations }, (_, index) => {
          if (dropRemaining > 0) {
            dropRemaining -= 1;
            state.remainingMissingPairs = dropRemaining;
            return null;
          }
          return {
            location_id: index + 1,
            on_hand: 10,
            available: 10,
            reserved: 0,
            on_order: 0,
          };
        }).filter((entry): entry is NonNullable<typeof entry> => entry !== null);
        return {
          item_id: itemId,
          item_code: `SKU-${itemId}`,
          item_group_id: groupBySku.get(itemId) ?? 0,
          location_stocks: locationStocks,
        };
      });
      json(response, 200, {
        data,
        locations: Array.from({ length: locations }, (_, index) => ({
          location_id: index + 1,
          location_name: `Outlet ${index + 1}`,
          location_code: `OUT${index + 1}`,
          is_pos_outlet: true,
        })),
      });
      return;
    }

    json(response, 404, { error: "not found" });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("fixture server failed to bind a loopback port");
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    configure(next: BootstrapFixtureScenario) {
      state.missingStockPairs = next.missingStockPairs ?? 0;
      state.remainingMissingPairs = next.missingStockPairs ?? 0;
      state.driftOnRecheck = next.driftOnRecheck ?? false;
      state.failAfterPage = next.failAfterPage ?? null;
      state.pass = 0;
      state.lastPage = 0;
    },
    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

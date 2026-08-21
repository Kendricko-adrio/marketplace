import { createHash, randomInt } from "node:crypto";
import { pathToFileURL } from "node:url";

export type WebhookAction = "update-product" | "update-price" | "update-qty";
export type SimulatorAction = WebhookAction | "random";

export type SimulatorConfig = {
  apiBaseUrl: string;
  email: string;
  password: string;
  webhookUrl: string;
  webhookSecret: string;
  action: SimulatorAction;
  dryRun: boolean;
  pageSize: number;
  randomInt: (max: number) => number;
};

type Master = {
  item_group_id: number;
  item_name: string;
  variants: Array<{ item_id: number }>;
};

type MastersPage = { data: Master[]; totalCount: number };
type StockResponse = {
  locations?: Array<{ location_id: number }>;
  data?: Array<{
    item_id: number;
    location_stocks?: Array<{ location_id: number }>;
  }>;
};

export type SimulatorResult = {
  action: WebhookAction;
  payload: Record<string, unknown>;
  webhookStatus: number | null;
  selectedPage: number;
  totalCount: number;
};

type FetchImpl = typeof fetch;

export function createWebhookSignature(rawBody: string, secret: string): string {
  return createHash("sha256").update(rawBody + secret).digest("hex");
}

async function readJson<T>(response: Response, context: string): Promise<T> {
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${context} failed (${response.status}): ${body.slice(0, 300)}`);
  }
  return (await response.json()) as T;
}

function choose<T>(items: T[], random: (max: number) => number, label: string): T {
  if (items.length === 0) throw new Error(`Jubelio returned no ${label}`);
  return items[random(items.length)]!;
}

function selectAction(action: SimulatorAction, random: (max: number) => number): WebhookAction {
  if (action !== "random") return action;
  return choose(["update-product", "update-price", "update-qty"], random, "webhook actions");
}

export async function simulateJubelioWebhook(
  config: SimulatorConfig,
  fetchImpl: FetchImpl = fetch
): Promise<SimulatorResult> {
  const apiBaseUrl = config.apiBaseUrl.replace(/\/$/, "");
  const loginResponse = await fetchImpl(`${apiBaseUrl}/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: config.email, password: config.password }),
  });
  const login = await readJson<{ token?: string }>(loginResponse, "Jubelio login");
  if (!login.token) throw new Error("Jubelio login response is missing token");

  const headers = { authorization: login.token };
  const firstPageResponse = await fetchImpl(
    `${apiBaseUrl}/inventory/items/masters?page=1&pageSize=${config.pageSize}`,
    { headers }
  );
  const firstPage = await readJson<MastersPage>(firstPageResponse, "Jubelio masters count");
  if (firstPage.totalCount < 1) throw new Error("Jubelio returned no products");

  const pageCount = Math.ceil(firstPage.totalCount / config.pageSize);
  const selectedPage = 1 + config.randomInt(pageCount);
  const page = selectedPage === 1 && firstPage.data.length > 0
    ? firstPage
    : await readJson<MastersPage>(
        await fetchImpl(
          `${apiBaseUrl}/inventory/items/masters?page=${selectedPage}&pageSize=${config.pageSize}`,
          { headers }
        ),
        "Jubelio random masters page"
      );
  const master = choose(page.data, config.randomInt, "products");
  const action = selectAction(config.action, config.randomInt);
  const payload: Record<string, unknown> = {
    action,
    item_group_id: master.item_group_id,
    item_group_name: master.item_name,
  };

  if (action === "update-qty") {
    const itemIds = master.variants.map((variant) => variant.item_id);
    if (itemIds.length === 0) throw new Error("Selected Jubelio product has no variants");
    const stockResponse = await fetchImpl(`${apiBaseUrl}/inventory/items/all-stocks/`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ ids: itemIds }),
    });
    const stock = await readJson<StockResponse>(stockResponse, "Jubelio stock lookup");
    const locationId = stock.data?.flatMap((item) => item.location_stocks ?? [])[0]?.location_id
      ?? stock.locations?.[0]?.location_id;
    if (locationId == null) throw new Error("Selected Jubelio product has no stock location");
    payload.item_ids = itemIds;
    payload.location_id = locationId;
  }

  if (config.dryRun) {
    return { action, payload, webhookStatus: null, selectedPage, totalCount: firstPage.totalCount };
  }

  const rawBody = JSON.stringify(payload);
  const webhookResponse = await fetchImpl(config.webhookUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "webhook-signature": createWebhookSignature(rawBody, config.webhookSecret),
    },
    body: rawBody,
  });
  if (!webhookResponse.ok) {
    const body = await webhookResponse.text();
    throw new Error(`Webhook failed (${webhookResponse.status}): ${body.slice(0, 300)}`);
  }
  return { action, payload, webhookStatus: webhookResponse.status, selectedPage, totalCount: firstPage.totalCount };
}

function parseArgs(argv: string[], env: NodeJS.ProcessEnv): SimulatorConfig {
  const value = (name: string, fallback?: string): string => {
    const arg = argv.find((entry) => entry.startsWith(`--${name}=`));
    return arg ? arg.slice(name.length + 3) : (fallback ?? "");
  };
  const flag = (name: string): boolean => argv.includes(`--${name}`);
  const action = value("action", env.JUBELIO_SIMULATOR_ACTION || "random") as SimulatorAction;
  if (!["random", "update-product", "update-price", "update-qty"].includes(action)) {
    throw new Error(`Invalid --action: ${action}`);
  }
  const pageSize = Number(value("page-size", env.JUBELIO_SIMULATOR_PAGE_SIZE || "100"));
  if (!Number.isInteger(pageSize) || pageSize < 1) throw new Error("--page-size must be a positive integer");
  const apiBaseUrl = value("api-base-url", env.JUBELIO_API_BASE_URL || "https://api2.jubelio.com");
  const webhookUrl = value("webhook-url", env.JUBELIO_WEBHOOK_URL || "http://localhost:3000/api/webhooks/jubelio");
  const email = value("email", env.JUBELIO_EMAIL);
  const password = value("password", env.JUBELIO_PASSWORD);
  const webhookSecret = value("webhook-secret", env.JUBELIO_WEBHOOK_SECRET);
  if (!email || !password) throw new Error("Set JUBELIO_EMAIL and JUBELIO_PASSWORD");
  if (!webhookSecret && !flag("dry-run")) throw new Error("Set JUBELIO_WEBHOOK_SECRET (or use --dry-run)");
  return { apiBaseUrl, email, password, webhookUrl, webhookSecret, action, dryRun: flag("dry-run"), pageSize, randomInt };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const config = parseArgs(process.argv.slice(2), process.env);
    const result = await simulateJubelioWebhook(config);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

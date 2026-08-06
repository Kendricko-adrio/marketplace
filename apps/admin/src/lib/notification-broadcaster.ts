import { db, notifications, type Notification } from "@/db";
import { pool } from "@/db";
import { eq } from "drizzle-orm";

type PendingResolver = {
  id: string;
  resolve: (notification: Notification | null) => void;
  timer: ReturnType<typeof setTimeout>;
};

// In-memory broadcaster for long-polling notifications.
// Pending requests are keyed by the branch they are scoped to.
// HQ listeners are stored under the special "hq" key so they receive
// notifications for every branch.
const pending = new Map<string, PendingResolver[]>();

const DB_CHANNEL = "new_notification";
const LISTENER_STARTED = Symbol.for("marketplace:notificationListenerStarted");

async function fetchNotificationById(id: string): Promise<Notification | null> {
  const rows = await db
    .select()
    .from(notifications)
    .where(eq(notifications.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export function startDbListener() {
  // Guard against starting multiple listeners across hot reloads / evals.
  const globalStore = globalThis as unknown as Record<symbol, boolean>;
  if (globalStore[LISTENER_STARTED]) return;
  globalStore[LISTENER_STARTED] = true;

  (async () => {
    let client: import("pg").PoolClient | null = null;

    const connect = async () => {
      try {
        client = await pool.connect();
        await client.query(`LISTEN ${DB_CHANNEL}`);
        console.info(`[notifications] LISTEN ${DB_CHANNEL} connected — real-time poll wakeups active`);
        client.on("notification", async (msg) => {
          if (!msg.payload) return;
          try {
            const parsed = JSON.parse(msg.payload) as { id?: string };
            if (!parsed.id) return;
            const notification = await fetchNotificationById(parsed.id);
            if (notification) {
              emitNotification(notification);
            }
          } catch (error) {
            console.error("Failed to handle DB notification:", error);
          }
        });
        client.on("error", (err) => {
          console.error("Notification listener client error:", err);
          client?.release();
          reconnect();
        });
        client.on("end", () => {
          reconnect();
        });
      } catch (error) {
        console.error("Failed to start notification listener:", error);
        reconnect();
      }
    };

    const reconnect = () => {
      if (!globalStore[LISTENER_STARTED]) return;
      setTimeout(connect, 5000);
    };

    await connect();
  })();
}

// Auto-start listener when this module is first loaded.
startDbListener();

function keyForBranch(branchId: string): string {
  return `branch:${branchId}`;
}

const HQ_KEY = "hq";

function removePending(key: string, id: string) {
  const list = pending.get(key);
  if (!list) return;
  const filtered = list.filter((p) => p.id !== id);
  if (filtered.length === 0) {
    pending.delete(key);
  } else {
    pending.set(key, filtered);
  }
}

export function waitForNotification(
  scope: { mode: "all" } | { mode: "own"; branchId: string },
  timeoutMs = 25000
): Promise<Notification | null> {
  const keys = scope.mode === "all" ? [HQ_KEY] : [keyForBranch(scope.branchId)];

  return new Promise((resolve) => {
    let settled = false;

    const resolver: PendingResolver = {
      id: crypto.randomUUID(),
      resolve: (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      },
      timer: setTimeout(() => {
        for (const key of keys) {
          removePending(key, resolver.id);
        }
        resolver.resolve(null);
      }, timeoutMs),
    };

    for (const key of keys) {
      const list = pending.get(key) ?? [];
      list.push(resolver);
      pending.set(key, list);
    }
  });
}

export function emitNotification(notification: Notification) {
  const keys = [keyForBranch(notification.branchId), HQ_KEY];

  for (const key of keys) {
    const resolvers = pending.get(key);
    if (!resolvers) continue;
    pending.delete(key);

    for (const resolver of resolvers) {
      clearTimeout(resolver.timer);
      resolver.resolve(notification);
    }
  }
}

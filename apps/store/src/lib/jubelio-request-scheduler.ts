export type JubelioRequestPriority = 0 | 10 | number;

export type JubelioRequestQueueErrorCode = "QUEUE_FULL" | "QUEUE_TIMEOUT";

export class JubelioRequestQueueError extends Error {
  readonly code: JubelioRequestQueueErrorCode;

  constructor(code: JubelioRequestQueueErrorCode) {
    super(
      code === "QUEUE_FULL"
        ? "Jubelio request queue is full"
        : "Jubelio request queue wait timed out"
    );
    this.name = "JubelioRequestQueueError";
    this.code = code;
  }
}

export type JubelioRequestScheduler = {
  schedule<T>(
    task: () => Promise<T>,
    options?: { priority?: JubelioRequestPriority }
  ): Promise<T>;
  readonly activeCount: number;
  readonly queuedCount: number;
};

type QueueEntry<T = unknown> = {
  sequence: number;
  priority: number;
  task: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
  timeout?: ReturnType<typeof setTimeout>;
};

const sharedSchedulers = new Map<string, JubelioRequestScheduler>();

export function getSharedJubelioRequestScheduler(options: {
  key: string;
  maxConcurrent: number;
  maxRequestsPerMinute: number;
  maxQueued?: number;
  queueTimeoutMs?: number;
}): JubelioRequestScheduler {
  const cacheKey = `${options.key}:${options.maxConcurrent}:${options.maxRequestsPerMinute}:${options.maxQueued ?? 1_000}:${options.queueTimeoutMs ?? 10_000}`;
  const existing = sharedSchedulers.get(cacheKey);
  if (existing) return existing;
  const scheduler = createJubelioRequestScheduler(options);
  sharedSchedulers.set(cacheKey, scheduler);
  return scheduler;
}

/**
 * Process-local provider scheduler. It combines a concurrency cap with evenly
 * spaced request starts, which prevents a burst from crossing Jubelio's
 * documented per-minute limit. Higher-priority work stays FIFO within its own
 * priority level.
 */
export function createJubelioRequestScheduler({
  maxConcurrent,
  maxRequestsPerMinute,
  maxQueued = 1_000,
  queueTimeoutMs = 10_000,
}: {
  maxConcurrent: number;
  maxRequestsPerMinute: number;
  maxQueued?: number;
  queueTimeoutMs?: number;
}): JubelioRequestScheduler {
  const concurrency = Math.max(1, Math.floor(maxConcurrent));
  const requestsPerMinute = Math.max(1, Math.floor(maxRequestsPerMinute));
  const queueLimit = Math.max(1, Math.floor(maxQueued));
  const waitTimeoutMs = Math.max(1, Math.floor(queueTimeoutMs));
  const startIntervalMs = Math.ceil(60_000 / requestsPerMinute);
  const queue: QueueEntry[] = [];
  let activeCount = 0;
  let sequence = 0;
  let nextStartAt = 0;
  let wakeTimer: ReturnType<typeof setTimeout> | null = null;

  function sortQueue(): void {
    queue.sort(
      (left, right) =>
        right.priority - left.priority || left.sequence - right.sequence
    );
  }

  function scheduleWake(waitMs: number): void {
    if (wakeTimer) return;
    wakeTimer = setTimeout(() => {
      wakeTimer = null;
      pump();
    }, waitMs);
    wakeTimer.unref?.();
  }

  function pump(): void {
    if (wakeTimer || activeCount >= concurrency || queue.length === 0) return;

    const waitMs = Math.max(0, nextStartAt - Date.now());
    if (waitMs > 0) {
      scheduleWake(waitMs);
      return;
    }

    const entry = queue.shift()!;
    if (entry.timeout) clearTimeout(entry.timeout);
    activeCount++;
    nextStartAt = Date.now() + startIntervalMs;
    Promise.resolve()
      .then(entry.task)
      .then(entry.resolve, entry.reject)
      .finally(() => {
        activeCount--;
        pump();
      });

    // A second request may start after the pacing interval even while the
    // current one is still active, up to the concurrency limit.
    if (activeCount < concurrency && queue.length > 0) {
      scheduleWake(startIntervalMs);
    }
  }

  return {
    schedule<T>(
      task: () => Promise<T>,
      options: { priority?: JubelioRequestPriority } = {}
    ): Promise<T> {
      if (queue.length >= queueLimit) {
        return Promise.reject(new JubelioRequestQueueError("QUEUE_FULL"));
      }
      return new Promise<T>((resolve, reject) => {
        const entry: QueueEntry = {
          sequence: sequence++,
          priority: options.priority ?? 0,
          task,
          resolve: (value) => resolve(value as T),
          reject,
        };
        entry.timeout = setTimeout(() => {
          const index = queue.indexOf(entry);
          if (index === -1) return;
          queue.splice(index, 1);
          reject(new JubelioRequestQueueError("QUEUE_TIMEOUT"));
          pump();
        }, waitTimeoutMs);
        entry.timeout.unref?.();
        queue.push(entry);
        sortQueue();
        pump();
      });
    },
    get activeCount() {
      return activeCount;
    },
    get queuedCount() {
      return queue.length;
    },
  };
}

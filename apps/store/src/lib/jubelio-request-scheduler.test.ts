import { afterEach, describe, expect, it, vi } from "vitest";
import {
  JubelioRequestQueueError,
  createJubelioRequestScheduler,
} from "./jubelio-request-scheduler";

afterEach(() => {
  vi.useRealTimers();
});

describe("Jubelio request scheduler", () => {
  it("never exceeds the configured concurrent request limit", async () => {
    const scheduler = createJubelioRequestScheduler({
      maxConcurrent: 1,
      maxRequestsPerMinute: 60_000,
    });
    let active = 0;
    let maxActive = 0;
    const releases: Array<() => void> = [];
    const task = () =>
      scheduler.schedule(async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise<void>((resolve) => releases.push(resolve));
        active--;
      });

    const first = task();
    const second = task();
    await vi.waitFor(() => expect(releases).toHaveLength(1));
    expect(maxActive).toBe(1);

    releases.shift()!();
    await vi.waitFor(() => expect(releases).toHaveLength(1));
    releases.shift()!();
    await Promise.all([first, second]);
    expect(maxActive).toBe(1);
  });

  it("paces request starts so the configured per-minute limit is not exceeded", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-25T00:00:00.000Z"));
    const scheduler = createJubelioRequestScheduler({
      maxConcurrent: 10,
      maxRequestsPerMinute: 60,
    });
    const starts: number[] = [];

    const first = scheduler.schedule(async () => starts.push(Date.now()));
    const second = scheduler.schedule(async () => starts.push(Date.now()));
    await vi.advanceTimersByTimeAsync(0);
    expect(starts).toEqual([Date.parse("2026-08-25T00:00:00.000Z")]);

    await vi.advanceTimersByTimeAsync(999);
    expect(starts).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await Promise.all([first, second]);
    expect(starts[1] - starts[0]).toBe(1_000);
  });

  it("rejects work that waits in the queue beyond its deadline", async () => {
    vi.useFakeTimers();
    const scheduler = createJubelioRequestScheduler({
      maxConcurrent: 1,
      maxRequestsPerMinute: 60_000,
      queueTimeoutMs: 100,
    });
    let releaseBlocker!: () => void;
    const blocker = scheduler.schedule(
      () => new Promise<void>((resolve) => (releaseBlocker = resolve))
    );
    await vi.advanceTimersByTimeAsync(0);
    const queued = scheduler.schedule(async () => undefined);
    const rejection = expect(queued).rejects.toMatchObject({
      name: "JubelioRequestQueueError",
      code: "QUEUE_TIMEOUT",
    });

    await vi.advanceTimersByTimeAsync(100);
    await rejection;
    releaseBlocker();
    await blocker;
  });

  it("rejects new work immediately when the queue is full", async () => {
    const scheduler = createJubelioRequestScheduler({
      maxConcurrent: 1,
      maxRequestsPerMinute: 60_000,
      maxQueued: 1,
    });
    let releaseBlocker!: () => void;
    const blocker = scheduler.schedule(
      () => new Promise<void>((resolve) => (releaseBlocker = resolve))
    );
    await vi.waitFor(() => expect(releaseBlocker).toBeTypeOf("function"));
    const queued = scheduler.schedule(async () => undefined);

    await expect(scheduler.schedule(async () => undefined)).rejects.toEqual(
      new JubelioRequestQueueError("QUEUE_FULL")
    );
    releaseBlocker();
    await Promise.all([blocker, queued]);
  });

  it("keeps a 1,000-request burst within bounded process concurrency", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-25T00:00:00.000Z"));
    const scheduler = createJubelioRequestScheduler({
      maxConcurrent: 10,
      maxRequestsPerMinute: 60_000,
      maxQueued: 1_000,
      queueTimeoutMs: 60_000,
    });
    let active = 0;
    let maxActive = 0;
    let completed = 0;

    const burst = Promise.all(
      Array.from({ length: 1_000 }, (_, index) =>
        scheduler.schedule(async () => {
          active++;
          maxActive = Math.max(maxActive, active);
          await new Promise<void>((resolve) => setTimeout(resolve, 20));
          active--;
          completed++;
          return index;
        })
      )
    );
    await vi.runAllTimersAsync();
    await burst;

    expect(completed).toBe(1_000);
    expect(maxActive).toBeLessThanOrEqual(10);
    expect(scheduler.queuedCount).toBe(0);
  });

  it("runs release work before queued checkout work", async () => {
    const scheduler = createJubelioRequestScheduler({
      maxConcurrent: 1,
      maxRequestsPerMinute: 60_000,
    });
    const order: string[] = [];
    let releaseBlocker!: () => void;
    const blocker = scheduler.schedule(
      () => new Promise<void>((resolve) => (releaseBlocker = resolve))
    );
    await vi.waitFor(() => expect(releaseBlocker).toBeTypeOf("function"));

    const checkout = scheduler.schedule(async () => order.push("checkout"), {
      priority: 0,
    });
    const release = scheduler.schedule(async () => order.push("release"), {
      priority: 10,
    });
    releaseBlocker();
    await Promise.all([blocker, checkout, release]);

    expect(order).toEqual(["release", "checkout"]);
  });
});

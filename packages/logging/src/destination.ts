import type { LogDestination } from "./logger.js";

/**
 * Failure guard for stream-like line sinks (`process.stdout` in production, a
 * custom stream in tests).
 *
 * A sink does not always fail synchronously: a closed pipe (log rotation, a
 * container log driver restarting, `| head`) reports `EPIPE` by emitting an
 * asynchronous `error` event on the stream. Node turns an unhandled `error`
 * event into an `uncaughtException`, so a `try/catch` around `write` is not
 * enough to keep the "logging never breaks business flow" contract.
 *
 * This guard attaches exactly one listener per physical destination — cached by
 * identity, so two factories sharing a stream do not stack listeners — and
 * flips a flag instead of rethrowing. `write` on the caller's destination is
 * never replaced and the failure is never printed anywhere else: a stderr write
 * could recurse into logging, and a fallback write could duplicate lines.
 *
 * Boundary, on purpose: once the sink has reported a failure, later lines are
 * dropped instead of retried. Delivery is therefore not guaranteed while the
 * sink is down — losing log lines is cheaper than crashing the process or
 * looping on a broken pipe.
 */

const guards = new WeakMap<LogDestination, LogDestination>();

export function guardDestination(destination: LogDestination): LogDestination {
  // A plain write-only sink has no failure channel to observe; wrapping it
  // would only add a pass-through frame.
  if (destination.on === undefined) {
    return destination;
  }

  const cached = guards.get(destination);
  if (cached !== undefined) {
    return cached;
  }

  let down = false;
  const guard: LogDestination = {
    write(line: string): void {
      if (down) {
        return;
      }
      destination.write(line);
    },
  };

  // Registered as a method of the destination itself: Node emitter
  // implementations depend on `this`.
  destination.on("error", () => {
    down = true;
  });

  guards.set(destination, guard);
  return guard;
}

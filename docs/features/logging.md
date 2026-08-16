# Structured Logging

The order flow (store checkout/payment + admin order/notification handling)
logs through a small structured logger in each app
(`apps/store/src/lib/logger.ts` and `apps/admin/src/lib/logger.ts` — identical
implementations). Every log line is a **single JSON object** on stdout, so it
can be ingested by a log aggregator (Loki, Datadog, Vercel logs, …) and
queried by `requestId` / `orderId` / `module`.

## Purpose

- Correlate all logs within one request via `requestId`.
- Trace a request across edge → app → downstream calls by honoring an upstream
  `x-request-id` header.
- Keep the order lifecycle auditable: place-order → Midtrans webhook →
  finalize → admin actions, each with structured context.

## Log format

Each record is one JSON line:

| Field | Notes |
|---|---|
| `timestamp` | ISO-8601 UTC (`new Date().toISOString()`) |
| `level` | `debug` \| `info` \| `warn` \| `error` |
| `requestId` | UUID; from `x-request-id` header if present, else generated |
| `message` | Human-readable description of the action |
| `…context` | Arbitrary structured fields — bound via `child()` or passed per call (e.g. `orderId`, `status`, `branchId`, `total`, `pickupCode`) |

Routing: `error` → `console.error`, `warn` → `console.warn`, everything else →
`console.log`, so platform log filters work. If a context value is not
JSON-serializable (e.g. a thrown `Error`), the record falls back to
`{ ...record, message: String(message) }` so the log is never lost.

## API

| Function | Behavior |
|---|---|
| `createLogger(context?, requestId?)` | Standalone logger (lib code not tied to a request); generates a fresh `requestId` if omitted |
| `requestLogger(request, context?)` | Logger bound to the request; honors the `x-request-id` header |
| `withRequestId(response, logger)` | Stamps `x-request-id` on the response so the client can reference it when reporting an issue |
| `serializeError(error)` | Converts an unknown catch value into a plain object (`name`/`message`/`stack` for `Error`, `{ value }` otherwise) |
| `logger.child(context)` | New logger with extra bound context, **same `requestId`** |

Level filtering: `LOG_LEVEL` env var (`debug` \| `info` \| `warn` \| `error`),
default `info`.

## Usage

```ts
import { requestLogger, withRequestId, serializeError } from "@/lib/logger";

export const POST = async (request: NextRequest) => {
  let log = requestLogger(request, { module: "place-order" });
  log.info("place order requested");
  // ...
  log = log.child({ orderId });
  log.info("order placed successfully", { total, ttlMinutes });
  // ...
  log.error("place order failed", { error: serializeError(error) });
  return withRequestId(NextResponse.json(...), log);
};
```

## Where it is used

**Store (`apps/store/src`):**

| File | What is logged |
|---|---|
| `lib/order-finalize.ts` | `order paid → ready_for_pickup` (with `pickupCode`), `order failed_payment` (with `midtransStatus`/`reason`), notification-insert and email failures |
| `app/api/checkout/place-order/route.ts` | Request start, validation warnings, order creation, success (with `total`/`ttlMinutes`), stock rollback, Midtrans failure, catch-all errors |
| `app/api/cart/validate-checkout/route.ts` | Validation requested/passed, unauthorized, invalid body, branch-inactive and insufficient-stock cart adjustments |
| `app/api/webhooks/midtrans/route.ts` | Webhook received (`order_id`, `transaction_status`, `status_code`), missing fields, invalid signature, handler failure |
| `app/api/internal/order-complete/route.ts` | Missing `orderId`, completion email failure, catch-all errors |

**Admin (`apps/admin/src`):**

| File | What is logged |
|---|---|
| `app/api/admin/orders/route.ts` | List requested (with `status`/`branchIdParam`/`page`/`limit`) and served (`total`/`page`) |
| `app/api/admin/orders/[id]/route.ts` | Not found, forbidden (different branch), detail served |
| `app/api/admin/orders/[id]/verify-pickup/route.ts` | Verify-pickup failures |
| `app/api/admin/notifications/route.ts` | List requested/served |
| `app/api/admin/notifications/[id]/route.ts` | Marked read, deleted |
| `app/api/admin/notifications/poll/route.ts` | Poll initial, catch-up, wakeup, failures |
| `app/api/admin/notifications/mark-all-read/route.ts`, `clear-all-read/route.ts` | Bulk operations with affected counts |

## Notes

- **No log rotation / file output config exists** — logs go to stdout via
  `console.*`; rotation and retention are the platform's job (Vercel logs,
  Docker log driver, etc.). There is no pino/winston/rotation setup anywhere
  in the repo.
- The two `logger.ts` files are intentionally identical copies (per-app lib,
  no shared package yet) — keep them in sync when changing the format.
- `LOG_LEVEL` is the only knob; `debug` lines are emitted only when set to
  `debug`.

## Verification

- `npm run dev:store` → place an order → the terminal shows one JSON line per
  step, e.g.
  `{"timestamp":"…","level":"info","requestId":"…","message":"order placed successfully","module":"place-order","orderId":"…","total":…}`.
- All lines for one request share the same `requestId`; the response carries
  the same value in the `x-request-id` header.
- Send a request with an `x-request-id` header → logs reuse that id.
- `LOG_LEVEL=debug npm run dev:store` → debug lines appear; default (`info`)
  suppresses them.
- Midtrans webhook retry → both attempts log the same `order_id` with distinct
  `requestId`s.

Endpoint-level behavior is documented in `docs/api-reference.md` (order,
checkout, webhook, and notification endpoints).

# Code organization — Route Handlers, services, and repositories

**Status:** Agreed direction for future refactors and new code. This document records a convention, **not** a claim that the existing code has already been migrated. For the source research and current examples, see [Next.js API organization research](nextjs-api-organization-research.md).

## Decision

Organize application code **by feature/domain**, with a thin HTTP adapter at each Next.js entry point. Use a named service/use-case module for nontrivial business flows. Add a repository/data-access module when persistence is complex, reused, or has authorization/scope rules to centralize; **do not require a repository (or even a service) for every simple endpoint**. These are plain TypeScript modules and functions, not framework-managed classes or a mandatory Spring Boot-style directory hierarchy.

```text
HTTP request → app/api/**/route.ts → features/<domain>/*-service.ts
                                         ├── *-repository.ts → app-local @/db
                                         ├── domain helpers / policies
                                         └── external integration clients
```

This is our project convention, not a Next.js requirement: Next.js specifies `route.ts` and named HTTP method exports but leaves code organization open. Its security guidance recommends server-only data-access functions, authorization close to data, and minimal DTOs. See [Route Handlers](https://nextjs.org/docs/app/getting-started/route-handlers), [project structure](https://nextjs.org/docs/app/getting-started/project-structure), and [data security](https://nextjs.org/docs/app/guides/data-security).

## Proposed folder layout

New folders are added **when needed**, not as an empty skeleton across all features. Keep the existing API URLs unchanged during a structural refactor.

```text
apps/store/src/
├── app/
│   └── api/
│       ├── checkout/place-order/route.ts   # public HTTP contract
│       ├── products/route.ts
│       └── webhooks/midtrans/route.ts
├── features/
│   ├── checkout/
│   │   ├── place-order-service.ts          # use case and orchestration
│   │   ├── checkout-repository.ts          # scoped queries and persistence, if useful
│   │   ├── place-order.schema.ts           # input schema, if shared/large
│   │   └── place-order-service.test.ts
│   ├── catalog/
│   │   ├── list-products.ts                 # query/DAL; no ceremonial service needed
│   │   └── list-products.test.ts
│   └── payments/
│       ├── midtrans-client.ts              # provider adapter, NOT a repository
│       └── handle-notification-service.ts
├── db/index.ts                              # this app's runtime DB instance
└── lib/                                     # cross-feature utilities (logger, auth, etc.)

apps/admin/src/
├── app/api/admin/...
├── features/
│   ├── roles/                               # migrate existing lib/rbac modules only if useful
│   └── orders/
├── db/index.ts
└── lib/

packages/db/src/schema/                     # sole owner of shared table definitions
```

The filenames above are **illustrative future locations**, not an inventory of existing files. Prefer specific names (`place-order-service.ts`, `checkout-repository.ts`) to a feature folder full of ambiguous `service.ts` files. Keep tests next to the code they exercise, following the repo's current test conventions.

## Layer responsibilities

| Layer | Owns | Must not become |
| --- | --- | --- |
| `app/api/**/route.ts` (HTTP adapter / controller) | Parse request and params; establish store or admin actor; validate untrusted input; invoke service/query; map expected outcomes/errors to existing status/body; structured success/failure logging and request ID | The place for long DB queries, pricing, stock rules, or provider orchestration |
| `features/<domain>/*-service.ts` (use case) | Business invariants, operation sequencing, transaction boundaries, compensation, typed input/outcome; coordinate repositories and provider clients | A wrapper that merely forwards parameters; a module tied to `NextRequest` or `NextResponse` |
| `features/<domain>/*-repository.ts` (DAL/persistence) | Focused Drizzle queries, writes, and explicit safe projections; enforce ownership/branch scope at or near access to sensitive resources | A generic CRUD wrapper for every table; a home for Midtrans/Jubelio HTTP calls |
| `features/<domain>/*-client.ts` (integration adapter) | External provider calls and protocol translation | A replacement for a DB repository or a reason to call a provider inside a DB transaction |
| Pure helpers / schemas | Input contracts, calculations, deterministic domain rules | A dumping ground for unrelated features |

The route checks entry-point access, **and** service/repository functions that can be reused by another caller must not rely on that check alone. Carry a typed actor/scope where needed and enforce resource-level permissions in the data/use-case path. Do not leak full DB rows to clients: shape minimal response DTOs. `import 'server-only'` on server-specific modules is appropriate when those modules might otherwise be imported into Client Components. See [data security](https://nextjs.org/docs/app/guides/data-security) and the existing [admin order detail scope check](../../apps/admin/src/app/api/admin/orders/%5Bid%5D/route.ts).

**Example:** an own-branch admin requests an order ID belonging to another branch. The order query must preserve the existing cross-branch **404** behavior even if it is later reused outside the HTTP route; checking only the admin page or route guard is insufficient. See [admin order detail](../../apps/admin/src/app/api/admin/orders/%5Bid%5D/route.ts) and [auth architecture](auth.md).

## When to introduce a layer

- **Simple endpoint:** a short route with one localized query and no substantial business rule may stay in `route.ts`. Extract a named query function when data scope, response safety, reuse, or readability calls for it.
- **Multi-step business operation:** create a `*-service.ts` with a clear use-case name, even if there is only one caller. For example, checkout must coordinate stock holds, order persistence, Jubelio, and payment.
- **Complex or sensitive persistence:** create a focused `*-repository.ts` (or another clearly named DAL module) for related queries, scoped reads, and atomic updates. Do not create a separate repository file for every table or endpoint by default.
- **External provider:** use a dedicated client/adapter for Jubelio, Midtrans, SMTP, etc., owned by the relevant feature or shared deliberately across features. A DB transaction cannot atomically commit an external HTTP operation; preserve existing intent, idempotency, ordering, and compensation semantics.
- **Shared across store and admin:** do not import one app's `@/db` or auth into the other. Keep app-specific adapters in their apps. Only put genuinely shared, app-independent logic in a shared package; if DB access is shared, pass an explicit app DB/transaction and actor rather than using the shared package's script-only DB. The shared **schema** remains exclusively in `packages/db/src/schema/`. See [overview](overview.md) and [database](database.md).

The existing [admin roles route](../../apps/admin/src/app/api/admin/roles/route.ts) delegating to [roles-service](../../apps/admin/src/lib/rbac/roles-service.ts) is a useful intermediate example. Renaming/moving all working `lib/` modules is **not** a prerequisite: migrate incrementally as related features are touched.

## Route Handlers versus other Next.js entry points

A Route Handler remains appropriate for browser-side HTTP calls, webhooks, cron, and external callers. A Server Component should normally call an authorized server-side data function directly instead of fetching its own app's HTTP API. Server Actions can be used for UI-triggered mutations but are independently reachable entry points: they require the same input validation and authorization, and can call the same use case. Do not replace existing HTTP APIs with actions merely to shorten files. See the [Next.js Backend-for-Frontend guide](https://nextjs.org/docs/app/guides/backend-for-frontend#caveats) and [data security guide](https://nextjs.org/docs/app/guides/data-security#mutating-data).

## Refactor checklist

1. Pick **one vertical slice**. Record existing request/response shapes, error codes, logs/request IDs, auth and branch scope, and external side effects in tests before moving logic. Follow the [testing requirements](../../AGENTS.md) and [testing guide](../testing/README.md).
2. Extract a cohesive service first, then extract persistence into a repository where it makes the invariants and authorization clearer. Keep transaction scopes and external-call order intact; do not move provider calls inside DB transactions.
3. Keep HTTP-specific types/responses at the boundary. Use typed inputs and outcomes in the service, and map them to the **unchanged** HTTP contract in the route. Preserve structured `info` success and contextual `error` failure logging for `/api/**` per [logging](../features/logging.md).
4. Verify unit, DB/integration, and relevant Playwright E2E behavior as required by the change. Only then repeat for another feature. A structural move does not justify behavior drift.

**Checkout example:** for stale provider stock, `POST /api/checkout/place-order` must still return the existing retryable response without committing an order/stock hold or starting payment. Moving that logic into a service/repository is valuable only if the same invariant remains visible and tested. See [current handler](../../apps/store/src/app/api/checkout/place-order/route.ts) and [stock reservation](../features/stock-reservation.md).

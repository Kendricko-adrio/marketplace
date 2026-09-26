# Research — Organizing Next.js API code in this marketplace

Status: background research, **not** an implemented refactor. The agreed code-organization convention is recorded in [code-organization.md](code-organization.md); use that document for future refactors. Consulted official Next.js App Router documentation (including Context7's indexed Next.js 16 documentation) and this repository. These are design recommendations, not Next.js-enforced layers.

## What Next.js actually requires

- `app/**/route.ts` defines an HTTP endpoint; named exports (`GET`, `POST`, etc.) are the entry points. It uses Web `Request`/`Response`, optionally `NextRequest`/`NextResponse`. Next.js does **not** require business logic to live in those functions, nor prescribe controller/service/repository directories. A `route.ts` and a `page.tsx` cannot own the same URL segment. [Route Handlers](https://nextjs.org/docs/app/getting-started/route-handlers), [project structure](https://nextjs.org/docs/app/getting-started/project-structure).
- Next.js supports colocated implementation files under route segments and private `_lib` folders, as well as separate feature folders outside `app`; only special routing files expose routes. The official project-structure guide explicitly says to choose a consistent strategy. [Project structure](https://nextjs.org/docs/app/getting-started/project-structure).
- Route Handlers are publicly reachable HTTP interfaces, useful for browser requests, external clients, webhooks and callbacks; validate payloads and authorize access. Next.js's Backend-for-Frontend (BFF) guidance even illustrates a `POST` that delegates to an imported helper. [BFF guide](https://nextjs.org/docs/app/guides/backend-for-frontend), [authentication guide](https://nextjs.org/docs/app/guides/authentication).
- For new projects, Next.js recommends a **server-only Data Access Layer (DAL)** that enforces authorization and returns minimal safe DTOs; a thin Route Handler (or Server Action) can delegate to it. A page/layout/proxy check is not a substitute for checking access near sensitive data. [Data security](https://nextjs.org/docs/app/guides/data-security), [authentication](https://nextjs.org/docs/app/guides/authentication).
- Server Components should usually call server-side data functions directly rather than `fetch` their own Route Handlers (extra HTTP round trip and build-time caveat). Browser-side dynamic requests, external callers and webhooks still need HTTP endpoints. Server Actions are primarily for UI-triggered mutations; they are also public entry points and require validation/auth. Do not convert existing HTTP contracts automatically just to shorten `route.ts`. [BFF guide — caveats](https://nextjs.org/docs/app/guides/backend-for-frontend#caveats), [data security — mutations](https://nextjs.org/docs/app/guides/data-security#mutating-data).

## Spring Boot mapping (conceptual, not mandatory)

| Spring Boot role | Practical Next.js/TypeScript equivalent |
| --- | --- |
| `@RestController` | `app/api/**/route.ts` HTTP adapter (GET/POST/etc.) |
| `@Service` | Plain server-only functions in `src/features/<domain>/service.ts` or existing `src/lib/<domain>-service.ts` for use cases and transaction orchestration |
| `@Repository` | Optional query/persistence modules or DAL functions around the app's Drizzle `db`; not needed for every trivial query |
| DTO / request validation | Explicit input schema at the boundary; minimal output projection in DAL/service |
| Security filter / authorization | `proxy.ts` for coarse routing checks; per-handler and data-level authorization for actual access |

**Our proposed layering:** HTTP adapter → use-case/service (domain rules, transaction orchestration) → query/persistence functions (`db`/Drizzle). Put shared pure calculations/validators in their own modules. This is a *team design choice* that complements, rather than replaces, Next.js's DAL/security recommendations. Small CRUD endpoints need not have three ceremonial files. Services called by more than one entry point must not assume their caller already authorized the operation; retain resource/scope checks at the data boundary.

Possible home for checkout (illustrative only; no code was moved):

```text
apps/store/src/app/api/checkout/place-order/route.ts     # auth, parse, log, map HTTP errors
apps/store/src/features/checkout/place-order.ts           # use case; orchestration
apps/store/src/features/checkout/checkout-data.ts         # scoped DB queries/transactions
apps/store/src/features/checkout/place-order.schema.ts    # if shared across boundaries
```

Keep **store** and **admin** session/auth contexts distinct; runtime app `db` instances remain local (`@/db`), while shared table definitions are owned exclusively by `packages/db/src/schema/`. See [overview](overview.md), [auth](auth.md), and [database](database.md). A cross-app shared module should accept a clearly specified app DB and actor context, not import one app's auth or script-only DB implicitly.

## Evidence from this repo (inspection; not a full audit)

- The clearest bloat example is [`apps/store/src/app/api/checkout/place-order/route.ts`](../../apps/store/src/app/api/checkout/place-order/route.ts): **648 lines** at inspection. Its `POST` starts at line 76, then combines session/validation, cart and branch queries, pricing, provider stock verification (around line 260), DB transaction and stock holds (around line 350), Jubelio SO creation (around line 443), and Midtrans initialization (around line 513). Some helpers already exist; the remaining orchestration still lives inside the HTTP handler. Candidate for a carefully staged use-case extraction, not a mechanical move: preserve stock concurrency, transaction boundaries, provider-call ordering, compensation, existing HTTP responses and logging.
- [`apps/store/src/app/api/products/route.ts`](../../apps/store/src/app/api/products/route.ts) is **360 lines**, much of it building listing/filtering queries (`GET` line 33). A named `listProducts` query/DAL and narrow result projection could make the route easier to scan and potentially reusable by server rendering; preserve current filters, sort and pagination semantics.
- [`apps/admin/src/app/api/admin/orders/[id]/route.ts`](../../apps/admin/src/app/api/admin/orders/%5Bid%5D/route.ts) resolves RBAC scope near line 35 and separately checks the loaded order's branch at lines 105–114. If extracting its queries, do **not** make an unscoped order query callable without authorization: ownership/branch-scoping and minimal DTO must remain enforced at or near data access. In particular, maintain the cross-branch 404 behavior.
- A useful existing pattern is [`apps/admin/src/app/api/admin/roles/route.ts`](../../apps/admin/src/app/api/admin/roles/route.ts) (roughly 100 lines): `GET` and `POST` guard, parse, delegate to [`roles-service.ts`](../../apps/admin/src/lib/rbac/roles-service.ts), and shape/log the response; the service handles transactions and role policies. This is evidence that service layering already exists here, not a new framework requirement.
- The role list and order pages currently issue browser-side API fetches (e.g. [`roles-list-client.tsx`](../../apps/admin/src/app/admin/roles/roles-list-client.tsx), [`orders/[id]/page.tsx`](../../apps/admin/src/app/admin/orders/%5Bid%5D/page.tsx)). These **client-side** fetches are not the anti-pattern from the BFF guide; its warning is about **Server Components** fetching their own internal Route Handler over HTTP.

## Suggested incremental refactor (proposal)

1. Pick one painful endpoint; record its current HTTP contract and invariants in tests first. For checkout, include success, invalid input, auth, depleted/stale stock, provider rejection/unknown, transaction rollback, and payment compensation. Keep existing end-to-end flows too. No endpoint changes as part of the first extraction.
2. Extract **one cohesive use case** with typed input/output and explicit dependencies (DB, actor, logger/provider adapters where needed). Preserve the boundary between DB transactions and remote calls. Keep expected domain outcomes separate from unexpected failures; map only at the route boundary, preserving status codes and request IDs.
3. Move scoped queries/persistence into focused DAL functions as reuse/security demands; return explicit DTOs rather than whole joined table rows. Keep `server-only` on server-specific modules where appropriate; do not put HTTP `Request`/`NextResponse` into reusable domain/query functions.
4. Make the route responsible for per-request auth, input parsing, HTTP response mapping and structured logging; retain defense-in-depth resource authorization inside services/DAL. Unit-test use-case rules and route mapping; integration-test transactional/concurrency invariants and E2E-test user-visible flows before and after.
5. Repeat opportunistically. Avoid blanket repository abstractions, migrating all existing browser fetches to Server Actions, or splitting files solely to hit a line-count target.

**Example expected behavior:** `POST /api/checkout/place-order` with selected items whose available provider stock is stale must still return the current retryable error, without committing an order/stock hold or charging a payment. Refactoring moves the checks to named units, not their sequencing or outward behavior; see [existing handler](../../apps/store/src/app/api/checkout/place-order/route.ts) and [stock-reservation invariants](../features/stock-reservation.md).

## Primary references

1. Next.js, [Route Handlers](https://nextjs.org/docs/app/getting-started/route-handlers).
2. Next.js, [Project structure and organization](https://nextjs.org/docs/app/getting-started/project-structure).
3. Next.js, [Backend for Frontend](https://nextjs.org/docs/app/guides/backend-for-frontend).
4. Next.js, [Data security](https://nextjs.org/docs/app/guides/data-security).
5. Next.js, [Authentication](https://nextjs.org/docs/app/guides/authentication).

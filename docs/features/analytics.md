# Admin Analytics Dashboard

## Purpose

Provide HQ/branch admin with an analytics dashboard — revenue, order/customer
counts, average order value (AOV), a 30-calendar-day revenue trend chart,
orders grouped by status, and the most recent orders. Backed by a single
read-only endpoint consumed client-side by the dashboard page.

## Revenue semantics (locked decision)

An order contributes revenue **only when it is paid AND not cancelled**:

- `paymentStatus = "paid"` AND `status <> "cancelled"` — encoded once in the
  route as `revenueCondition` and applied to **every** revenue aggregate
  (all-time, rolling 30-day, AOV, and the per-day trend via SQL `FILTER`).
- A late-settled `failed_payment` order whose `paymentStatus` is `"paid"`
  **counts** as revenue (payment eventually arrived).
- The normal failed path (`failed_payment` + `paymentStatus = "failed"`) does
  **not** count.
- Cancelled orders **never** contribute revenue — even when they were paid
  before cancellation — but they still count as orders
  (`totalOrders`, `weeklyOrders`, `trend[].orders`, `ordersByStatus`).
- `orders.total` is the gross customer payment, so revenue includes each
  order's PPN snapshot. Net-revenue and tax-only reports are out of scope.

## Endpoint: `GET /api/admin/analytics`

`apps/admin/src/app/api/admin/analytics/route.ts` — auth: admin-session,
guard `analytics:view` (Current Policy). No params, no body. The route starts
exactly **four** queries concurrently (single `Promise.all`):

1. Consolidated KPI with `FILTER` aggregates (one scan): all-time revenue,
   qualifying order count, rolling 30-day revenue, rolling 7-day orders,
   total orders, distinct transacting customers.
2. 30-day trend grouped by WIB calendar day.
3. Order status counts.
4. 5 recent orders joined with their customer (`clients`).

**Response 200**:

```json
{
  "success": true,
  "data": {
    "totalRevenue": 0,
    "monthlyRevenue": 0,
    "totalOrders": 0,
    "weeklyOrders": 0,
    "totalCustomers": 0,
    "averageOrderValue": 0,
    "ordersByStatus": [{ "status": "pending_payment", "count": 0 }],
    "recentOrders": [{ "id": "", "total": 0, "status": "", "createdAt": "", "customer": "" }],
    "trend": [{ "date": "2025-06-16", "revenue": 0, "orders": 0 }]
  }
}
```

403 `{ success: false, error: "Forbidden", code: "DENIED" }` when an
own-branch grant has no Home Branch (fail closed) or the guard denies;
500 `{ success: false, error: "Failed to fetch analytics" }` on exception.
The response is additive over the original contract — every pre-existing
field keeps its shape.

## Metric definitions

| Metric | Definition | Filter |
|---|---|---|
| `totalRevenue` | `SUM(orders.total)` all time | `paymentStatus = "paid"` AND `status <> "cancelled"` |
| `monthlyRevenue` | `SUM(orders.total)` over the **last 30 × 24 h** (rolling window, not calendar month) | revenue condition AND `createdAt >= now − 30d` |
| `averageOrderValue` | `totalRevenue ÷ qualifying order count` (orders passing the revenue condition, all time); `0` when there are no qualifying orders | revenue condition |
| `totalOrders` | `COUNT(*)` all orders | none (all statuses) |
| `weeklyOrders` | `COUNT(*)` over the **last 7 × 24 h** (rolling window) | `createdAt >= now − 7d` |
| `totalCustomers` | distinct `orders.userId` | none |
| `ordersByStatus` | `COUNT(*)` grouped by `orders.status` | none |
| `recentOrders` | 5 newest orders by `createdAt` desc, inner-joined with `clients` for `customer` name | none |
| `trend` | exactly 30 WIB calendar days, oldest → newest, zero-filled (below) | revenue condition applies to `trend[].revenue` only |

Revenue sums use `COALESCE(SUM(CAST(total AS DECIMAL)), 0)` and are returned
as floats; counts as numbers.

## 30-day WIB trend

- The window is the **30 calendar days of the business timezone
  `Asia/Jakarta` (WIB, fixed UTC+7, no DST) ending "today" in WIB** — not a
  rolling 30 × 24 h window. Day keys are `"YYYY-MM-DD"` computed by
  `to_char(created_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD')` on the DB
  side and by the pure helpers in
  `apps/admin/src/lib/analytics-wib.ts` (unit-tested with hand-computed
  literals across month/year boundaries and the 17:00-UTC rollover).
- The query lower bound is `00:00 WIB` on the oldest window day
  (`trendWindowStart`), so every order in the window maps to one of the 30
  day buckets; no row can fall outside the returned keys.
- `zeroFilledTrend` merges sparse per-day aggregates into exactly 30 entries,
  oldest → newest, zero-filling empty days. The rolling `monthlyRevenue` /
  `weeklyOrders` KPIs deliberately remain rolling relative-time windows; only
  the trend uses WIB calendar days. Both read the same single `now` clock
  reading.
- Trend `orders` counts **all** statuses (including cancelled and unpaid);
  trend `revenue` applies the revenue condition.

## Scope

Branch Analytics aggregates are limited to the Authorized Branch from the
**Current Policy**:

- **own-branch scope** → revenue, order counts, statuses, trend, recent
  activity, and distinct transacting customers are filtered to the
  server-pinned Home Branch; orders without a branch are excluded.
- **all-branch scope** → every order is included, including orders without
  a branch.

This mirrors the admin orders list, which is branch-scoped the same way
(see `docs/api-reference.md` → `GET /api/admin/orders`). The page itself is
additionally gated server-side by the analytics layout (below), so an
unauthorized navigation never renders the dashboard shell.

## Admin UI

`apps/admin/src/app/admin/analytics/` — a real dashboard (the former
"Segera Hadir" placeholder is gone):

- `layout.tsx` — server-side policy gate: `pagePermissionOrRedirect(
  "analytics", "view", "/admin/analytics")` redirects unauthorized admins to
  `/admin/no-access` before any page renders.
- `page.tsx` — server shell (heading + description) around the client island.
- `analytics-dashboard.tsx` — the only consumer of the endpoint. **Client
  fetch once on mount — no polling** (a ref guards against StrictMode double
  effects; retries go exclusively through the manual button). States:
  - skeleton (`data-testid="analytics-skeleton"`) while in flight;
  - error card with a **Coba Lagi** retry button
    (`data-testid="analytics-error"` / `analytics-retry`) on failure;
  - the dashboard (`data-testid="analytics-dashboard"`) on success: 6 KPI
    cards (revenue, 30-day revenue, orders, 7-day orders, customers, AOV),
    the trend chart, status breakdown, and the recent-orders table with
    `Detail` links into `/admin/orders/{id}`.
- `revenue-trend-chart.tsx` — Recharts v3 `AreaChart` inside the shadcn
  `ChartContainer` (`packages/ui/src/components/ui/chart.tsx`, exported from
  `@marketplace/ui`). Alongside the SVG it renders a **visually-hidden
  (`sr-only`) accessible fallback table**
  (`data-testid="analytics-trend-table"`) with the full 30-row series so the
  data remains readable by screen readers and without JS graphics.
- `format.ts` — shared display formatting (Rupiah, compact axis ticks,
  Indonesian trend dates, status labels). Client-side only: the dashboard
  fetches after mount, so none of it runs during SSR/hydration.

The sidebar entry (`/admin/analytics`, "Analitik") is shown only to roles
whose Current Policy grants `analytics:view` (the seeded Admin Role has no
analytics grant — deny-by-default; HQ has view-all).

## Database indexes

`packages/db/src/schema/orders.ts` adds two indexes for the analytics
aggregates, generated as migration `0019_volatile_fenris`:

- `idx_orders_created_at` on `orders(created_at)` — the range-filtered
  plans: the 30-day WIB trend scan (`created_at >= trend-window start`) and
  the recent-orders top-5 read (`ORDER BY created_at DESC LIMIT 5`, newest
  rows straight from the index, all-branch scope). It does **not** serve the
  consolidated all-time KPI query: that query's rolling-window `FILTER`
  aggregates sit on a broad in-scope scan (totalOrders/totalCustomers/all-
  time revenue need every in-scope row anyway), so the index cannot narrow
  it.
- `idx_orders_branch_created_at` on `orders(branch_id, created_at)` — the
  trend/KPI predicates combined with the own-branch scope.

No payment-status index was added: the revenue condition is a `FILTER`
residual on the same scan (status/paymentStatus are low-cardinality, and the
existing `idx_orders_status_expires` already leads on `status`); any further
index would need EXPLAIN evidence first.

## Invariants

- Revenue metrics (including `trend[].revenue`) count **only** orders with
  `paymentStatus = "paid"` AND `status <> "cancelled"`; a paid+cancelled
  order counts as an order but never as revenue (covered by a real-DB E2E
  fixture).
- `monthlyRevenue` = rolling 30 × 24 h, `weeklyOrders` = rolling 7 × 24 h
  (both relative to request time); the trend alone is WIB calendar days.
- The trend is **exactly** 30 entries, oldest → newest, consecutive WIB
  calendar days ending today (WIB), zero-filled.
- `totalOrders` / `totalCustomers` / `ordersByStatus` / `recentOrders` /
  `trend[].orders` are unfiltered by payment status.
- The dashboard fetches exactly once on mount; there is **no** polling, and
  retries are manual only.
- Read-only — no mutations, no audit-log write.

## Env

None — the analytics feature has no environment variables.

## Verification

- `npm run test:unit` — `analytics-wib.test.ts` (WIB window helpers) and
  `route.test.ts` (route seam: guard, additive contract, exactly-four
  concurrent queries, fail-closed scope, failure logging).
- `npx playwright test e2e/admin/analytics.spec.ts` — endpoint invariants
  (contract, revenue semantics cross-checked against independent SQL, 30-day
  WIB window), RBAC denial/redirect/sidebar, dashboard UI (skeleton → data,
  error → retry recovery, exactly one fetch with no polling, chart SVG +
  accessible trend table).
- `npm run dev:admin` → `/admin/analytics` renders skeleton then dashboard;
  `ordersByStatus` sums to `totalOrders`.
- Confirm no `audit_log` row is written by the analytics call.

See `docs/api-reference.md` → `GET /api/admin/analytics` for the endpoint contract.
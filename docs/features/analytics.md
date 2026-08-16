# Admin Analytics Dashboard

## Purpose

Provide HQ/branch admin with dashboard aggregates — revenue, order/customer
counts, orders grouped by status, and the most recent orders. Backed by a
single read-only endpoint; the admin page itself is still a placeholder.

## Endpoint: `GET /api/admin/analytics`

`apps/admin/src/app/api/admin/analytics/route.ts` — auth: admin-session
(roles `admin`, `hq` via `withAuth`). No params, no body.

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
    "ordersByStatus": [{ "status": "pending_payment", "count": 0 }],
    "recentOrders": [{ "id": "", "total": 0, "status": "", "createdAt": "", "customer": "" }]
  }
}
```

500 `{ success: false, error: "Failed to fetch analytics" }` on exception.

## Metric definitions

| Metric | Definition | Filter |
|---|---|---|
| `totalRevenue` | `SUM(orders.total)` all time | `paymentStatus = "paid"` only |
| `monthlyRevenue` | `SUM(orders.total)` over the **last 30 days** (rolling window, not calendar month) | `paymentStatus = "paid"` AND `createdAt >= now - 30d` |
| `totalOrders` | `COUNT(*)` all orders | none (all statuses) |
| `weeklyOrders` | `COUNT(*)` over the **last 7 days** (rolling window) | `createdAt >= now - 7d` |
| `totalCustomers` | `COUNT(*)` from `clients` | none |
| `ordersByStatus` | `COUNT(*)` grouped by `orders.status` | none |
| `recentOrders` | 5 newest orders by `createdAt` desc, inner-joined with `clients` for `customer` name | none |

Revenue sums use `COALESCE(SUM(CAST(total AS DECIMAL)), 0)` and are returned as
floats; counts as numbers.

## Scope

**Not branch-scoped** — all metrics are global aggregates across every branch.
This differs from the admin orders list, which is branch-scoped via
`getBranchScope` (see `docs/api-reference.md` → `GET /api/admin/orders`).

## Admin UI

`apps/admin/src/app/admin/analytics/page.tsx` is a **placeholder** ("Segera
Hadir" / "Halaman analitik sedang dalam pengembangan") — the endpoint is ready
but no dashboard UI consumes it yet.

## Invariants

- Revenue metrics count **only** `paymentStatus = "paid"` orders; unpaid/cancelled orders never contribute.
- `monthlyRevenue` = rolling 30 days, `weeklyOrders` = rolling 7 days (both relative to request time, not calendar periods).
- `totalOrders` / `totalCustomers` / `ordersByStatus` / `recentOrders` are unfiltered by payment status.
- Read-only — no mutations, no audit-log write.

## Env

None — the analytics endpoint has no environment variables.

## Verification

- `npm run dev:admin` → `GET /api/admin/analytics` with an admin session returns all 7 fields with correct types.
- Seed data: `totalRevenue`/`monthlyRevenue` reflect only paid orders; `ordersByStatus` sums to `totalOrders`.
- Place a paid order, then re-fetch → `totalRevenue`, `monthlyRevenue`, `totalOrders`, `weeklyOrders` all increase; `recentOrders[0]` is the new order.
- Confirm no `audit_log` row is written by the analytics call.

See `docs/api-reference.md` → `GET /api/admin/analytics` for the endpoint contract.

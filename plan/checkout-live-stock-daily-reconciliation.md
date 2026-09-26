# Checkout live stock and daily reconciliation

> Overall status is tracked in `plan/index.md`.

## Goal and decisions

Jubelio is the stock source of truth. Keep local stock as a last-known display/cache and retain local pending SO holds. Before any new Sales Order, read selected item/location stock from Jubelio; do not assume an SO rejects oversell. If the provider read fails, is missing, malformed or inconsistent, fail closed with a customer-facing retry message. If it differs from the local mirror, update the mirror safely and continue only if provider available minus local pending holds covers demand. Keep webhook updates and run the bounded full stock scan daily, not every five minutes. Stale display stock is explicitly provisional and confirmed at checkout; no 15-minute freshness gate on browsing/cart.

## Features

| Feature | Status | Verify |
|---|---|---|
| 1. Live checkout verification and atomic holds | In Progress | DB/provider-stub tests cover stale zero recovery, insufficient, malformed/missing/network, changed hold during read (5/5 passed). Route wired to live read and atomic hold. Outstanding: HTTP-level no-SO assertions, complete full affected checkout E2E, verify real provider item/location values with owner approval. |
| 2. Provisional storefront stock | In Progress | Catalog/detail/cart/validate guards changed; isolated Playwright spec 3/3 passed (provisional notice, zero add, simulated customer error). Full existing UI/E2E suite still pending. |
| 3. Daily reconciliation and operational docs | In Progress | Cron templates switched to 02:00 daily; local shell test passed. No target-environment installation/monitoring (requires owner-authorized deployment). |

## Constraints

Preserve in-flight Jubelio Sales switching changes; no real Jubelio writes or remote deployment in test runs. Complete feature 1 before loosening browsing guards. Each feature follows red → green → review; do not flip status to Done before its verification. Existing `plan/jubelio-sales-api-switching.md` feature 7's five-minute policy must be updated to reference the replacement design when implementation is verified.

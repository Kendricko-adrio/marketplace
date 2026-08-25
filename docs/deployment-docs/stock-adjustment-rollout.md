# Production stock-adjustment rollout

This runbook enables Jubelio direct stock adjustments without bypassing the
application's safety gates. Run it from `deployment/production` on the VPS as
the operational user. Live canary checkout and payment actions must be
performed by an authorized operator; automation and coding agents must never
call `POST /inventory/adjustments/` directly.

## 1. Keep the kill switch closed

Deploy the new images first with:

```env
JUBELIO_STOCK_WRITES_ENABLED=false
```

Checkout intentionally fails closed in this state. Do not use a guessed cost,
unit, bin, or adjustment account to make a canary pass.

Validate the rendered Compose configuration without printing its values:

```bash
docker compose -p production --env-file .env config --quiet
```

Confirm these effective settings in the store container definition:

```text
APP_ENV=production
NODE_ENV=production
JUBELIO_API_BASE_URL=https://api2.jubelio.com
JUBELIO_STOCK_MAX_REQUESTS_PER_MINUTE=450
JUBELIO_STOCK_CONCURRENCY=10
JUBELIO_STOCK_MAX_QUEUED=1000
JUBELIO_STOCK_QUEUE_TIMEOUT_MS=5000
JUBELIO_STOCK_TIMEOUT_MS=8000
```

The plus/minus account overrides should normally be blank. The application
will read `adjp_acct_id` and `adjm_acct_id` from Jubelio.

## 2. Backup and migrate

Create a timestamped backup and verify that it is non-empty before migrating:

```bash
backup="storefront_production-before-stock-$(date +%Y%m%d-%H%M%S).sql"
pg_dump -U marketplace_production -h localhost storefront_production > "$backup"
test -s "$backup"
docker compose -p production --env-file .env --profile tools run --rm migrate npx drizzle-kit migrate
```

Migration history must include `0013_absurd_vampiro.sql` (initial durable stock
operations) and `0015_fixed_hiroim.sql` (the `reacquire` operation type). Never
run `db:push`, the seeder, or `reset.ts` in production.

Verify the final operation-type constraint:

```sql
SELECT pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conname = 'jubelio_stock_operation_type_valid';
```

Expected definition includes all three values:

```text
reserve, release, reacquire
```

## 3. Database preflight

Run these queries against `storefront_production`. Every missing-ID count must
be zero before enablement.

```sql
-- Active stock rows that checkout could offer but cannot map to Jubelio.
SELECT COUNT(*) AS stock_rows_missing_item_id
FROM branch_stock bs
JOIN product_variant pv ON pv.id = bs.product_variant_id
JOIN branch b ON b.id = bs.branch_id
WHERE b.status = 'aktif'
  AND (bs.stock > 0 OR bs.pending_remote_stock > 0 OR bs.reserved_stock > 0)
  AND pv.jubelio_item_id IS NULL;

SELECT COUNT(*) AS stock_rows_missing_location_id
FROM branch_stock bs
JOIN branch b ON b.id = bs.branch_id
WHERE b.status = 'aktif'
  AND (bs.stock > 0 OR bs.pending_remote_stock > 0 OR bs.reserved_stock > 0)
  AND b.jubelio_location_id IS NULL;

-- Runtime counters must never be negative.
SELECT COUNT(*) AS invalid_stock_counters
FROM branch_stock
WHERE stock < 0 OR pending_remote_stock < 0 OR reserved_stock < 0;

-- Inspect unfinished work before rollout; do not delete these rows.
SELECT type, status, COUNT(*)
FROM jubelio_stock_operation
WHERE status NOT IN ('committed', 'failed')
GROUP BY type, status
ORDER BY type, status;

-- Unfinished writes created by the new lifecycle must have item snapshots.
SELECT id, order_id, type, status, note
FROM jubelio_stock_operation operation
WHERE status IN ('pending', 'in_flight', 'reconciling', 'applied', 'manual_review')
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(operation.payload->'items') item
    WHERE item->'snapshot' IS NULL
  );
```

Investigate every unfinished operation or missing snapshot. Do not fabricate a
snapshot for an operation that may already have reached Jubelio.

## 4. Provider preflight (read-only)

Using the authorized Jubelio UI or the documented semantic-read endpoints,
confirm for the exact canary item and branch:

- item ID and location ID match the marketplace database;
- default bin exists for the location;
- `adjp_acct_id` and `adjm_acct_id` are present;
- current on-hand is sufficient;
- description, unit, and cost are valid inventory metadata.

Item `59008` previously returned `cost=1.0000...`. An inventory/accounting owner
must explicitly confirm that valuation in Jubelio before it may be used. A
technical API response alone is not accounting approval.

## 5. Controlled canary

Record the operator, UTC start time, branch, SKU/item ID, expected before/after
on-hand, and the marketplace order ID. Use quantity one and keep customer
traffic paused or otherwise constrained during the canary.

Enable writes and recreate only the store container so the changed environment
is applied:

```bash
# Edit .env: JUBELIO_STOCK_WRITES_ENABLED=true
docker compose -p production --env-file .env up -d --no-deps --force-recreate store
docker compose -p production --env-file .env ps store
docker compose -p production --env-file .env logs --since 5m store
```

The operator then performs checkout through the storefront—never by calling
the Jubelio adjustment endpoint manually.

Acceptance checks for the initial canary:

1. Exactly one `OKCIR_RESERVE:<orderId>:<operationId>` adjustment exists.
2. On-hand decreases by exactly one.
3. The durable reserve operation is `applied` before Midtrans is created.
4. Its payload contains description, unit, cost, bin, and both account IDs.
5. A normal successful payment changes the operation to `committed` and
   creates no second adjustment.

Run a separately recorded failure/expiry canary before broad rollout:

1. The reserve adjustment occurs exactly once.
2. A verified Midtrans failure or TTL sweep creates exactly one
   `OKCIR_RELEASE:<orderId>:<operationId>` adjustment.
3. The release reuses the reserve snapshot and restores on-hand exactly once.
4. Local `pending_remote_stock` and `reserved_stock` return to zero only after
   remote confirmation.

Late-settlement testing requires an explicitly approved real payment scenario.
After a confirmed release, settlement must create one `OKCIR_REACQUIRE` write;
insufficient or ambiguous stock must become `manual_review`, never a blind
retry.

## 6. Observe and decide

During canary and rollout, monitor structured store logs for:

```text
Jubelio stock adjustment requested
Jubelio stock adjustment applied
Jubelio stock operation deferred
Jubelio stock reconciliation completed
QUEUE_FULL
QUEUE_TIMEOUT
manual_review
```

Also monitor operation backlog:

```sql
SELECT type, status, COUNT(*), MIN(created_at) AS oldest
FROM jubelio_stock_operation
WHERE status NOT IN ('committed', 'failed')
GROUP BY type, status
ORDER BY status, type;
```

Proceed only when adjustment counts, absolute on-hand, local counters, and
Midtrans ordering all match this runbook. Keep the scheduler at or below 450
requests/minute during the initial observation window.

## 7. Kill switch and recovery

To stop new stock writes:

```bash
# Edit .env: JUBELIO_STOCK_WRITES_ENABLED=false
docker compose -p production --env-file .env up -d --no-deps --force-recreate store
```

This makes new checkout fail closed; it does **not** reverse confirmed
adjustments or resolve in-flight/ambiguous operations. Preserve all operation
rows and notes. Before re-enabling, reconcile each outstanding note against
Jubelio and use the admin **Recheck safely** action for `manual_review` rows.
Never repair an unknown outcome by submitting the same adjustment blindly.

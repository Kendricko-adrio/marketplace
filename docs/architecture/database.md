# Database & Schema Management

Deep-dive companion to AGENTS.md §2/§4. Explains where schema is defined, how
to change it, the `db:push` vs `db:migrate` rule, and timestamp conventions.

## Schema Ownership

**`packages/db/src/schema/` is the ONLY place tables are defined.**
Apps are read-only consumers: they create a local `db` connection and re-export
the shared schema (see [overview.md](overview.md)). Never define tables in an
app.

## Schema Change Workflow

1. Edit `packages/db/src/schema/*.ts`
2. `npm run db:generate` — generates a migration in `packages/db/drizzle/`
3. `npm run db:push` — applies the change to the dev DB
4. No rebuild/sync needed — apps read the schema source via path alias.

## `db:push` vs `db:migrate` (dev)

The dev DB is managed with **`db:push`** (schema-sync), **not** `db:migrate`.
The `__drizzle_migrations` journal is NOT kept in sync with the push-applied
DB, so `db:migrate` would try to replay old `CREATE TABLE` statements and fail
with `relation already exists`.

- **Use `db:push`** to apply schema changes in dev.
- Treat the generated migration files in `packages/db/drizzle/` as the
  source-of-truth SQL record for review/audit.
- **Deployment is different**: the `migrate` container runs `drizzle-kit
  migrate` against the committed SQL. See `docs/deployment-docs/`.

## Migration Notes

- Migration `0008_steady_jocasta.sql` applies the `timestamptz`
  (`withTimezone: true`) convention to all auth/domain tables that were
  previously `timestamp without time zone`.
- Migration `0009_tan_sheva_callister.sql` adds the `notifications` table.
- Migration `0017_brave_maximus.sql` adds the new RBAC model: `admin_role`
  (immutable `key`, editable `name`, `isSystem`, optimistic `version`,
  nullable `archivedAt`, case-insensitive unique normalized-Name expression
  index + length check), `admin_role_grant` (normalized `(role, module,
  action)` row with scope, tuple-unique, action/scope/module-shape checks),
  `users.role_id` (FK RESTRICT, **NOT NULL** — the final constraint,
  enforced by the `0018` cutover; `0017` shipped it nullable only as a
  transition step so the cutover could backfill from the legacy
  `users.role` key) and `users.is_active`, plus `audit_log` policy/branch
  extensions (`policy_version`, `branch_scope`, `branch_id`,
  `related_branch_id` with `ON DELETE SET NULL` so Audit Events survive
  Branch deletion).
- Migration `0018_silly_mystique.sql` is the slice-9 cutover that made
  `users.role_id` **NOT NULL** permanent schema: it fails fast
  (before any write) on normalized-Role-Name collisions with the reserved
  Initial-Role Names and on unexpected legacy `user.role` values, ensures the
  system Roles/Initial grants exist idempotently, backfills `user.role_id`
  with a normalized mapping (`lower(btrim(role)) = 'hq' → HQ; anything else
  → least-privilege Admin), asserts no NULL `role_id` remains before
  enforcing NOT NULL, then drops the legacy `user.role` column and
  `permission` table with recovery-safe `IF EXISTS` drops. After the cutover
  the legacy `users.role` key no longer exists anywhere — assignment is
  `role_id` + Home Branch only. The `permission`
  drop is deliberately **not** `CASCADE` and does **not** translate legacy
  permission customization: per-Admin permission tuning made through
  `/api/admin/permissions` during the maintenance window is intentionally
  discarded and must be re-expressed as a custom Role via the new Roles UI
  after cutover. Rollback is a paired operation (restore the pre-cutover
  backup and redeploy the previous image) — there is no dual-read/write
  compatibility path.
- Migrations `0011`/`0012` add domain checks and uniqueness constraints,
  pickup verification lockout state, deterministic cart uniqueness, and change
  the admin-user branch FK to `ON DELETE RESTRICT`.

## Timestamp Convention (timestamptz)

Every datetime/timestamp column **MUST carry a timezone**:

```ts
timestamp("col", { withTimezone: true })  // → Postgres timestamptz
```

Never use bare `timestamp("col")` (`timestamp without time zone`): values are
stored as wall-clock with no zone label and depend on the Postgres session
`timezone`, risking inconsistency between values inserted from the app
(`new Date()` → UTC) vs `defaultNow()`/`now()` (local session clock). With
`withTimezone: true`, Postgres always stores UTC absolutely and converts to the
client zone when read.

Rules:
- **Exception:** `date` (pure calendar date, e.g. `birthDate`) needs no timezone.
- **On insert from the app**, send a `Date` object (not a local string) so the
  `pg` driver serializes via `toISOString()` (UTC).
- Ensure the Postgres session `timezone` is `UTC` (default in dev env; verify
  with `SHOW timezone;`).

## Order PPN snapshots

`orders.ppn_rate numeric(9,6)` and `orders.ppn_amount numeric(15,2)` preserve
the tax policy applied at checkout. Both are non-negative, the rate is checked
between 0 and 100, and re-payment reads these columns rather than mutable
`system_config`. See [../features/ppn.md](../features/ppn.md).

## Order payment columns

`orders.payment_method` and `orders.midtrans_transaction_id` are `NULL` until
the customer picks a method on the hosted Snap page: both are persisted
atomically with the finalization claim UPDATE, sourced only from the
authoritative `GET /v2/{order_id}/status` (`payment_type` / `transaction_id`),
never from the raw webhook body. `payment_method` stores the raw Midtrans
payment_type verbatim (`qris`, `gopay`, `credit_card`, `bank_transfer`,
`echannel`, `bca_va`, …). Both columns are legacy-era and nullable — no schema
migration was required to repurpose them (comment-only change in
`packages/db/src/schema/orders.ts`).

## Seeder Must Stay in Sync

Whenever a table/column is added or removed in `packages/db/src/schema/`,
also update `packages/db/src/seed.ts` so `npm run db:reset && npm run db:seed`
produces a fully populated, testable DB without manual data entry:

- Add a `DELETE` for any new table at the top of `seed()` (respecting FK order).
- Add realistic sample rows for the new table/columns in `SEED_MODE=demo`.
- Keep `SEED_MODE=jubelio` free of dummy catalog, branch, stock, and dependent
  transactional fixtures; Jubelio import owns those rows in that mode.
- The seeder refuses to run when `NODE_ENV=production`.

See [../features/seeding.md](../features/seeding.md) for mode behavior and the
required seed-before-import order.

## See Also

- [overview.md](overview.md) — structure & DB connection pattern
- [../deployment-docs/README.md](../deployment-docs/README.md) — deployment
  migration workflow (`drizzle-kit migrate` in containers)

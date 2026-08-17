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

## Seeder Must Stay in Sync

Whenever a table/column is added or removed in `packages/db/src/schema/`,
also update `packages/db/src/seed.ts` so `npm run db:reset && npm run db:seed`
produces a fully populated, testable DB without manual data entry:

- Add a `DELETE` for any new table at the top of `seed()` (respecting FK order).
- Add realistic sample rows for the new table/columns.
- The seeder refuses to run when `NODE_ENV=production`.

## See Also

- [overview.md](overview.md) — structure & DB connection pattern
- [../deployment-docs/README.md](../deployment-docs/README.md) — deployment
  migration workflow (`drizzle-kit migrate` in containers)

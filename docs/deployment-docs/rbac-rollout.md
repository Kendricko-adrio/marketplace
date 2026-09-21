# RBAC cutover rollout (migrations 0017 + 0018)

Runbook for the one-time maintenance window that ships the application-owned
hybrid RBAC (see `docs/adr/0001-application-owned-hybrid-rbac.md` and
`docs/features/rbac.md`). It applies the paired schema migrations (0017 new
RBAC tables, 0018 slice-9 cutover) together with the matching admin image, and
bootstraps the first System Owner.

The cutover has **no dual-read/write compatibility path**: authorization
switches from the legacy `permission` table to the DB-backed Current Policy in
one atomic step. Rollback is therefore a paired operation too (restore the
pre-cutover database backup and redeploy the previous image).

Run from `deployment/<env>` on the VPS as the operational user (see
[deploy.md](deploy.md)). Use the maintenance window for production: while the
migrate container runs, admin API authorization is briefly unavailable and
legacy permission tuning is intentionally discarded.

## 1. Preconditions

- The images to deploy contain the RBAC code (admin app with the policy
  guard) **and** the migrations `0017_brave_maximus.sql` +
  `0018_silly_mystique.sql` are committed under `packages/db/drizzle/`.
  Verify: `git ls-files packages/db/drizzle/ | grep -E "0017|0018"`.
- No active admin sessions are needed across the window; expect forced
  re-login afterwards.
- Never run `db:push`, the seeder, or `reset.ts` against this database.

## 2. Backup and verified restore path

Create a timestamped backup **before** any migration, and verify it is
non-empty:

```bash
backup="qadfstore-before-rbac-$(date +%Y%m%d-%H%M%S).sql"
pg_dump -U qmarketplace -h localhost qadfstore > "$backup"   # production: -U qmarketplace_production qadfstore_production
test -s "$backup"
```

A backup you cannot restore is not a backup. Verify the restore path in the
same window (on a scratch database, **never** on the live one):

```bash
createdb -U qmarketplace rbac_restore_check
pg_restore_check() { psql -U qmarketplace -d rbac_restore_check -f "$backup" >/dev/null && echo restore-ok; }
pg_restore_check
psql -U qmarketplace -d rbac_restore_check -c '\dt' | head   # tables present
dropdb -U qmarketplace rbac_restore_check
```

If the restore check fails, stop — fix the backup before touching the live
database.

## 3. Paired deploy: code image + schema migration

Deploy the new code and apply the migrations in the same window. The migrate
container runs `drizzle-kit migrate` against the committed SQL (see
[deploy.md](deploy.md)); both migrations run inside single transactions, so a
failed 0018 preflight aborts atomically with no partial schema.

```bash
docker compose -p staging --env-file .env up -d --build   # new store + admin images
docker compose -p staging --env-file .env --profile tools run --rm migrate npx drizzle-kit migrate
```

What the migrations do:

- **0017** creates `admin_role` (immutable `key`, editable `name`, `is_system`,
  optimistic `version`, nullable `archived_at`, case-insensitive unique
  normalized-Name index), `admin_role_grant` (normalized
  `(role, module, action)` row with scope + shape checks), and adds
  `user.role_id` (FK RESTRICT), `user.is_active`, plus the `audit_log` policy
  columns (`policy_version`, `branch_scope`, `branch_id`,
  `related_branch_id`).
- **0018** is fail-fast and idempotent: preflight rejects reserved-key/Name
  collisions and unexpected legacy `user.role` values before any write,
  ensures the system Roles and Initial grants, backfills `user.role_id`
  (normalized `hq` → HQ; anything else → least-privilege Admin), asserts no
  NULL `role_id`, then enforces NOT NULL and drops the legacy `user.role`
  column and `permission` table.

Expected success output ends with the migration applied without errors; the
legacy `permission` table no longer exists afterwards:

```bash
psql -U qmarketplace -d qadfstore -c "select count(*) from admin_role"          # 3 (system_owner, hq, admin)
psql -U qmarketplace -d qadfstore -c "\d permission"                             # Did not find any relation (dropped)
```

> Customization made through the legacy `/api/admin/permissions` endpoint
> during previous windows is intentionally discarded — it must be re-expressed
> as custom Roles via the new Roles UI after cutover.

## 4. One-time System Owner bootstrap

After the migration, create the first System Owner with the one-time CLI
(see [rbac-owner-bootstrap.md](rbac-owner-bootstrap.md) for full behavior):

```bash
docker compose exec admin npm run db:bootstrap-owner -- \
  --name "System Owner" --email <operator email> \
  --username <operator> --password "$(cat /run/secrets/owner_password)"
```

Expected exit code `0`. Then verify the second run refuses:

```bash
docker compose exec admin npm run db:bootstrap-owner -- \
  --name "System Owner" --email <operator email> \
  --username owner2 --password "$(cat /run/secrets/owner_password)"
# expected: exit code 1 (OWNER_EXISTS), no data created
```

The second run returning `OWNER_EXISTS` is the **pass condition**, not an
error. The password lives only as a bcrypt hash in `admin_account.password`;
rotate it at first sign-in (the forced `mustResetPassword` flow enforces this).

## 5. Smoke tests (admin realm)

Run these with curl or the browser against the deployed admin host. Expected
results:

1. **Unauthenticated** `GET /api/admin/policy/me` → `401`
   `{ code: "UNAUTHENTICATED" }`.
2. **System Owner sign-in** → forced password reset flow
   (`mustResetPassword`), then `GET /api/admin/policy/me` → 200 with
   `role.key = "system_owner"`, `grants: []`, `policyVersion` present.
3. **Legacy endpoints are gone**: `GET /api/admin/permissions` and
   `GET /api/admin/permissions/me` → `404` (not 401/403).
4. **HQ session** (seeded `hqmanager` only on disposable seeded databases;
   on production create staff via `POST /api/admin/users` with a Role):
   `GET /api/admin/orders` → 200 all-branch data;
   `GET /api/admin/audit-log` → 200 including global events;
   `GET /api/admin/roles` → 200.
5. **Branch-scoped actor** (Role with own-branch grants): orders list only
   contains the Home Branch; `GET /api/admin/products` shows only products the
   Home Branch carries; `GET /api/admin/audit-log` excludes global events;
   a foreign-branch order id → `404` (`NOT_FOUND`), never 403.
6. **Deny-all actor**: `GET /api/admin/products` → `403` with a stable
   code (`NO_ACCESS` for admission failures, `DENIED` for missing grants);
   `GET /api/admin/policy/me` stays 200 (authentication-only discovery).
7. **Roles lifecycle** (as a manager with `roles` edit): create a deny-all
   Role, revise it (reduction requires a reason), archive it, restore it.
   Each mutation writes an immutable audit event
   (`ROLE_CREATED`/`ROLE_UPDATED`/`ROLE_ARCHIVED`/`ROLE_RESTORED`).
8. **Deactivation**: `POST /api/admin/users/{id}/deactivate` (reason required)
   → the target's next sign-in is blocked and existing sessions are revoked;
   `DELETE /api/admin/users/{id}` → `405` (users are soft-deactivated).

## 6. Monitoring during and after the window

Structured container logs (see [logging.md](logging.md)) are the primary
signal; RBAC denials log at `warn` with stable reasons
(`rbac.authorization_denied`, `rbac.admission_denied`,
`rbac.policy_unresolvable`, `auth.must_reset_password`) and unexpected guard
failures log at `error` (`rbac.guard_failure`).

```bash
journalctl -t staging-admin-1 --since "today" | grep -E "rbac\.|auth\.must_reset_password"
# error-level RBAC failures must stay at zero:
journalctl -t staging-admin-1 --since "today" | grep -c "rbac.guard_failure"
```

Also watch: sign-in failures after cutover (legacy users whose Role was
backfilled should sign in normally), 5xx spikes on `/api/admin/*`, and the
`policy_unresolvable` rate (persistent non-zero means assignment data needs
attention). Audit attribution for the window itself is verifiable via
`GET /api/admin/audit-log` as the Owner (`ROLE_*` / `USER_*` events).

## 7. Rollback (paired operation)

There is no compatibility path back; both halves must be rolled back
together:

1. **Redeploy the previous images** (the pre-RBAC admin/store image tags or
   the previous git revision built with `up -d --build`). The old code
   expects `users.role` and the `permission` table, which no longer exist.
2. **Restore the pre-cutover backup** (the one created and verified in step 2):

   ```bash
   psql -U qmarketplace -d qadfstore -c "select pg_terminate_backend(pid) from pg_stat_activity where datname='qadfstore' and pid <> pg_backend_pid();"
   dropdb -U qmarketplace qadfstore && createdb -U qmarketplace qadfstore
   psql -U qmarketplace -d qadfstore -f "$backup"
   ```

   Restore the `__drizzle_migrations` journal state from the backup, so the
   migrate container does not replay applied migrations.

Restoring the database **without** redeploying the old image leaves the old
code reading tables the new code just dropped/re-shaped, and redeploying the
old image without the restore leaves it pointed at RBAC-only schema. Never do
half a rollback.

## 8. Post-cutover checklist

- [ ] `admin_role` contains exactly the three system Roles (`system_owner`,
      `hq`, `admin`) plus any custom Roles created after cutover.
- [ ] `select count(*) from "user" where role_id is null` = 0.
- [ ] `permission` table and `user.role` column are gone.
- [ ] Second bootstrap run exits `1` (`OWNER_EXISTS`).
- [ ] Smoke tests in §5 all pass.
- [ ] Custom Roles re-expressing any discarded legacy permission tuning have
      been created via the Roles UI.
- [ ] `rbac.guard_failure` error logs are zero over a full day.
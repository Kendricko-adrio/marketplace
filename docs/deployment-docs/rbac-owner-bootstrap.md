# RBAC — One-time System Owner bootstrap

The new RBAC model (see `docs/adr/0001-application-owned-hybrid-rbac.md`) has
no default production credentials and **no web bootstrap endpoint**. The first
System Owner is created with a one-time CLI run against the target database.
The command refuses to run once any System Owner exists.

## Command

From the repository root:

```bash
npm run db:bootstrap-owner -- \
  --name "System Owner" \
  --email owner@example.invalid \
  --username owner \
  --password '<secure-password>'
```

Behavior:

- Validates input (2–64 char name, valid email, username shape, 8–128 char
  password). Missing/invalid input exits non-zero (`MISSING_INPUT`,
  `INVALID_IDENTITY`, `INVALID_PASSWORD`).
- Creates the user, the credential (`admin_account`, bcrypt cost 10 — same
  convention as the admin Better Auth instance), and the `system_owner` Role
  assignment in **one transaction**.
- Sets `mustResetPassword = true` — the Owner must change the password on
  first sign-in.
- Owners are global: no Home Branch is set.
- Emits structured JSON logs only; the password is never logged.
- If a System Owner already exists it exits non-zero with `OWNER_EXISTS`
  without creating any data.
- Concurrent first-Owner attempts are serialized with a transaction-level
  advisory lock (`pg_advisory_xact_lock`) and re-checked inside the
  transaction — not with a race-prone bare count.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Owner created |
| `1` | `OWNER_EXISTS` — a System Owner is already assigned |
| `2` | Invalid/missing input |
| `3` | Unexpected failure (check structured log) |

## Staging/production procedure

Run inside the deployment container (where `DATABASE_URL` is configured) after
the deployment migration has applied the RBAC schema:

```bash
docker compose exec <admin-or-db-container> npm run db:bootstrap-owner -- \
  --name "System Owner" --email <operator email> \
  --username <operator> --password '<one-time secret>'
```

Secret handling:

- Pass the password interactively or via a secret manager; prefer not to place
  it in shell history. If a file is used, read it into the argument with
  `--password "$(cat /run/secrets/owner_password)"`.
- The generated credential is stored only as a bcrypt hash in
  `admin_account.password`.
- Rotate the password immediately after first sign-in — the forced
  `mustResetPassword` flow enforces this.
- Verify a second invocation exits `1` (`OWNER_EXISTS`) and that
  `select count(*) from "user" u join admin_role r on u.role_id = r.id
  where r.key = 'system_owner'` returns the expected count.

## Prerequisites

- `admin_role` contains the `system_owner` Role (created by `db:seed` or the
  deployment seed step). The CLI aborts if the Role is missing.
- Never ship default production credentials or add a bootstrap web endpoint.
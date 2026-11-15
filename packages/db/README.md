# marketplace-db

Shared database schema + migrations + seed script for **marketplace** and **marketplace-admin**.

## ⚠️ SOLE OWNER OF MIGRATIONS

This repository is the **only** source of truth for:
- Drizzle schema definitions
- Database migrations (`drizzle/` folder)
- Seed script

**NEVER** run `drizzle-kit push` or `drizzle-kit migrate` from the store or admin repos.

## Workflow

1. Edit schema files in `src/schema/`
2. Run `npm run db:generate` (creates migration in `drizzle/`)
3. Run `npm run db:migrate` (applies migration to DB)
4. Commit & push this repo
5. Admin & Store repos pull the latest schema via git subtree

## Setup

```bash
npm install
cp .env.example .env
# Edit .env with your DATABASE_URL
npm run db:push   # dev: push schema directly
npm run db:seed   # optional: seed sample data
```

## Production bootstrap commands

Command one-shot untuk deployment production pertama (database baru). Runbook
lengkap beserta exit code, kondisi STOP, dan recovery:
[`docs/deployment-docs/first-production-deployment.md`](../../docs/deployment-docs/first-production-deployment.md).

```bash
# read-only: target/manifest/migration (tidak menulis apa pun)
npm run db:preflight:production -- --config <manifest.json> --phase before-migrate
npm run db:preflight:production -- --config <manifest.json> --phase after-migrate

# referensi sistem (transaksi + advisory lock; no demo data/user)
npm run db:seed:production -- --config <manifest.json>

# satu System Owner dari file secret
npm run db:bootstrap-owner -- --name "System Owner" --email owner@domain.tld \
  --username owner --expected-database <db> --password-file /run/secrets/owner_password

# full import Jubelio (menolak cap/filter/start-page; report durable)
npm run db:import-jubelio -- --full --expected-database <db> \
  --report-file /path/luar/repo/import.json

# verifikasi read-only + daftar launch blockers
npm run db:verify:production -- --config <manifest.json> --import-report /path/import.json
```

Aturan:

- `--config`, `expectedDatabase`, dan environment production (`APP_ENV=production`)
  wajib eksplisit. Entry point production **tidak** memuat `.env` development.
- Tanpa `--force`: salah target, manifest tidak lengkap, cap/filter, atau data
  operasional yang sudah ada akan ditolak sebelum write.
- Exit code: `0` lulus, `2` input/target/prasyarat ditolak, `3` dependency gagal,
  `4` hasil verifikasi/import tidak lengkap (`OWNER_EXISTS` dari Owner CLI = `1`).

## Schema Sync to Other Repos

```bash
# From store repo
bash ../sync-schema.sh

# Or manually
git subtree pull --prefix=src/db/marketplace-db   ../marketplace-db.git main --squash
```

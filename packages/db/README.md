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

## Schema Sync to Other Repos

```bash
# From store repo
bash ../sync-schema.sh

# Or manually
git subtree pull --prefix=src/db/marketplace-db   ../marketplace-db.git main --squash
```

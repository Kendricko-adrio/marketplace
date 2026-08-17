# Migrate — one-shot container. The safe default only applies migrations.
# Not started with `docker compose up`; invoked manually:
#   docker compose --profile tools run --rm migrate
#
# Build context = repo root (set in docker-compose.yml)

FROM node:24-alpine AS runner

WORKDIR /app

# Copy all package manifests and install with devDependencies included,
# because drizzle-kit and tsx are devDependencies of @marketplace/db.
COPY package.json package-lock.json ./
COPY apps/store/package.json apps/store/
COPY apps/admin/package.json apps/admin/
COPY apps/jubelio-mock/package.json apps/jubelio-mock/
COPY packages/db/package.json packages/db/
COPY packages/ui/package.json packages/ui/

RUN npm ci --include=dev

# Copy the shared db package source (schema, migrations, seed, reset, config).
COPY packages/db ./packages/db

# drizzle.config.ts loads ../../.env — but in the container there is no .env.
# We rely on DATABASE_URL being passed via docker-compose environment.
# drizzle-kit reads process.env.DATABASE_URL directly from dbCredentials.url.

WORKDIR /app/packages/db

# Seeding is always explicit and seed.ts refuses NODE_ENV=production:
#   docker compose --profile tools run --rm migrate npx tsx src/seed.ts
#
# Recovery (staging only — kalau "relation already exists" karena DB kotor
# dari db:push sebelumnya, atau journal out-of-sync):
#   1. docker compose --profile tools run --rm migrate npx tsx src/reset.ts
#   2. docker compose --profile tools run --rm migrate
# reset.ts akan DROP semua tabel (termasuk __drizzle_migrations) lalu migrate
# apply dari awal + seed. JANGAN run reset.ts di production.
CMD ["npx", "drizzle-kit", "migrate"]

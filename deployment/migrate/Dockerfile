# Migrate — one-shot container to run Drizzle migrations + seed.
# Not started with `docker compose up`; invoked manually:
#   docker compose --profile tools run --rm migrate
#
# Build context = repo root (set in docker-compose.yml)

FROM node:20-alpine AS runner

WORKDIR /app

# Copy all package manifests and install with devDependencies included,
# because drizzle-kit and tsx are devDependencies of @marketplace/db.
COPY package.json package-lock.json ./
COPY apps/store/package.json apps/store/
COPY apps/admin/package.json apps/admin/
COPY packages/db/package.json packages/db/
COPY packages/ui/package.json packages/ui/

RUN npm ci --include=dev

# Copy the shared db package source (schema, migrations, seed, reset, config).
COPY packages/db ./packages/db

# drizzle.config.ts loads ../../.env — but in the container there is no .env.
# We rely on DATABASE_URL being passed via docker-compose environment.
# drizzle-kit reads process.env.DATABASE_URL directly from dbCredentials.url.

WORKDIR /app/packages/db

# Default command: apply migrations, then seed.
# Override with: docker compose --profile tools run --rm migrate npx drizzle-kit migrate
# or:            docker compose --profile tools run --rm migrate npx tsx src/seed.ts
CMD ["sh", "-c", "npx drizzle-kit migrate && npx tsx src/seed.ts"]
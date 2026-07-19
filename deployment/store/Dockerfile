# Storefront — Next.js standalone production image
# Build context = repo root (set in docker-compose.yml)
# Multi-stage: deps → builder → runner

# -----------------------------------------------------------------------------
# Stage 1: deps — install all workspace dependencies (cached layer)
# -----------------------------------------------------------------------------
FROM node:20-alpine AS deps

WORKDIR /app

# Copy only package manifests first so this layer is cached unless deps change.
COPY package.json package-lock.json ./
COPY apps/store/package.json apps/store/
COPY apps/admin/package.json apps/admin/
COPY packages/db/package.json packages/db/
COPY packages/ui/package.json packages/ui/

# `npm ci` installs the lockfile exactly; workspaces get hoisted to root node_modules.
RUN npm ci --include=dev

# -----------------------------------------------------------------------------
# Stage 2: builder — build the store app with standalone output
# -----------------------------------------------------------------------------
FROM node:20-alpine AS builder

WORKDIR /app

# Bring over installed node_modules from deps stage.
COPY --from=deps /app/node_modules ./node_modules

# Copy the full source (respecting .dockerignore).
COPY . .

# NEXT_PUBLIC_* are inlined at build time, so they MUST be present during build.
# Supply them via --build-arg in docker-compose.yml.
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_APP_NAME
ARG NEXT_PUBLIC_STORE_URL

ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_APP_NAME=$NEXT_PUBLIC_APP_NAME
ENV NEXT_PUBLIC_STORE_URL=$NEXT_PUBLIC_STORE_URL
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

# Build the store app. `next build` with output:"standalone" produces
# apps/store/.next/standalone/ containing server.js + minimal node_modules.
RUN npm run build:store

# -----------------------------------------------------------------------------
# Stage 3: runner — minimal runtime image
# -----------------------------------------------------------------------------
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Run as the built-in non-root user for safety.
USER node

# standalone server.js lives at apps/store/server.js inside the standalone dir.
# We copy it to /app/apps/store/server.js and run from there so relative
# paths inside server.js (e.g. ./apps/store/.next/...) resolve correctly.
COPY --from=builder --chown=node:node /app/apps/store/.next/standalone ./
COPY --from=builder --chown=node:node /app/apps/store/.next/static ./apps/store/.next/static

# Public assets (images, svgs). Needed for static file serving.
COPY --from=builder --chown=node:node /app/apps/store/public ./apps/store/public

# Pre-create the prerender cache dir so the non-root user can write to it.
RUN mkdir -p ./apps/store/.next/cache && chown node:node ./apps/store/.next/cache

# Uploads directory — mounted as a named volume in compose.
# Pre-create so the mount target exists with correct ownership.
RUN mkdir -p ./uploads && chown node:node ./uploads

EXPOSE 3000

CMD ["node", "apps/store/server.js"]
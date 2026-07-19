# Admin dashboard — Next.js standalone production image
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
# Stage 2: builder — build the admin app with standalone output
# -----------------------------------------------------------------------------
FROM node:20-alpine AS builder

WORKDIR /app

# Bring over installed node_modules from deps stage.
COPY --from=deps /app/node_modules ./node_modules

# Copy the full source (respecting .dockerignore).
COPY . .

# NEXT_PUBLIC_* are inlined at build time, so they MUST be present during build.
# NEXT_PUBLIC_STORE_URL is read by apps/admin/next.config.ts to configure
# image remotePatterns.
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_APP_NAME
ARG NEXT_PUBLIC_STORE_URL
ARG NEXT_PUBLIC_ADMIN_URL

ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_APP_NAME=$NEXT_PUBLIC_APP_NAME
ENV NEXT_PUBLIC_STORE_URL=$NEXT_PUBLIC_STORE_URL
ENV NEXT_PUBLIC_ADMIN_URL=$NEXT_PUBLIC_ADMIN_URL
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

# Ensure apps/admin/public exists so the COPY in the runner stage doesn't fail
# (admin currently has no public/ dir; create an empty one for safety).
RUN mkdir -p apps/admin/public

# Build the admin app. `next build` with output:"standalone" produces
# apps/admin/.next/standalone/ containing server.js + minimal node_modules.
RUN npm run build:admin

# -----------------------------------------------------------------------------
# Stage 3: runner — minimal runtime image
# -----------------------------------------------------------------------------
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3001
ENV HOSTNAME=0.0.0.0

# standalone server.js lives at apps/admin/server.js inside the standalone dir.
# We copy it to /app/apps/admin/server.js and run from there so relative
# paths inside server.js (e.g. ./apps/admin/.next/...) resolve correctly.
COPY --from=builder --chown=node:node /app/apps/admin/.next/standalone ./
COPY --from=builder --chown=node:node /app/apps/admin/.next/static ./apps/admin/.next/static

# Public assets (admin currently has no public/ dir; we created an empty one
# in the builder stage, so this COPY always succeeds).
COPY --from=builder --chown=node:node /app/apps/admin/public ./apps/admin/public

# Pre-create the prerender cache dir so the non-root user can write to it.
RUN mkdir -p ./apps/admin/.next/cache && chown node:node ./apps/admin/.next/cache

# Uploads directory — mounted as a named volume in compose (shared with store).
RUN mkdir -p ./uploads && chown node:node ./uploads

# Run as the built-in non-root user for safety. Must be AFTER the RUN mkdir
# steps above — WORKDIR /app is root-owned, so node cannot create top-level
# dirs like /app/uploads. The chown above already gives them to node.
USER node

EXPOSE 3001

CMD ["node", "apps/admin/server.js"]
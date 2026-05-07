# syntax=docker/dockerfile:1.7

# OpenCairn Hocuspocus collaboration server.
# Runs the Yjs-over-WebSocket backend that Plan 2B editor clients connect to.
# Separate container from apps/api because:
#   - hocuspocus holds long-lived WS connections (different scaling profile)
#   - Better Auth cookie verification is the only shared surface and it's
#     already abstracted behind makeVerifySession (packages/db + BETTER_AUTH_SECRET).
#
# Built from the monorepo root so the multi-stage COPY picks up workspace deps
# (@opencairn/api, @opencairn/db, @opencairn/shared).

FROM node:22-alpine AS builder

# `libc6-compat` keeps Node native modules (bcrypt, sharp, ws native acceleration)
# loadable on Alpine's musl libc.
RUN apk add --no-cache libc6-compat
RUN corepack enable

WORKDIR /app

# Workspace manifests + lockfile first so `pnpm install` layer caches across
# source-only edits.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./

# Packages the hocuspocus app transitively depends on.
COPY packages/db ./packages/db
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api
COPY apps/hocuspocus ./apps/hocuspocus

# Frozen install builds every workspace dep once; prod-only install in the
# runner stage strips dev deps without re-resolving.
RUN pnpm install --frozen-lockfile

# Build the hocuspocus app (emits apps/hocuspocus/dist/server.js).
# @opencairn/api + @opencairn/db + @opencairn/shared don't ship a build step
# today; they're consumed via their TS source through workspace `exports`.
RUN pnpm --filter @opencairn/hocuspocus build

# ────────────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runner

RUN apk add --no-cache libc6-compat
RUN corepack enable

WORKDIR /app

ENV NODE_ENV=production \
    HOCUSPOCUS_PORT=1234

# Copy workspace manifests + lockfile so the prod install resolves from the
# same graph the builder used.
COPY --from=builder /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml /app/tsconfig.base.json ./
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/api ./apps/api
COPY --from=builder /app/apps/hocuspocus ./apps/hocuspocus

# Prod-only deps; the builder's node_modules is discarded.
RUN pnpm install --prod --frozen-lockfile

EXPOSE 1234

# Run through `tsx` for the same reason as apps/api: workspace packages such
# as @opencairn/db currently export TS source with extensionless imports.
WORKDIR /app/apps/hocuspocus
CMD ["node", "--import", "tsx", "src/server.ts"]

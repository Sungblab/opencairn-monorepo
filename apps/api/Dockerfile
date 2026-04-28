# syntax=docker/dockerfile:1.7

# OpenCairn Hono API.
# Built from the monorepo root so the multi-stage COPY picks up workspace deps
# (@opencairn/db, @opencairn/emails, @opencairn/shared).
#
# Multi-arch (linux/amd64, linux/arm64) is driven by `docker buildx` in the
# release workflow — the Dockerfile itself is platform-neutral.

FROM node:25-alpine AS builder

# `libc6-compat` keeps Node native modules (better-sqlite3 / pg native /
# nodemailer DNS, etc.) loadable on Alpine's musl libc.
RUN apk add --no-cache libc6-compat
RUN corepack enable

WORKDIR /app

# Workspace manifests + lockfile first so `pnpm install` layer caches across
# source-only edits.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./

# Workspace packages the API transitively imports.
COPY packages/db ./packages/db
COPY packages/emails ./packages/emails
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api

# Frozen install builds every workspace dep once; prod-only install in the
# runner stage strips dev deps without re-resolving.
RUN pnpm install --frozen-lockfile

# Build the api app (emits apps/api/dist/index.js).
# @opencairn/db / @opencairn/emails / @opencairn/shared don't ship a build
# step today; they're consumed via TS source through workspace `exports`.
RUN pnpm --filter @opencairn/api build

# ────────────────────────────────────────────────────────────────────────────
FROM node:25-alpine AS runner

RUN apk add --no-cache libc6-compat
RUN corepack enable

WORKDIR /app

ENV NODE_ENV=production \
    PORT=4000

# Manifests + lockfile so prod install resolves from the same graph the
# builder used.
COPY --from=builder /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml /app/tsconfig.base.json ./
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/api ./apps/api

# Prod-only deps; the builder's node_modules is discarded.
RUN pnpm install --prod --frozen-lockfile

EXPOSE 4000

# Healthcheck targets the public /api/health endpoint. Node has no curl/wget
# guarantees on Alpine, so use the runtime itself for a single GET.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Switch into the package dir so Node's module resolver finds `tsx` in
# apps/api/node_modules (pnpm hoisting puts the workspace dep there, not in
# the monorepo root /app/node_modules).
WORKDIR /app/apps/api

# Runtime via `tsx` (TypeScript ESM loader). Reasons:
#   - api source uses extensionless relative imports (`./app`,
#     `./lib/sentry`). tsc with module=ESNext + moduleResolution=bundler emits
#     them unchanged, and stock Node 22 ESM rejects them
#     (--experimental-specifier-resolution=node was removed in Node 22).
#   - workspace packages (@opencairn/db, @opencairn/shared, @opencairn/emails)
#     ship TS source via package `exports`. Running tsx end-to-end uses the
#     same resolution path as `pnpm dev`, so prod and dev stay in lockstep.
#   - tsc still runs in the builder stage as a typecheck gate — a build
#     failure fails the image build. The emitted dist/ is unused at runtime
#     but cheap (~MBs) and useful for source-map debugging.
CMD ["node", "--import", "tsx", "src/index.ts"]

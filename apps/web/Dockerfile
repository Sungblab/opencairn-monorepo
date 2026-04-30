# syntax=docker/dockerfile:1.7

# OpenCairn web (Next.js 16, App Router).
# Uses Next.js `output: "standalone"` (set in apps/web/next.config.ts) so the
# runner image only ships the trace-resolved deps + .next/standalone bundle —
# no /node_modules or workspace source.
#
# Multi-arch (linux/amd64, linux/arm64) is driven by `docker buildx` in the
# release workflow — the Dockerfile itself is platform-neutral.

FROM node:22-alpine AS builder

RUN apk add --no-cache libc6-compat
RUN corepack enable

WORKDIR /app

# Workspace manifests + lockfile first for layer caching.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./

# Workspace packages the web app imports.
COPY packages/shared ./packages/shared
COPY apps/web ./apps/web

# Build-time NEXT_PUBLIC_* env. Real values are baked at build via
# `--build-arg` from the release workflow; defaults keep dev builds green.
ARG NEXT_PUBLIC_BASE_URL=http://localhost:3000
ARG NEXT_PUBLIC_HOCUSPOCUS_URL=ws://localhost:1234
ARG NEXT_PUBLIC_FEATURE_LIVE_INGEST=true
ARG NEXT_PUBLIC_FEATURE_DOC_EDITOR_SLASH=true
ARG NEXT_PUBLIC_GOOGLE_CLIENT_ID=
ARG FEATURE_IMPORT_ENABLED=true
ARG FEATURE_DEEP_RESEARCH=true
ARG FEATURE_MANAGED_DEEP_RESEARCH=false
ENV NEXT_PUBLIC_HOCUSPOCUS_URL=$NEXT_PUBLIC_HOCUSPOCUS_URL \
    NEXT_PUBLIC_FEATURE_LIVE_INGEST=$NEXT_PUBLIC_FEATURE_LIVE_INGEST \
    NEXT_PUBLIC_FEATURE_DOC_EDITOR_SLASH=$NEXT_PUBLIC_FEATURE_DOC_EDITOR_SLASH \
    NEXT_PUBLIC_GOOGLE_CLIENT_ID=$NEXT_PUBLIC_GOOGLE_CLIENT_ID \
    NEXT_PUBLIC_BASE_URL=$NEXT_PUBLIC_BASE_URL \
    FEATURE_IMPORT_ENABLED=$FEATURE_IMPORT_ENABLED \
    FEATURE_DEEP_RESEARCH=$FEATURE_DEEP_RESEARCH \
    FEATURE_MANAGED_DEEP_RESEARCH=$FEATURE_MANAGED_DEEP_RESEARCH \
    NEXT_TELEMETRY_DISABLED=1

RUN pnpm install --frozen-lockfile

# Build emits .next/standalone (server.js + minimal node_modules) + .next/static.
RUN pnpm --filter @opencairn/web build

# `public/` is optional in Next.js — create an empty one so the runner-stage
# COPY always has a source. Avoids "no such file" failures on installs that
# never added static assets to apps/web/public.
RUN mkdir -p apps/web/public

# ────────────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runner

RUN apk add --no-cache libc6-compat

WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Non-root user. Next.js standalone runs fine as nobody/nogroup but uid 1001
# matches the upstream Next.js Docker example so volume-mount ownership is
# predictable for operators.
RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 nextjs

# Standalone bundle resolves its own deps via the trace-collected
# .next/standalone/node_modules. We only need the public/ assets and the
# .next/static directory at runtime.
#
# `apps/web/.next/standalone` already includes a top-level server.js that
# wires up the monorepo path; copy from /app root preserves it.
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static

USER nextjs

EXPOSE 3000

# TCP-only liveness — hitting `/` triggers full SSR + intl bootstrapping;
# checking that the listener is up is cheap and sufficient for orchestrators.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "require('net').connect(Number(process.env.PORT||3000),'127.0.0.1',()=>process.exit(0)).on('error',()=>process.exit(1))"

CMD ["node", "apps/web/server.js"]

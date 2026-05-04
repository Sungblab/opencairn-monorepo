# OpenCairn Agent Guide

Respond in Korean when working with the maintainer.

OpenCairn is an AI-powered personal and team knowledge OS. The public
repository is dual-licensed under AGPL-3.0-or-later plus an optional commercial
license.

## Public Docs Read Order

Start with the public docs that describe stable project behavior:

1. `docs/README.md`
2. `docs/contributing/roadmap.md`
3. `docs/contributing/feature-registry.md`
4. Relevant docs under `docs/architecture/`, `docs/agents/`, and `docs/testing/`

The historical execution plans, raw review logs, private agent notes, and local
operator handoffs are intentionally not part of the public repository.

## Private Maintainer Docs

For local maintainer work in this checkout, also read the private docs under
`.private-docs/` and ignored Superpowers docs under `docs/superpowers/` when the
task is about current development status, historical implementation plans,
audits, handoffs, or product direction. These files are local operator context
and should not be copied into public docs or user-facing copy unless explicitly
requested.

Recommended private read order:

1. `.private-docs/docs/contributing/plans-status.md`
2. `.private-docs/docs/contributing/project-history.md`
3. `.private-docs/docs/contributing/llm-antipatterns.md`
4. Relevant `docs/superpowers/specs/` and `docs/superpowers/plans/`
5. Relevant `.private-docs/docs/review/` audit notes when verifying claims or
   implementation status

## Architecture

```text
apps/web        - Next.js UI and browser sandbox
apps/api        - Hono business logic and permission helpers
apps/worker     - Python Temporal workers and runtime.Agent-based AI agents
apps/hocuspocus - Yjs collaboration server
packages/db     - Drizzle ORM, pgvector, and workspace permission schema
packages/emails - React Email templates and email transports
packages/llm    - Python LLM provider abstraction
packages/shared - Shared Zod contracts and types
```

Hierarchy: Workspace -> Project -> Page. Workspace is the isolation boundary;
lower levels inherit and refine permissions.

## Contribution Rules

- Frontend: no Server Actions and no DB imports in `apps/web`; call the API via
  existing clients or TanStack Query patterns.
- i18n: user-facing web copy belongs in `apps/web/messages/{locale}/*.json`;
  default locale is `ko`, secondary locale is `en`.
- Backend: Hono routes use Zod validation, auth guards, and workspace/project/page
  scoped permission checks.
- Database: use Drizzle in application code; raw SQL belongs in migrations.
- Worker and AI: long-running work uses Temporal; agents extend `runtime.Agent`;
  provider calls go through `packages/llm`.
- Sandbox: browser code execution stays inside Pyodide plus iframe isolation.
- Hosted service split: brand, domain, contact, SEO, legal, blog, and analytics
  values must be env/default-pattern driven. Hosted-service legal and blog
  pages live outside the OSS app and are linked by public env URLs.

## Commands

```bash
pnpm dev                           # all services
pnpm --filter @opencairn/<pkg> dev # package dev server
pnpm db:generate / db:migrate      # Drizzle
docker compose up -d               # local infra
```

Use the narrowest verification that covers the changed package. When touching
copy, run the web i18n parity check.

# OpenCairn Agent Guide

Respond in Korean.

AI-powered personal + team knowledge OS. **Notion replacement position**, 12 agents, multi-LLM, Docker self-hosted, **dual-licensed (AGPL-3.0-or-later + commercial)**.

## Read Order

Do not ask the user to brief status that can be read locally. Start with:

1. `docs/README.md`
2. `docs/contributing/plans-status.md`
3. `docs/contributing/feature-registry.md`
4. `docs/contributing/project-history.md`
5. Relevant `docs/superpowers/plans/*` and `docs/superpowers/specs/*`
6. Linked audits under `docs/review/*` when implementation claims matter

`plans-status.md` is the current status router. `feature-registry.md` is the duplicate-work guard and owning-path map. `project-history.md` is the long-form history map. Treat "complete" claims as hypotheses until code, tests, and product surface have been checked.

## Architecture

```
apps/web        - Next.js 16 UI + browser sandbox (Pyodide + iframe)
apps/api        - Hono 4 business logic + permission helpers
apps/worker     - Python Temporal + runtime.Agent based AI agents
apps/hocuspocus - Yjs collaboration server
packages/db     - Drizzle ORM + pgvector + workspace permission schema
packages/emails - react-email templates + Resend/SMTP/console transports
packages/llm    - Python LLM provider abstraction
packages/shared - Zod API contracts
```

Hierarchy: **Workspace -> Project -> Page**. Workspace is the isolation boundary; lower levels inherit and override.

## Non-Negotiable Rules

- Frontend: no Server Actions, no DB imports in `apps/web`; call API via TanStack Query or existing API clients. Next.js 16 uses `proxy.ts`, never `middleware.ts`.
- i18n: `apps/web` user-facing strings must use `messages/{locale}/*.json`; default `ko`, secondary `en`; run `pnpm --filter @opencairn/web i18n:parity` when touching copy.
- Backend: Hono routes use Zod validation, `requireAuth`, and user/workspace/project/page-scoped queries.
- DB: Drizzle only in app code; raw SQL belongs in migrations. Do not guess migration numbers manually.
- Worker/AI: long-running work uses Temporal; agents extend `runtime.Agent`; worker/provider calls go through `packages/llm` `get_provider()`.
- Sandbox/Security/Collab: browser-only Pyodide + iframe execution; no server-side arbitrary code execution. Preserve BYOK encryption, CORS/WAF assumptions, Yjs/Hocuspocus permission hooks, and workspace isolation.
- OSS/hosting split: brand/domain/contact/SEO metadata must be env/default-pattern driven, not hardcoded. Legal/blog/marketing surfaces live outside the OSS app unless explicitly scoped.

## Workflow

- Claude Code skills live in `~/.claude/skills/`; repo-local `.claude/` is runtime state, not project instructions.
- Codex skills live in `~/.codex/skills/`. Use the equivalent local skill when referenced: `opencairn-rules`, `opencairn-next-plan`, `opencairn-parallel-sessions`, `opencairn-post-feature`, `opencairn-commit`.
- For next work, detect branch, recent commits, worktrees, `plans-status.md`, `feature-registry.md`, `project-history.md`, and relevant plans before recommending. Exclude Plan 9b unless explicitly requested.
- For parallel or isolated feature work, create a git worktree under `.worktrees/<task>` and implement from that worktree. Do not mix concurrent plans in one working tree.
- Avoid concurrent edits to migration files, `packages/db/src/schema.ts`, `packages/shared`, or the same i18n message sections.
- After feature-sized work, run focused verification, review for security/convention drift, update relevant docs/status, then commit using OpenCairn commit conventions.
- GitHub operations use local `git` and `gh`/`gh.exe`. Do not rely on a GitHub connector/plugin for commits, pushes, PRs, or issue updates.
- Branch finish rule: when a development branch is complete, summarize verification, commit, push, and open a PR. The user owns merge approval.

Windows/WSL troubleshooting, local GitHub workflow, search fallback, and local verification hygiene live in `docs/contributing/dev-guide.md`.

## Commands

```bash
pnpm dev                           # all services
pnpm --filter @opencairn/<pkg> dev # package dev server
pnpm db:generate / db:migrate      # Drizzle
docker compose up -d               # infra
```

## High-Value Docs

| Need | Read |
| --- | --- |
| Full docs index | `docs/README.md` |
| Current plan status | `docs/contributing/plans-status.md` |
| Feature duplicate guard | `docs/contributing/feature-registry.md` |
| Project history map | `docs/contributing/project-history.md` |
| System architecture | `docs/superpowers/specs/2026-04-09-opencairn-design.md` |
| API contract | `docs/architecture/api-contract.md` |
| Ingest -> wiki -> Q&A flow | `docs/architecture/data-flow.md` |
| Collaboration model | `docs/architecture/collaboration-model.md` |
| Agent Runtime Standard | `docs/superpowers/specs/2026-04-20-agent-runtime-standard-design.md` |
| Context budget policy | `docs/architecture/context-budget.md` |
| Repeated LLM mistakes | `docs/contributing/llm-antipatterns.md` |
| Completion-claim audit | `docs/review/2026-04-28-completion-claims-audit.md` |

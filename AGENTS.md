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

Because `.private-docs/` and `docs/superpowers/` are local maintainer context
outside the public repository diff, update them directly when they are the right
place to record status, handoffs, audit findings, or next-session prompts. Do
not avoid private doc updates merely because the active feature work is in a
separate worktree; just keep those private notes out of public docs and PR copy
unless the maintainer asks otherwise.

Recommended private read order:

1. `.private-docs/docs/contributing/plans-status.md`
2. `.private-docs/docs/contributing/project-history.md`
3. `.private-docs/docs/contributing/llm-antipatterns.md`
4. Relevant `docs/superpowers/specs/` and `docs/superpowers/plans/`
5. Relevant `.private-docs/docs/review/` audit notes when verifying claims or
   implementation status

When working from a Git worktree, remember that ignored maintainer docs are not
checked out automatically. Treat the root checkout at
`C:\Users\Sungbin\Documents\GitHub\opencairn-monorepo` as the canonical source
for `.private-docs/` and `docs/superpowers/`. If those paths are missing in a
worktree, either read them from the root checkout or create Windows junctions
back to the root copies before planning or auditing:

```powershell
$root = "C:\Users\Sungbin\Documents\GitHub\opencairn-monorepo"
$wt = (Get-Location).Path
New-Item -ItemType Junction -Path "$wt\.private-docs" -Target "$root\.private-docs"
New-Item -ItemType Junction -Path "$wt\docs\superpowers" -Target "$root\docs\superpowers"
```

When a task requires updating private maintainer docs from a worktree, update
the canonical root copies or the worktree junctions that point to them. Do not
create duplicate private docs inside a feature branch, and do not move private
planning, status, audit, or handoff notes into public docs just to make them
visible from a worktree. Public repository docs, such as `docs/README.md`,
`docs/contributing/*`, `docs/architecture/*`, `docs/agents/*`, and
`docs/testing/*`, should still be edited in the active feature worktree when
they are part of the public change being proposed.

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

## GitHub Operations

Do not use GitHub connector/MCP tools for this repository. Use local `git` and
the authenticated `gh` CLI for PR creation, PR inspection, review replies,
review-thread resolution, reruns, and merge-state checks.

## Commands

```bash
pnpm dev                           # all services
pnpm --filter @opencairn/<pkg> dev # package dev server
pnpm db:generate / db:migrate      # Drizzle
docker compose up -d               # local infra
```

Use the narrowest verification that covers the changed package. When touching
copy, run the web i18n parity check.

## Local Worktree Test Notes

- After creating a worktree, verify whether `.private-docs/` and
  `docs/superpowers/` exist. If they are missing, use the root checkout copies
  or create junctions as described in the Private Maintainer Docs section before
  claiming private plan/status context is unavailable.
- Do not edit the root checkout `.env` just to make a feature worktree test
  pass. Prefer per-process environment variables or a worktree-local ignored
  `.env` file.
- On Windows, if `127.0.0.1:5432` is already bound, start Postgres with a
  worktree-specific host port, for example `POSTGRES_HOST_PORT=15432`, and make
  the test process `DATABASE_URL` point at the same port.
- Vitest and Drizzle configs load `../../.env`, but existing process
  environment values should win. When running DB/API tests from a worktree,
  explicitly pass the adjusted `DATABASE_URL` plus required API secrets such as
  `BETTER_AUTH_SECRET` instead of assuming the worktree has its own `.env`.
- If a worktree has no `.env`, do not fail over to the default `5432` database
  accidentally. Read the canonical root `.env` into process environment only,
  then override the worktree-specific port before running DB/API tests. Example
  PowerShell pattern:

```powershell
$envFile = "C:\Users\Sungbin\Documents\GitHub\opencairn-monorepo\.env"
Get-Content -LiteralPath $envFile | ForEach-Object {
  if ($_ -match '^\s*([^#][^=]+)=(.*)$') {
    $name = $matches[1].Trim()
    $value = $matches[2].Trim()
    if (($value.StartsWith('"') -and $value.EndsWith('"')) -or
        ($value.StartsWith("'") -and $value.EndsWith("'"))) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    [Environment]::SetEnvironmentVariable($name, $value, "Process")
  }
}
$env:DATABASE_URL = $env:DATABASE_URL `
  -replace 'localhost:5432', 'localhost:15432' `
  -replace '127\.0\.0\.1:5432', '127.0.0.1:15432'
pnpm --filter @opencairn/api exec vitest run <test-files>
```

- If `pnpm db:migrate` through Turbo does not forward the adjusted
  `DATABASE_URL`, run `pnpm exec drizzle-kit migrate` from `packages/db` with
  the same process environment and record that deviation in the handoff.
- When creating PRs from PowerShell with `gh pr create`, avoid inline bodies
  that contain quotes, backticks, or multi-line Markdown. Put the body in a
  here-string variable or a temporary body file and pass that value to
  `--body`/`--body-file`; this prevents PowerShell from splitting quoted test
  commands into stray CLI arguments.

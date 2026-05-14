# Codex Maintainer Workflow

This workflow keeps Codex sessions useful as OpenCairn grows. It favors
waterfall-style context routing and gates, then iterative implementation inside
that boundary.

## 1. Start With Context

For OpenCairn work, start in this order:

1. Read `AGENTS.md`.
2. Read `docs/README.md`, then route to the relevant public docs.
3. Check `docs/contributing/feature-registry.md` before creating or extending a
   feature surface.
4. For maintainer-only status, read `.private-docs/docs/contributing/plans-status.md`
   and the relevant `docs/superpowers/specs/` or `docs/superpowers/plans/`.
5. Use the relevant local OpenCairn skill, especially `opencairn-rules` before
   implementation and `opencairn-post-feature` before calling work done.

## 2. Pick The Smallest Real Slice

Prefer a slice that crosses the real product path instead of adding another
parallel surface. A good slice names:

- the user-visible outcome
- the owning paths from the feature registry
- the expected API/shared/DB/worker/web boundaries
- the focused verification commands
- whether live smoke is needed

If the change is large, create or update a design/spec first, then split
implementation by disjoint write areas.

## 3. Implement With Boundaries

- Keep `apps/web` away from DB imports and Server Actions.
- Put business logic and permission checks in `apps/api`.
- Use Temporal for long-running worker paths.
- Route provider calls through `packages/llm`.
- Put shared contracts in `packages/shared`.
- Update public docs only for stable contributor-facing behavior.
- Update private docs for maintainer status, handoffs, review findings, or
  next-session prompts.

## 4. Verify Before Handoff

Start with:

```bash
pnpm check:health
```

For public/docs/CI surfaces, use:

```bash
pnpm check:public
```

For feature work, add focused checks from the harness recommendation and the
feature registry. Common examples:

```bash
pnpm --dir apps/web exec tsc --noEmit --project tsconfig.json --pretty false
pnpm --filter @opencairn/api exec tsc --noEmit --project tsconfig.json --pretty false
pnpm --filter @opencairn/web test
uv run --project apps/worker ruff check
uv run --project apps/worker pyright
uv run --project apps/worker pytest
git diff --check
```

Use live smoke only when the change crosses real services such as Temporal,
object storage, Google exports, browser rendering, or database migrations.
Worker lint/type, Hocuspocus websocket smoke, and full E2E are active
development gates: run them for changes in those areas, but do not block an
unrelated docs/CI harness change on existing work-in-progress failures.

## 5. Finish Cleanly

Before final handoff:

1. Run `opencairn-post-feature`.
2. Review the actual diff.
3. State which checks passed and which were intentionally deferred.
4. Keep unrelated dirty files out of the commit.
5. Use local `git` and `gh` for PR work; do not use GitHub connector tools for
   this repository.

The preferred rhythm is:

```text
context route -> feature ownership -> small slice -> focused implementation ->
health harness -> focused checks -> diff review -> PR or direct handoff
```

## 6. PR And Gemini Review Policy

Working alone does not remove the need for review. It changes when the review is
worth the overhead.

Use a PR and inspect Gemini Code Assist feedback for:

- changes that touch more than one runtime layer, such as web plus API, API plus
  worker, DB plus API, or shared contracts plus callers
- permission, auth, billing, security, BYOK, CORS, sandbox, or data-loss risks
- migrations, schema changes, import/export flows, Temporal workflows, object
  storage, provider integrations, or live-smoke surfaces
- changes that update public product behavior, feature registry status, or
  architecture contracts
- branches that will be hard to reason about from a single diff after the fact

Direct commit can be reasonable for:

- small docs/index/guidance edits with `pnpm docs:check`, `pnpm check:health`,
  and `git diff --check`
- narrow copy/i18n fixes with parity checks
- local private maintainer notes that are intentionally ignored
- mechanical cleanup that is trivially reviewed in the local diff

If a PR is opened, use local `gh` to inspect reviews before merge:

```powershell
gh pr view <number> --comments
gh api repos/Sungblab/opencairn-monorepo/pulls/<number>/reviews
gh api repos/Sungblab/opencairn-monorepo/pulls/<number>/comments
```

Treat Gemini feedback as a second reviewer, not an authority. Apply comments
that identify real correctness, security, test, or maintainability issues;
reply or ignore comments that conflict with verified project contracts.

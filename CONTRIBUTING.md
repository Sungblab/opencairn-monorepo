# Contributing to OpenCairn

Thanks for considering a contribution. OpenCairn is alpha — interfaces, schemas, and migrations move week to week — so please coordinate via Issues before sinking time into a large change.

## Before you start

1. Read `CLAUDE.md` and `docs/README.md` for orientation.
2. Walk through `docs/contributing/dev-guide.md` to set up your environment and learn the test commands you will be expected to pass.
3. Check `docs/contributing/plans-status.md` — work is coordinated via numbered "plans" so you can see what is already in flight.
4. If you use LLM coding tools, skim `docs/contributing/llm-antipatterns.md`. It captures recurring failure modes specific to this codebase (Plate v49, Drizzle, Gemini SDK, Hocuspocus, Temporal, Pyodide, …) and will save you hours.

## Filing issues

- **Bugs** — please include reproduction steps, the commit SHA you are on, your environment (OS, Node, Python, Docker version), and relevant logs (with secrets redacted).
- **Feature requests** — describe the user-visible problem first. A concrete API or UI shape is welcome but optional.
- **Security issues** — do *not* open a public Issue. See [SECURITY.md](SECURITY.md).

## Pull requests

1. Fork and branch from `main`. Branch names follow `feat/<short>`, `fix/<short>`, `chore/<short>`, `docs/<short>`, `refactor/<short>`.
2. Keep PRs focused — one logical change per PR. Mixing a refactor with a feature makes review slow and risky; please split.
3. Run the project's lint and tests before pushing — see `docs/contributing/dev-guide.md` for the exact commands per package. New env vars belong in `.env.example` with a comment explaining purpose and safe defaults.
4. Update documentation and migrations alongside code. Schema changes go through `pnpm db:generate`.
5. PRs are squash-merged. The squash subject becomes the permanent commit message — write it as if it will be read in `git log` a year from now.

## Commit conventions

Format:

```
<type>(<scope>): <subject>
```

- `type` ∈ `feat | fix | chore | docs | refactor | test | perf | style`
- `scope` ∈ `web | api | worker | db | shared | llm | infra | docs`
- subject in imperative present tense, lowercase, no trailing period
- one logical change per commit; each commit must build and pass tests

Example:

```
feat(worker): add doc-editor rag slash commands
fix(api): preserve folderId on note PATCH when omitted
docs(architecture): document context budget policy
```

## Code style

- **TypeScript** — ESLint + Prettier wired through Turbo. `pnpm lint` at the repo root runs everything.
- **Python (worker)** — `ruff` for lint + format. `pytest` for tests, with the real Postgres / pgvector services running.
- **Tests** — integration tests use a real database, not mocks. The mock/prod divergence rationale is in `docs/contributing/llm-antipatterns.md`.
- **i18n** — under `apps/web`, user-facing strings live in `messages/{locale}/*.json`. ESLint enforces this and `pnpm --filter @opencairn/web i18n:parity` runs in CI.

## License

By submitting a contribution you agree it will be licensed under AGPL-3.0-or-later, the project's license. See [LICENSE](LICENSE).

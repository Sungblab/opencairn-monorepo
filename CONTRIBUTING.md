# Contributing to OpenCairn

Thanks for considering a contribution. OpenCairn is alpha — interfaces, schemas, and migrations move week to week — so please coordinate via Issues before sinking time into a large change.

## Before you start

1. Read `AGENTS.md` and `docs/README.md` for orientation.
2. Walk through `docs/contributing/dev-guide.md` to set up your environment and learn the test commands you will be expected to pass.
3. Check `docs/contributing/roadmap.md` and `docs/contributing/feature-registry.md` so you can see what is already implemented or in flight.
4. If you use LLM coding tools, keep changes narrow and verify against the owning package tests. Internal agent handoffs and raw failure logs are not part of the public repo.

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
- **Tests** — integration tests use a real database, not mocks. Keep test setup close to the production boundary unless a unit test is intentionally isolating one function.
- **i18n** — under `apps/web`, user-facing strings live in `messages/{locale}/*.json`. ESLint enforces this and `pnpm --filter @opencairn/web i18n:parity` runs in CI.

## License & Contributor License Agreement

OpenCairn is **dual-licensed** under [AGPL-3.0-or-later](LICENSE) and an
optional commercial license (see [`LICENSE-COMMERCIAL.md`](LICENSE-COMMERCIAL.md)).

For the dual-license model to work, the project must be able to distribute every
contribution under both licenses. We therefore ask non-trivial contributors to
accept the [Contributor License Agreement (CLA)](CLA.md). The CLA grants the
project the right to relicense your contribution; you retain copyright.

**How to accept the CLA** until the automated CLA-Assistant bot is enabled:

1. Read [`CLA.md`](CLA.md) v1.0.
2. Add this trailer to every commit in your pull request:

   ```
   Signed-off-by: Your Real Name <your-email@example.com>
   OpenCairn-CLA: accepted v1.0
   ```

   The `OpenCairn-CLA: accepted v1.0` line is the explicit acceptance; the
   `Signed-off-by` line is the standard DCO sign-off attesting that you have
   the right to submit the work.

3. Alternatively, post a comment on your pull request stating: *"I have read
   and accept the OpenCairn Contributor License Agreement v1.0."*

**Trivial contributions** (typo fixes, minor doc edits, small dependency bumps)
do **not** require a signed CLA, but the maintainer may request one for any
contribution at their discretion. If unsure, accept the CLA — it is a one-line
trailer.

**Why CLA, not just AGPL?** The AGPL alone does not authorize the project to
relicense your contribution under non-AGPL terms (such as a commercial license
for organizations that cannot use AGPL-licensed software). The CLA explicitly
grants that authorization while leaving you as the copyright holder of your
work.

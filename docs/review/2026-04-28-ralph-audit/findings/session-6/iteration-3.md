# Session 6 — Iteration 3 Findings

**Coverage**: Area 6 (packages/emails + Resend) + Area 8 (Build/CI quality gates)
**Date**: 2026-04-28
**Auditor**: Ralph (Claude)

---

## Critical

_None._

---

## High

### S6-022 — CI pipeline removed; no automated test/lint/type-check enforcement on PRs

**File**: `.github/workflows/` (only `release.yml` remains after PR #136)
**Axis**: Test Coverage / Code Quality

PR #136 removed the PR/push CI workflow (`chore(ci): remove PR/push CI workflow`). Only `release.yml` (Docker image publish on tag push) remains. As a result:

- No automated test runs (`vitest`, `pytest`) on PR
- No automated TypeScript type check (`tsc --noEmit`)
- No automated ESLint enforcement (`pnpm lint`)
- No automated i18n parity check (`pnpm --filter @opencairn/web i18n:parity`)
- No automated Drizzle migration check

**Contradiction**: `AGENTS.md:40` still reads "ESLint `i18next/no-literal-string` + `pnpm --filter @opencairn/web i18n:parity` CI enforced." This is factually incorrect — CI enforcement no longer exists.

**Impact**: All quality gates are now honor-system only. A PR merging with failing tests, broken types, ESLint violations, or i18n parity breaks would pass GitHub PR status checks silently.

**Fix**: Restore a minimal CI workflow (can be fast: pnpm install → tsc → lint → vitest → i18n:parity). Or update `AGENTS.md` and `CLAUDE.md` to remove the "CI enforced" claim and document the required pre-merge manual checklist.

---

## Medium

### S6-019 — `packages/emails`: `VerificationEmail` and `ResetPasswordEmail` have no test coverage

**File**: `packages/emails/tests/` (only `layout.test.tsx`, `invite.test.tsx`, `button.test.tsx`)
**Axis**: Test Coverage

3 template files exist (`invite.tsx`, `verification.tsx`, `reset-password.tsx`) but only `invite.tsx` has a dedicated test. `VerificationEmail` and `ResetPasswordEmail` are exercised only through `Layout` (structural rendering). Missing coverage:

- `verifyUrl` renders in CTA button `href` for `VerificationEmail`
- `resetUrl` renders in CTA button `href` for `ResetPasswordEmail`  
- Link-text fallback (plain-text URL) renders in both templates
- 24h expiry copy present in `VerificationEmail`
- 1h expiry copy present in `ResetPasswordEmail`
- Korean honorific copy in both templates

The XSS defense test (`InviteEmail` escapes `<script>` in inviter name) is only checked for the one user-controlled input (`inviter`). The verification/reset URLs are system-generated so XSS risk is low, but the absence of rendering tests means template regressions (broken layout, missing button) won't be caught by the test suite.

**Current test count**: 14 (6 layout + 6 invite + 2 button). `react-email` v6 `render()` is async — tests need `await`.

---

## Low

### S6-020 — `layout.test.tsx` asserts hardcoded `hello@opencairn.com`; blocks OSS refactor

**File**: `packages/emails/tests/layout.test.tsx:39`
**Axis**: Code Quality / OSS

```ts
expect(html).toContain("hello@opencairn.com");
```

The test verifies the specific branded email address in the footer. When Plan 9b makes `Layout` accept a configurable contact email (env-driven), this test must be updated. Until then it documents the brand dependency, which is fine — but worth noting so the refactor doesn't fail silently.

---

### S6-021 — Release workflow only publishes `api` + `web`; `worker` and `hocuspocus` not in GHCR

**File**: `.github/workflows/release.yml:33`
**Axis**: Missing Features (self-hosting)

```yaml
matrix:
  app: [api, web]
```

`apps/worker/Dockerfile` and `apps/hocuspocus/Dockerfile` are not in the release matrix. Self-hosters using `docker compose --profile worker --profile hocuspocus up` must build these images locally from source (the compose `build:` context covers this). For reproducible deployments or air-gapped installs, pre-built GHCR images for all 4 services would be needed.

**Status**: Not a current blocker — compose builds locally. Document for tracking.

---

## Observations (No Severity)

- `packages/db` integration tests: canvas constraint, conversations, doc-editor-calls, note-enrichments, wiki-links, schema-plan-2b — all use real DB (correct pattern, no mocking). Tests load `.env` from monorepo root via `dotenv`. ✓
- `turbo.json` task graph: lint depends on `^build` (builds dependencies first). Standard Turborepo pattern. ✓
- Release workflow: multi-arch (`linux/amd64,linux/arm64`), SBOM + provenance attestation enabled, GHCR push scoped to `packages: write` only. Security posture is good. ✓
- No `dependabot.yml` (PR #134 removed auto-merge workflow) — manual dep updates only. Not necessarily a problem but worth monitoring.
- `packages/emails` react-email v6 + `@react-email/render` v2: up-to-date dependency versions at time of Plan commit. No known breaking API changes. ✓

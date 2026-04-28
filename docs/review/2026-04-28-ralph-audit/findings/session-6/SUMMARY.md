# Session 6 — Findings Summary (Running)

**Domain**: Data Layer & Infra & DX
**Auditor**: Ralph (Claude)
**Max iterations**: 8

---

## Status

| Iteration | Areas | Critical | High | Medium | Low | Status |
|-----------|-------|----------|------|--------|-----|--------|
| 1 | Schema Inventory + Migration Integrity | 0 | 1 | 2 | 7 | ✅ Done |
| 2 | pgvector + Indexes + i18n + ESLint | 0 | 0 | 1 | 5 | ✅ Done |
| 3 | packages/emails + CI/Build | 0 | 1 | 1 | 2 | ✅ Done |
| 4 | packages/templates + packages/shared + sweep | 0 | 0 | 1 | 2 | ✅ Done |
| 5 | packages/llm + worker infra + schema sweep + compose re-check | 0 | 0 | 0 | 0 | ✅ Done — TERMINATED |

---

## All Findings (Cumulative)

| ID | Severity | Area | Title |
|----|----------|------|-------|
| S6-011 | **High** | Security | MinIO root password defaults to `minioadmin` (`:?` guard missing) |
| S6-001 | Medium | Correctness | `user.lastViewedWorkspaceId` missing `.references()` → schema/migration drift |
| S6-002 | Medium | Correctness | `noteEnrichments.workspaceId` FK uses NO ACTION vs CASCADE pattern |
| S6-003 | Low | Correctness | `doc_editor_calls.userId` FK: NO ACTION undocumented (vs cascade everywhere else) |
| S6-004 | Low | Code Quality | `doc_editor_calls.status` uses `text`+CHECK instead of pgEnum |
| S6-005 | Low | Missing | No `subscriptions`/`credit_balances` tables — Plan 9b deferred |
| S6-006 | Low | Security/OSS | Email templates hardcode brand, contact email — Plan 9b deferred |
| S6-007 | Low | OSS | `robots.ts`/`sitemap.ts` fallback to hardcoded `opencairn.com` — Plan 9b |
| S6-008 | Low | Correctness | HNSW indexes not expressible in Drizzle → btree snapshot drift risk |
| S6-009 | Low | Correctness | Migration filename gap: `0030_*.sql` missing (journal correct, cosmetic) |
| S6-010 | Low | Correctness | Missing intermediate Drizzle snapshots (0032–0034); latest 0035 present |
| S6-013 | Medium | Correctness | GiST index on `folders.path` SQL-only; btree snapshot drift risk (same as S6-008) |
| S6-014 | Low | Performance | HNSW default params (m=16, ef_c=64); may need tuning past 100k notes |
| S6-015 | Low | Correctness | `search.ts` ILIKE passes LIKE metacharacters (`%`, `_`) unescaped |
| S6-016 | Low | i18n/Copy | `account.json` stub references completed Phase E; stale copy |
| S6-017 | Low | OSS/i18n | ESLint excludes `"OpenCairn"` globally — brand hardcodes bypass linting |
| S6-018 | Low | i18n | i18n parity script checks ko→en only; orphaned en-only files undetected |
| S6-022 | **High** | Test Coverage | CI removed; no automated test/lint/type-check enforcement; AGENTS.md claim incorrect |
| S6-019 | Medium | Test Coverage | `packages/emails`: VerificationEmail + ResetPasswordEmail have no tests |
| S6-020 | Low | Code Quality | `layout.test.tsx` asserts hardcoded `hello@opencairn.com` — blocks OSS refactor |
| S6-021 | Low | Missing | Release workflow only publishes `api`+`web`; worker/hocuspocus not in GHCR |
| S6-023 | Medium | Correctness | `sourceTypeSchema` missing `"paper"` — Zod/DB enum drift after migration 0033 |
| S6-024 | Low | Missing | `packages/templates` complete library; integration endpoint is 501 stub |
| S6-025 | Low | Security | `engine.ts:loadTemplate` uses `readFileSync(id)` without path guard — safe now, risk when stub becomes real route |

---

## Termination Tracker

Consecutive iterations with Critical=0 AND High=0: **2 / 2 — AUDIT COMPLETE**

- Iteration 1: 1 High (S6-011). Not counted.
- Iteration 2: 0 Critical, 0 High. Count: 1.
- Iteration 3: 0 Critical, 1 High (S6-022). Count reset to 0.
- Iteration 4: 0 Critical, 0 High. Count: 1.
- Iteration 5: 0 Critical, 0 High. **Count: 2 → TERMINATE.**

Note: S6-011 (MinIO weak default) was fixed in commit `a1f6bc6` (post iteration-1) and is no longer present in the codebase.

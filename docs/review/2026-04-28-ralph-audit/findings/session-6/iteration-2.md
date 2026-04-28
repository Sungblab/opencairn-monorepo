# Session 6 — Iteration 2 Findings

**Coverage**: Area 3 (pgvector + Index Strategy) + Area 4 (i18n parity + ESLint literal-string)
**Date**: 2026-04-28
**Auditor**: Ralph (Claude)

---

## Critical

_None._

---

## High

_None._

---

## Medium

### S6-013 — GiST index on `folders.path` is SQL-only; Drizzle snapshot records it as btree placeholder (same risk as S6-008)

**File**: `packages/db/drizzle/0018_folders_ltree_path.sql:61`, `packages/db/src/schema/folders.ts:28`
**Axis**: Correctness (schema-migration drift)

Comment in `folders.ts` acknowledges: "GiST index is created in the 0018 migration — Drizzle can't emit `USING GIST` via the builder, so the index is declared in SQL only."

This is the same structural problem as S6-008 (HNSW for embedding columns). The Drizzle snapshot records `folders_path_gist` as a btree placeholder. A `drizzle-kit generate` run triggered by any schema change to `folders` may emit `DROP INDEX "folders_path_gist"` followed by a btree recreation, silently degrading ltree subtree queries from O(log n) GiST to O(n) sequential.

Unlike S6-008 where the comment was proactive, this one has no mitigation note suggesting developers watch for the regeneration.

**Fix**: Add a comment to `folders.ts` (matching the pattern in `0014`) noting that `folders_path_gist` is SQL-authoritative. Add a CI guard (or at minimum a AGENTS.md/ops note) that `drizzle-kit generate` output must be reviewed for DROP of GiST indexes.

---

## Low

### S6-014 — HNSW index has no custom `m`/`ef_construction` parameters

**File**: `packages/db/drizzle/0014_plans_1_to_4_tier_2.sql:17-18`
**Axis**: Performance

```sql
CREATE INDEX "notes_embedding_hnsw_idx" ON "notes" USING hnsw ("embedding" vector_cosine_ops);
CREATE INDEX "concepts_embedding_hnsw_idx" ON "concepts" USING hnsw ("embedding" vector_cosine_ops);
```

Default pgvector HNSW parameters: `m=16, ef_construction=64`. For 768-dimensional vectors these defaults give good precision at moderate scale. At >100k notes, increasing `m=32, ef_construction=128` improves recall from ~95% to ~99% at ~2× build cost. No production data yet, so no immediate action, but worth documenting for the scale-up runbook.

---

### S6-015 — `search.ts` ILIKE passes LIKE metacharacters unescaped

**File**: `apps/api/src/routes/search.ts:67`
**Axis**: Correctness

```ts
ilike(notes.title, `%${q}%`)
```

Drizzle parameterizes the query (no SQL injection risk). However, if `q` contains `%` or `_` (LIKE wildcards), the search becomes overly broad: searching `%` returns all notes, `_` matches any single character. The Zod validator limits `q` to 64 chars but doesn't strip LIKE metacharacters.

**Fix**: Escape `%` and `_` in `q` before constructing the ILIKE pattern:
```ts
const escaped = q.replace(/%/g, '\\%').replace(/_/g, '\\_');
ilike(notes.title, `%${escaped}%`)
```
Also set `escape` clause if the Drizzle version exposes it.

---

### S6-016 — i18n: `account.json` stale stub copy after Phase E merge

**Files**: `apps/web/messages/ko/account.json:21`, `apps/web/messages/en/account.json:22`
**Axis**: i18n & Copy

```json
// ko
"stub": "BYOK 키 등록 화면은 Deep Research Phase E 합류 후 활성화됩니다."
// en
"stub": "BYOK key registration ships with Deep Research Phase E."
```

Deep Research Phase E merged (PR #46, main `86bd3e8`, 2026-04-26). BYOK GET/PUT/DELETE + ByokKeyCard + `/settings/ai` shipped. The stub text references a completed event, so users who navigate to the BYOK tab see a message about a feature that has already arrived.

**Fix**: Update both `ko` and `en` stubs to describe the actual UI state, or remove the stub text if the BYOK tab is now functional.

---

### S6-017 — ESLint `i18next/no-literal-string` exclusion of `"^OpenCairn$"` allows brand hardcode in JSX

**File**: `apps/web/eslint.config.mjs:35`
**Axis**: i18n & Copy / OSS

```js
words: {
  exclude: ["^OpenCairn$", ...]
}
```

The `OpenCairn` literal is excluded from the i18next/no-literal-string rule globally. This allows JSX like `<span>OpenCairn</span>` anywhere in the app without an i18n key. For the hosted product this is intentional (brand name). For self-hosted forks, the brand name is now hardcoded throughout the UI with no ESLint enforcement.

This is a deferred item (Plan 9b OSS sweep will handle substitution). But the exclusion means the sweep has no lint-time feedback — a developer can add `OpenCairn` anywhere and it will silently pass CI.

**Status**: Plan 9b scope. Document for tracking.

---

### S6-018 — i18n parity script checks `ko → en` only; orphaned `en`-only files not detected

**File**: `apps/web/scripts/i18n-parity.mjs`
**Axis**: i18n & Copy / Test Coverage

The script iterates `messages/ko/*.json` and verifies each exists in `messages/en/`. It does NOT check for files present in `messages/en/` that have no `ko/` counterpart. Currently both directories have 31 matching files, so no issue today. A future commit that adds an EN-only file would silently pass the parity check.

**Fix**: Add a reverse check:
```js
const enFiles = (await readdir(EN)).filter(f => f.endsWith('.json'));
for (const f of enFiles) {
  if (!files.includes(f)) { console.error(`missing ko/${f}`); failed = true; }
}
```

---

## Observations (No Severity)

- i18n parity: **31 namespaces, all passing parity OK** as of today. ✓
- ESLint rule `i18next/no-literal-string` correctly scoped: mode=`jsx-text-only`, tests/ui-components excluded, `useTranslations`/`getTranslations` callees excluded. ✓
- FTS search uses `plainto_tsquery('simple', ...)` — correct for multi-language (Korean+English) without stemming. GIN index on `content_tsv` via migration 0006. ✓
- pgvector dimension: All vector columns use `VECTOR_DIM` env (default 768). Migration 0007 confirms dimension switch from 3072 → 768 with NULL wipe. HNSW and FTS indexes created AFTER the switch (0014 > 0007). ✓
- ltree subtree queries use `path <@ ancestor` with the GiST index — correct operator for the indexed access pattern. ✓
- `userPreferences.llmModel` defaults to `"gemini-3-flash-preview"` which differs from `GEMINI_CHAT_MODEL` default `"gemini-2.5-flash"` in docker-compose. Two env vars control model selection; inconsistency between code default and compose default could cause confusion. Low observation, no fix needed immediately.

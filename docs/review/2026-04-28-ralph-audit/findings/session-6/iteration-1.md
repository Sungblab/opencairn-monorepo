# Session 6 — Iteration 1 Findings

**Coverage**: Area 1 (Schema Inventory) + Area 2 (Migration Integrity)
**Date**: 2026-04-28
**Auditor**: Ralph (Claude)

---

## Critical

_None._

---

## High

### S6-011 — MinIO root password defaults to known value `minioadmin`

**File**: `docker-compose.yml:68`
**Axis**: Security

```yaml
MINIO_ROOT_PASSWORD: ${MINIO_ROOT_PASSWORD:-minioadmin}
```

Unlike `POSTGRES_PASSWORD` which uses `:?` (fails fast if unset), `MINIO_ROOT_PASSWORD` silently falls back to `minioadmin`. MinIO's web console (port 9001) and S3 API (port 9000) are then accessible with publicly known credentials. All user-uploaded files — source documents, audio, images, canvas outputs — live in this bucket.

**Why it matters**: Self-hosted deployments that copy `.env.example` and set `MINIO_ROOT_PASSWORD=` (empty line as shown) still get `minioadmin` via the `:-default` expansion rule.

**Fix**: Change to `:?` (same pattern as POSTGRES_PASSWORD), or add a mandatory note in `.env.example`:
```yaml
MINIO_ROOT_PASSWORD: ${MINIO_ROOT_PASSWORD:?set MINIO_ROOT_PASSWORD in .env}
```

---

## Medium

### S6-001 — `user.lastViewedWorkspaceId` missing `.references()` in Drizzle schema

**File**: `packages/db/src/schema/users.ts:25`
**Axis**: Correctness (schema-migration drift)

```ts
lastViewedWorkspaceId: uuid("last_viewed_workspace_id"),
```

The comment says "we need a forward-declared FK via the inline `references()` helper" but the call is absent. Migration `0017_users_last_viewed_workspace.sql` adds the FK (`ON DELETE SET NULL`) correctly. Result: Drizzle schema and snapshot disagree — future `drizzle-kit generate` runs may emit a spurious `ADD CONSTRAINT` or `DROP CONSTRAINT` diff, silently corrupting the migration history.

**Evidence**: `0017_users_last_viewed_workspace.sql` line 9–12 adds the FK; `users.ts` line 25 has no `.references()`.

**Fix**: The circular import (`users → workspaces → users`) is the stated reason. Use a lazy type import or split the FK into its own migration and mark the column as "FK in SQL only" in a comment (matching the pattern in `0014_plans_1_to_4_tier_2.sql` for HNSW indexes). Alternatively, suppress Drizzle drift by adding a comment that `drizzle-kit` should treat this as "custom SQL only" — but the real fix is documenting the deliberate exclusion.

---

### S6-002 — `noteEnrichments.workspaceId` FK policy is `NO ACTION` (implicit) vs pattern `CASCADE`

**File**: `packages/db/src/schema/note-enrichments.ts:25`
**Axis**: Correctness (FK policy inconsistency)

```ts
workspaceId: uuid("workspace_id")
  .notNull()
  .references(() => workspaces.id),   // no onDelete → NO ACTION
```

Every other `workspaceId` FK in the schema uses `{ onDelete: "cascade" }`. Confirmed in migration `0034_note_enrichments.sql` line 16:
```sql
FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action
```

In practice this doesn't break workspace deletion today because the cascade chain goes `workspace → projects → notes → note_enrichments (via noteId CASCADE)`, deleting enrichment rows before Postgres checks the `workspace_id NO ACTION` constraint. However:

1. If a row is ever created with `note_enrichments.workspace_id ≠ note.workspace_id` (data skew bug), the `NO ACTION` block would surface as a FK violation on workspace deletion.
2. Any direct query that deletes by workspace_id without the note cascade path would fail.

**Fix**: Add `{ onDelete: "cascade" }` to match the schema-wide pattern and generate a migration to update the FK.

---

## Low

### S6-003 — `doc_editor_calls.userId` FK uses `NO ACTION` (inconsistent with other user FKs)

**File**: `packages/db/src/schema/doc-editor-calls.ts:30`
**Axis**: Correctness

All other user-FK columns use `{ onDelete: "cascade" }`. `docEditorCalls.userId` omits the policy (NO ACTION), blocking user deletion if audit rows exist. May be intentional for audit-trail preservation, but not documented.

**Fix**: Add a comment explaining the deliberate `NO ACTION` choice (e.g., "intentional: audit rows must outlive the user for billing reconciliation"), or switch to `cascade` if audit preservation is not required.

---

### S6-004 — `doc_editor_calls.status` uses `text` + CHECK instead of pgEnum

**File**: `packages/db/src/schema/doc-editor-calls.ts:38`
**Axis**: Code Quality

```ts
status: text("status").notNull(),
// + check constraint
```

All other closed-set columns use `pgEnum`. The CHECK constraint (`IN ('ok', 'failed')`) is equivalent but bypasses Postgres type-level validation and Drizzle type inference. Future values require a raw SQL migration instead of an `ALTER TYPE` statement.

**Fix**: Convert to `pgEnum("doc_editor_call_status", ["ok", "failed"])` + migration.

---

### S6-005 — No `subscriptions` or `credit_balances` tables

**File**: `packages/db/src/schema/users.ts`, `workspaces.ts`
**Axis**: Missing Features

Anti-pattern checklist item: `users.plan enum으로 자격 체크 없음 → subscriptions + credit_balances`. Both `user.plan` (pgEnum: free/pro/byok) and `workspaces.planType` (pgEnum: free/pro/enterprise) are used as entitlement signals, but no `subscriptions` or `credit_balances` tables exist.

**Status**: Known gap — Plan 9b (deferred). Not a production blocker today since billing is not live.

---

### S6-006 — Email templates hardcode brand name and contact (OSS/hosting split)

**Files**:
- `packages/emails/src/components/Layout.tsx:29,38,41`
- `packages/emails/src/templates/invite.tsx:14,19`
- `apps/api/src/lib/email.ts:33`
- `apps/api/src/lib/literature-search.ts:25`

Hardcoded strings include: `OpenCairn`, `hello@opencairn.com`, `contact@opencairn.app`. Per `feedback_oss_hosting_split.md`, brand/contact/domain must be env-driven. Self-hosted deployments will see hosted-service branding in every transactional email.

**Status**: Known — sweep deferred to Plan 9b. Document for tracking.

Notable inconsistency: `apps/api/src/lib/email.ts` hardcodes `hello@opencairn.com` as the code fallback, but `docker-compose.yml` provides `EMAIL_FROM: ${EMAIL_FROM:-OpenCairn <noreply@example.com>}`. When running outside compose the code fallback fires instead of the compose default.

---

### S6-007 — `robots.ts` + `sitemap.ts` hardcode hosted-service domain as fallback

**Files**: `apps/web/src/app/robots.ts:3`, `apps/web/src/app/sitemap.ts:3`
**Axis**: Missing Features (OSS/hosting split)

```ts
const BASE = process.env.NEXT_PUBLIC_BASE_URL ?? "https://opencairn.com";
```

Env-first is correct; `??` fallback uses the hosted service domain. Self-hosters without `NEXT_PUBLIC_BASE_URL` get `https://opencairn.com` in their sitemap/robots. Plan 9b scope.

---

### S6-008 — HNSW indexes not expressible in Drizzle schema; snapshot records btree placeholder

**File**: `packages/db/drizzle/0014_plans_1_to_4_tier_2.sql:16–17`
**Axis**: Correctness (Drizzle schema-snapshot drift)

Comment in migration acknowledges: "drizzle-kit cannot emit the opclass through a customType column, so these two are hand-written here and the snapshot records them as plain btree placeholders."

Risk: Future `drizzle-kit generate` could emit a DROP + CREATE btree index, replacing the HNSW indexes. The comment instructs developers to not generate through these columns, but there is no automated guard.

**Fix**: Add a `drizzle.config.ts` comment or CI check that warns if `drizzle-kit generate` produces changes touching `notes_embedding_hnsw_idx` or `concepts_embedding_hnsw_idx`.

---

### S6-009 — Migration filename gap: `0030_*.sql` missing

**Files**: `packages/db/drizzle/`
**Axis**: Correctness (migration integrity)

Files jump from `0029_loving_miracleman.sql` to `0031_chat_scope_search_trgm.sql`. `_journal.json` idx=30 correctly points to `0031_chat_scope_search_trgm` (sequential). Drizzle behavior is correct.

Comment in `0031` explains: "parallel session warned that 0030 was reserved at the time this branch was opened." The reserved slot was never filled and is now permanently empty.

**Impact**: Purely cosmetic confusion for developers expecting prefix=idx alignment. No functional issue.

---

### S6-010 — Missing intermediate Drizzle snapshots (0032, 0033, 0034)

**Files**: `packages/db/drizzle/meta/`
**Axis**: Correctness (migration integrity)

Present: `0000`–`0029`, `0031`, `0035`. Missing: `0032`, `0033`, `0034`.

Latest `0035_snapshot.json` is present and accurate; `drizzle-kit generate` for future migrations works correctly. Missing snapshots only affect intermediate drift detection and historical state reconstruction.

**Impact**: `drizzle-kit check` may report warnings. No migration execution risk.

---

## Observation (No Severity)

- `docker-compose.yml` postgres healthcheck was fixed in commit `1a164aa` (today) to use `$${POSTGRES_USER}` / `$${POSTGRES_DB}` env interpolation. ✓
- `user.plan` enum correctly includes `byok` for BYOK users; no code path does entitlement checks via `user.plan` enum directly (checked `apps/api/src/routes/` — guards route through workspace membership, not user plan). ✓
- `VECTOR_DIM` env properly drives column type via `custom-types.ts`; migration `0007` confirmed dimension change to 768. ✓
- HNSW indexes for `notes.embedding` and `concepts.embedding` exist via `0014`; GIN index for `content_tsv` exists via `0006`. ✓
- `conversations` table correctly has NO `project_id NOT NULL` column — scope handled by `scopeType` + `scopeId` text pair. ✓
- `projects` table correctly uses `workspace_id` (not `user_id`) for scoping. ✓

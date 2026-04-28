# Session 5 — Iteration 2 Findings
**Areas covered:** Area 3 (complete `/api/internal/*` write route audit) · Area 4 (Share system)
**Files read:** `apps/api/src/routes/internal.ts` (continued, lines 1420–2502), `routes/share.ts` (review), `routes/invites.ts` (review)

---

## S5-002 — Updated: Complete list of internal write routes missing workspace scope

Iteration 1 identified 5 routes. Full read of `internal.ts` shows **11 write routes** without `assertResourceWorkspace` / explicit workspace guard:

| Route | What it writes | Gap |
|---|---|---|
| `POST /concepts/upsert` (~390) | `concepts` row | projectId only, no workspaceId param |
| `POST /concept-edges` (~440) | `concept_edges` row | Accepts arbitrary sourceId/targetId UUIDs with no project/workspace check |
| `POST /concept-notes` (~494) | `concept_notes` link | conceptId + noteId, no workspace check |
| `POST /wiki-logs` (~517) | `wiki_logs` row | noteId only, no workspace check |
| `PATCH /import-jobs/:id` (~1214) | `import_jobs` status/progress | ID only, no workspace assertion |
| `PATCH /notes/:id` (~1581) | note content/title/sourceType | ID only, **no workspace validation** (see S5-009) |
| `POST /stale-alerts` (~2369) | `stale_alerts` row | noteId only, no workspace check |
| `POST /audio-files` (~2393) | `audio_files` row | noteId only, no workspace check |
| `POST /code/turns` (~2165) | `code_turns` row | runId only, no workspace check |
| `PATCH /code/runs/:id/status` (~2204) | `code_runs.status` | ID only, no workspace check |
| `PATCH /research/runs/:id/finalize` (~2059) | `research_runs` status/completedAt | ID only, no workspace check |

**Routes correctly guarded** (for comparison): `POST /concepts/merge`, `POST /semaphores/acquire`, `POST /semaphores/release`, `POST /projects/:id/graph/expand`, `POST /suggestions`, `POST /notes/:noteId/enrichment`, `GET /notes/:noteId/enrichment`, `POST /literature/import`.

The pattern is _partially_ adopted. The newer routes (Plan 8+, enrichment, literature import) all have workspace guards. The older routes (Plan 3–7) predate the `internal-assert.ts` library and haven't been retrofitted.

---

## S5-009 · Medium · Security — `PATCH /internal/notes/:id` overwrites note content with no workspace check

**File:** `apps/api/src/routes/internal.ts:1581-1607`

```typescript
internal.patch("/notes/:id", zValidator("json", internalNotePatchSchema), async (c) => {
  const id = c.req.param("id");
  // ... uuid check ...
  const [updated] = await db.update(notes).set(patch)
    .where(and(eq(notes.id, id), isNull(notes.deletedAt)))
    .returning({ id: notes.id });
```

This endpoint can overwrite `content` (Plate JSON), `contentText`, `title`, and `sourceType` for any note by UUID — no workspaceId claim required. The import pipeline and other worker activities call this to backfill content. A misrouted Temporal payload (wrong `note_id`) would silently corrupt content in a different workspace.

**Contrast:** `POST /internal/source-notes` (~146) derives `workspaceId` from `projectId` and stores it on the note. `POST /internal/notes` (~1323) accepts optional `workspaceId` and consistency-checks it. `PATCH /internal/notes/:id` does neither.

**Fix:** Add `workspaceId: z.string().uuid()` to `internalNotePatchSchema` and add:
```typescript
const [existing] = await db.select({ workspaceId: notes.workspaceId }).from(notes).where(eq(notes.id, id));
if (!existing || existing.workspaceId !== body.workspaceId) return c.json({ error: "workspace_mismatch" }, 403);
```
before the UPDATE.

---

## S5-010 · Low · Security — `/internal/stale-alerts`, `/internal/audio-files` — no workspace scope check

**File:** `apps/api/src/routes/internal.ts:2369-2409`

`POST /internal/stale-alerts` inserts `{ noteId, stalenessScore, reason }` with no workspace check — a worker bug with a wrong `noteId` plants a stale alert on a note from another workspace.

`POST /internal/audio-files` inserts `{ noteId, r2Key, durationSec, voices }` without workspace check. In addition, `noteId` is **nullable** — the route can create orphan audio_files rows with no note association that are never accessible through any user-facing query.

**Fix:** Add `workspaceId: z.string().uuid()` to both schemas; resolve note's workspace via `assertResourceWorkspace` before insert.

---

## S5-011 · Low · Security — `/internal/code/turns` + `/code/runs/:id/status` — no workspace scope

**File:** `apps/api/src/routes/internal.ts:2165-2225`

`POST /internal/code/turns` accepts `runId` with no workspace guard. `PATCH /code/runs/:id/status` accepts `id` with no workspace guard. A misrouted Code Agent workflow could append turns or change status on a run belonging to a different workspace user.

`code_runs` has a `noteId` column that could be used to derive workspace. Alternatively, `code_runs.workspaceId` (if present on the schema) should be required in the body.

**Fix:** Add `workspaceId` to each schema; assert via `SELECT code_runs JOIN notes WHERE notes.workspaceId = claimed`.

---

## S5-012 · Low · Design — Share token list visible to all canRead users (viewers)

**File:** `apps/api/src/routes/share.ts:253-282` (`GET /notes/:id/share`)

The endpoint returns all active share link tokens (including raw 43-char tokens) to any authenticated user with `canRead` access to the note — including viewers and commenters. Any viewer can therefore:
1. Enumerate all active share links for a note.
2. Forward those tokens to third parties (giving external access at the link's role level).

**Context:** This is arguably by design — if you can read a note, sharing it with the world is not a privilege escalation. But it means the note author's share management intent is not preserved: a viewer could share the link widely even if the author intended a controlled audience.

**No code change required** if this is intentional — but worth documenting in the API contract.

---

## S5-013 · Low · Security — Public share IP rate limit is spoofable via X-Forwarded-For

**File:** `apps/api/src/routes/share.ts:59-70`

```typescript
const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim()
         ?? c.req.header("x-real-ip") ?? "unknown";
const rl = checkRateLimit(`share:public:${ip}`, 30, 60_000);
```

If the API is behind a reverse proxy that does NOT strip/override `X-Forwarded-For`, a caller can spoof any IP header and bypass the per-IP limit entirely. The rate limit then effectively applies only to `"unknown"` (the bucket for callers with no header).

**Fix:** Trust only the last hop in `X-Forwarded-For` (or better, the actual socket IP via a proxy-aware Hono middleware like `@hono/cf-pages` or a custom `c.env.IP` adapter). Alternatively, pin the limit to the public share token (30 lookups/min per token is more meaningful than per-IP for a scraping scenario).

---

## S5-014 · Low · Code Quality — Invite deduplication not enforced

**File:** `apps/api/src/routes/invites.ts:80-109`

`POST /workspaces/:workspaceId/invites` creates a new invite row and sends an email on every call, without checking if an active (non-accepted) invite for the same `email + workspaceId` already exists. The rate limit (10/min per workspace+admin) prevents bursts but doesn't prevent repeated emails across windows. With 5 admins each at 10/min, a target user could receive 50 invite emails per minute.

**Fix:** Before INSERT, check `WHERE email = ? AND workspaceId = ? AND acceptedAt IS NULL AND expiresAt > now()`. If found, return the existing invite ID (200) instead of creating a duplicate. This mirrors the share link idempotency pattern.

---

## S5-015 · Low · Missing feature tracking — `POST /internal/ingest-failures` is a log-only stub

**File:** `apps/api/src/routes/internal.ts:221-229`

```typescript
internal.post("/ingest-failures", ..., async (c) => {
  const body = c.req.valid("json");
  console.warn("[ingest-failure]", JSON.stringify(body));
  return c.json({ ok: true }, 202);
});
```

The comment says _"v0 is a structured log; Plan 5 will wire this to a jobs table + admin dashboard."_ Plan 5 (KG Phase 1+2) is now complete and no ingest failure tracking table exists. Dead-letter failures are logged but never visible in any UI or queryable table. In a self-hosted deployment, this means ingest failures silently disappear.

This is a missing feature, not a security issue. Flagged here because it touches the health/reliability axis of the audit.

---

## Good Practices Observed (Iteration 2)

- **`POST /internal/test-seed`** double-gated: internal secret + `NODE_ENV === "production"` refusal. ✓
- **`POST /internal/test-seed-bulk`** production refusal runs BEFORE Zod validator so schema doesn't leak existence. ✓
- **`PATCH /research/runs/:id/finalize`** uses `SELECT ... FOR UPDATE` inside transaction for idempotency. ✓
- **`POST /notes/:noteId/enrichment`** checks workspace scope (`noteRow.workspaceId !== body.workspaceId`). ✓
- **`POST /literature/import`** checks workspace consistency (`proj.workspaceId !== workspaceId`). ✓
- **Share token generation**: `randomBytes(32).toString("base64url")` — 256-bit entropy, URL-safe. ✓
- **Share link idempotency race**: 23505 catch + re-fetch winner handles concurrent token creation safely. ✓
- **Share revoke authorization**: checks current `canWrite` rather than creator bypass — demoted users lose revoke power. ✓
- **`/public/share/:token` response**: omits workspaceId/projectId/createdBy. ✓

---

## Severity Summary (Iteration 2 new findings)

| ID | Severity | Category | Title |
|----|----------|----------|-------|
| S5-009 | **Medium** | Security | `PATCH /internal/notes/:id` overwrites note content without workspace scope check |
| S5-010 | Low | Security | `/internal/stale-alerts`, `/internal/audio-files` — no workspace scope |
| S5-011 | Low | Security | `/internal/code/turns` + `/code/runs/:id/status` — no workspace scope |
| S5-012 | Low | Design | Share token list visible to canRead users (viewers) |
| S5-013 | Low | Security | Public share IP rate limit spoofable via X-Forwarded-For |
| S5-014 | Low | Code Quality | Invite deduplication not enforced (duplicate email sends) |
| S5-015 | Low | Missing Feature | Ingest failure tracking is a log-only stub |

**Critical/High count in Iteration 2: 0**

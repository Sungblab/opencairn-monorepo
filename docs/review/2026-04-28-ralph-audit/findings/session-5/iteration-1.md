# Session 5 — Iteration 1 Findings
**Areas covered:** Area 1 (App mount + middleware chain) · Area 2 (Permission helpers: canRead/canWrite/requireWorkspaceRole)
**Files read:** `app.ts`, `index.ts`, `public.ts`, `middleware/auth.ts`, `middleware/require-role.ts`, `middleware/error.ts`, `lib/auth.ts`, `lib/rate-limit.ts`, `lib/permissions.ts`, `lib/types.ts`, `lib/internal-assert.ts`, `lib/share-token.ts`, `lib/pin-permissions.ts`, `routes/notes.ts`, `routes/workspaces.ts`, `routes/projects.ts`, `routes/internal.ts` (first pass), `routes/note-assets.ts`, `routes/invites.ts`, `routes/share.ts`

---

## S5-001 · High · Security — Private note title/existence disclosure via workspace list endpoints

**Files:** `apps/api/src/routes/workspaces.ts:361-387` (`/:workspaceId/recent-notes`), `workspaces.ts:322-354` (`/:workspaceId/notes/search`)

**Description:**
Both endpoints return all non-deleted notes in the workspace (`WHERE notes.workspaceId = ?`) without checking per-note permissions. If a note has `inheritParent = false` and the requesting workspace member holds no `pagePermissions` entry (or a `role = "none"` override), they can still see that note's title and `projectId` in the response.

The comment in `recent-notes` says: _"per-note canRead는 클라이언트에서 라우팅 시점에 다시 확인"_ — but that only governs whether the client opens the note. The API itself already leaks the title. A workspace member with restricted access to a private note can learn its existence and name through these endpoints.

**Affected data:** `notes.title`, `notes.projectId`, `notes.updatedAt`

**Reproduction:**
1. Workspace has Note X with `inheritParent=false`; user B holds no pagePermission entry.
2. User B calls `GET /api/workspaces/{wsId}/recent-notes?limit=50` — Note X appears.
3. `canRead(B, {type:"note", id:X.id})` would return `false`, but the endpoint never calls it.

**Fix:**
Add the same over-fetch + filter pattern used in `GET /notes/by-project/:projectId` (notes.ts:47-54):
- Fetch rows normally
- For rows where `inheritParent === false`, call `canRead` per-note and filter out blocked ones
- Since LIMIT is capped at 50, the N+1 cost is bounded.

---

## S5-002 · Medium · Security — Internal write routes missing `assertResourceWorkspace` guard

**Files:** `apps/api/src/routes/internal.ts` (multiple locations — see full list in iteration-2.md)

Several `/api/internal/*` write routes do not require `workspaceId` in the request body or validate workspace scope. A subset identified in this iteration:
- `POST /concepts/upsert`, `POST /concept-edges`, `POST /concept-notes`, `POST /wiki-logs`
- `PATCH /import-jobs/:id`

**Contrast with secured routes:** `POST /concepts/merge`, `POST /semaphores/acquire`, `POST /semaphores/release`, `POST /projects/:id/graph/expand` — all use `assertResourceWorkspace` / `guardWorkspace`.

**Risk:** A worker bug (misrouted payload, replay from wrong workflow context) could write data across workspace boundaries. Not an external attack vector (INTERNAL_API_SECRET gates the entire prefix) but violates "방어 심도 0" principle documented in `lib/internal-assert.ts`.

See iteration-2.md for the complete 11-route list.

---

## S5-003 · Low · Security — Internal API secret comparison not timing-safe

**File:** `apps/api/src/routes/internal.ts:66-68`

```typescript
if (!expected || secret !== expected) {
  return c.json({ error: "Unauthorized" }, 401);
}
```

A JavaScript `!==` string comparison is not constant-time. Practical risk is extremely low (Docker internal network, high-entropy secret), but the fix is trivial:

```typescript
import { timingSafeEqual } from "node:crypto";
const secretBuf = Buffer.from(secret ?? "");
const expectedBuf = Buffer.from(expected);
if (secretBuf.length !== expectedBuf.length || !timingSafeEqual(secretBuf, expectedBuf)) {
  return c.json({ error: "Unauthorized" }, 401);
}
```

---

## S5-004 · Low · Config — CORS `CORS_ORIGIN` empty-string edge case

**File:** `apps/api/src/app.ts:51`

```typescript
origin: process.env.CORS_ORIGIN?.split(",") ?? ["http://localhost:3000"],
```

If `CORS_ORIGIN=` is set to an empty string, `"".split(",")` produces `[""]`. The Hono cors middleware will try to match incoming origins against `""` and fail, breaking all cross-origin requests silently.

`lib/auth.ts:12` already applies `.filter(Boolean)` to the same env var ✓ — `app.ts:51` does not.

**Fix:**
```typescript
origin: process.env.CORS_ORIGIN?.split(",").filter(Boolean) ?? ["http://localhost:3000"],
```

---

## S5-005 · Medium · Performance — N+1 permission queries in `/workspaces/:id/projects`

**File:** `apps/api/src/routes/projects.ts:43-47`

```typescript
const checks = await Promise.all(
  rows.map(async (p) => ({ p, ok: await canRead(user.id, { type: "project", id: p.id }) }))
);
```

For non-owner/admin users, each `canRead` call is 2-4 DB roundtrips. With N projects:
- N=50 → 100-200 queries
- N=100+ → 200-400 queries (no pagination limit on the project list query)

**Fix options:**
1. Add pagination (`limit` + `cursor`) before the permission fan-out.
2. Batch permission resolution via a single JOIN across `project_permissions`, `workspace_members`, `projects`.
3. Short-term: add `LIMIT 200` safety cap.

---

## S5-006 · Low · Code Quality — `requireWorkspaceRole` middleware `id` param fallback

**File:** `apps/api/src/middleware/require-role.ts:11`

```typescript
const wsId = c.req.param("workspaceId") ?? c.req.param("id") ?? "";
```

The `?? c.req.param("id")` fallback means any route with a generic `:id` param that isn't a workspace ID would silently resolve the wrong resource's workspace membership. Current callers in `workspaces.ts` all use `:workspaceId`, so this is not currently exploited — but it's a future misuse trap.

**Fix:** Remove the `?? c.req.param("id")` fallback.

---

## S5-007 · Low · Code Quality — Missing UUID validation for `targetId` in permissions routes

**File:** `apps/api/src/routes/share.ts:469-470`, `share.ts:543`

```typescript
const targetId = c.req.param("userId");
if (!targetId) return c.json({ error: "Bad Request" }, 400);
```

`isUuid(targetId)` is not checked. A non-UUID string causes Postgres to throw a cast error, which the global handler returns as 500 instead of 400.

**Fix:** Add `if (!isUuid(targetId)) return c.json({ error: "Bad Request" }, 400);` after the null check.

---

## Good Practices Observed

- **App mount order** — correct: `/api/internal` first, public routes before wildcard auth middlewares, share router before invite/comment routers. Comment trail in `app.ts` documents the ordering rationale. ✓
- **Invite race condition** — `INVITE_RACE_LOST` sentinel in a `db.transaction()` prevents double-acceptance. ✓
- **`folderId` stripped from `PATCH /notes/:id`** — Zod-level `.omit({ content, folderId })` prevents cross-project moves. ✓
- **`concepts/merge` workspace scope** — `assertResourceWorkspace` + `assertManyResourceWorkspace` + transaction. ✓
- **Semaphore advisory lock** — `pg_advisory_xact_lock(hashtext(projectId))` prevents TOCTOU double-acquire. ✓
- **Graph expand 3-layer defense** — workspace match + `canRead` + seed concept in project. ✓
- **Error handler** — hides error messages in production, Sentry forwarding for ops visibility. ✓
- **Better Auth rate limiting** — custom rules for `/sign-up/email`, `/sign-in/email`, `/forget-password`, `/send-verification-email`. ✓
- **Soft-deleted notes excluded everywhere** — `isNull(notes.deletedAt)` consistently applied including in permission resolution. ✓
- **`patchNoteSchema.omit({ content, folderId })`** — Zod-level strip, not just ignored in handler. ✓
- **Share token entropy** — 32 bytes base64url = 256 bits, format-validated before DB query. ✓
- **`invites/:token/decline` requires auth** — registered after `.use("*", requireAuth)`. ✓

---

## Severity Summary

| ID | Severity | Category | Title |
|----|----------|----------|-------|
| S5-001 | **High** | Security | Private note title disclosure in workspace list endpoints |
| S5-002 | Medium | Security | Internal write routes missing `assertResourceWorkspace` (partial — full list in iteration-2) |
| S5-005 | Medium | Performance | N+1 permission queries in project list |
| S5-003 | Low | Security | Internal API secret not timing-safe |
| S5-004 | Low | Config | CORS CORS_ORIGIN empty-string edge case |
| S5-006 | Low | Code Quality | `requireWorkspaceRole` `id` param fallback |
| S5-007 | Low | Code Quality | Missing UUID validation for targetId in permissions routes |

**Critical/High count: 1**

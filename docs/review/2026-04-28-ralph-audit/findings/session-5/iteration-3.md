# Session 5 — Iteration 3 Findings
**Areas covered:** Area 5 (Auth/better-auth routes) · Area 6 (Notes/Folders/Projects supporting routes)
**Files read:** `routes/auth.ts`, `routes/folders.ts`, `routes/tags.ts`, `routes/users.ts`, `routes/comments.ts`, `routes/mentions.ts`, `routes/notifications.ts`, `routes/health.ts`

---

## S5-016 · Low · Code Quality — Author-only comment mutations bypass workspace membership check

**File:** `apps/api/src/routes/comments.ts:207`, `:253-258`, `:278-281`

Three endpoints use `authorId === userId` as the sole authorization gate, without verifying workspace membership:

```typescript
// PATCH /comments/:id (line 207)
if (row.authorId !== userId) return c.json({ error: "Forbidden" }, 403);

// DELETE /comments/:id (line 253-258)
const isAuthor = row.authorId === userId;
if (!isAuthor) {
  const writable = await canWrite(userId, { type: "note", id: row.noteId });
  if (!writable) return c.json({ error: "Forbidden" }, 403);
}

// POST /comments/:id/resolve (line 278-281)
const allowed = isAuthor || (await canWrite(userId, { type: "note", id: row.noteId }));
```

`canWrite` routes through `resolveRole` which checks workspace membership — but the `isAuthor` short-circuit bypasses it. A user removed from the workspace can still:
- Edit the body of their own comments (`PATCH`)
- Delete their own comments (`DELETE`)
- Toggle resolve-state on their own comments (`POST /resolve`)

…if they know the comment UUID and retain a valid session.

**Risk:** Low — comment UUIDs are 128-bit random values, not guessable without prior read access. No data leakage occurs (only mutations). Practical attack window is narrow: the removed user must already possess the UUID and must act before session expiry.

**Fix:**
Add a workspace membership check alongside the author check. Use the comment's `workspaceId` (already stored on the row as a denormalized column) to call `resolveRole`, or add a lightweight guard:

```typescript
const memberCheck = await resolveRole(userId, { type: "workspace", id: row.workspaceId });
if (memberCheck === "none") return c.json({ error: "Forbidden" }, 403);
```

Apply before the `isAuthor` gate in all three endpoints.

---

## Good Practices Observed (Iteration 3)

- **`GET /mentions/search`** — workspace role gated via `resolveRole` before any query. ✓
- **Mention search PII** — explicit `DO NOT select user.email` comment + column omission; label falls back to user ID, never to email. ✓
- **Page mention search** — over-fetch (2× limit) + sequential `canRead` per row to respect `inheritParent=false`. Same pattern as `GET /by-project/:projectId` in notes. ✓
- **Concept mention search** — per-row `canRead` on project, not just workspace scope. ✓
- **`GET /notifications`** — strictly scoped to `notifications.userId = me.id`; no IDOR possible. ✓
- **`PATCH /notifications/:id/read`** — WHERE clause enforces `AND userId = me.id`; a user cannot mark another user's notification as read. ✓
- **Notification cursor** — composite `(createdAt, id)` key avoids pagination gaps under concurrent fan-outs; base64url encoding; UUID validation in `decodeCursor`. ✓
- **`readAt` idempotency** — `COALESCE(readAt, NOW())` preserves first-read timestamp; second call returns 200, not 404. ✓
- **Comment transaction** — insert + mention rows are atomic; notification fan-out fires after commit (no phantom alerts on rollback). ✓
- **`DELETE /comments/:id`** — author OR `canWrite` (workspace editor/admin can moderate). ✓
- **Health endpoint** — no auth, no data, no risk; timestamp only. ✓

---

## Severity Summary (Iteration 3 new findings)

| ID | Severity | Category | Title |
|----|----------|----------|-------|
| S5-016 | Low | Code Quality | Author-only comment mutations bypass workspace membership check |

**Critical/High count in Iteration 3: 0**

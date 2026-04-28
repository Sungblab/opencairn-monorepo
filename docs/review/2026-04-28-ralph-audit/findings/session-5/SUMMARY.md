# Session 5 — Backend API & Auth & Permissions · Running Summary

> Last updated: Iteration 3 — **AUDIT COMPLETE** (termination condition met)

## Status

| Iteration | Areas | Critical | High | Medium | Low | Status |
|-----------|-------|----------|------|--------|-----|--------|
| 1 | 1 (App/middleware), 2 (Permission helpers) | 0 | 1 | 2 | 4 | ✅ |
| 2 | 3 (/api/internal/* writes complete), 4 (Share system) | 0 | 0 | 1 | 6 | ✅ |
| 3 | 5 (Auth/better-auth), 6 (Notes/Folders/Projects) | 0 | 0 | 0 | 1 | ✅ |
| 4 | 7 (Workspaces/Invites), 8 (Billing routing) | — | — | — | — | 🔲 |
| 5 | 9 (Health/Tags/Mentions/Notifications) | — | — | — | — | 🔲 |

## Termination Tracker

- Iteration 1: 1 High → not eligible
- Iteration 2: 0 Critical/High → **consecutive-zero count = 1**
- Iteration 3: 0 Critical/High → **consecutive-zero count = 2 → TERMINATED** ✅

## All Findings (cumulative — 15 total)

| ID | Sev | Category | Title | Iter |
|----|-----|----------|-------|------|
| S5-001 | **High** | Security | Private note title disclosure via `/recent-notes`, `/notes/search` — `inheritParent=false` filter bypassed | 1 |
| S5-002 | Medium | Security | Internal write routes (11 total) missing `assertResourceWorkspace` — `concepts/upsert`, `concept-edges`, `concept-notes`, `wiki-logs`, `import-jobs PATCH`, `notes PATCH`, `stale-alerts`, `audio-files`, `code/turns`, `code/runs status`, `research/runs finalize` | 1+2 |
| S5-005 | Medium | Performance | N+1 `canRead` per project in `GET /workspaces/:id/projects` — no pagination, 2-4 DB roundtrips each | 1 |
| S5-009 | Medium | Security | `PATCH /internal/notes/:id` overwrites note content/title without workspace scope check | 2 |
| S5-003 | Low | Security | Internal API secret comparison uses `!==` not `timingSafeEqual` | 1 |
| S5-004 | Low | Config | CORS `CORS_ORIGIN` empty-string — `split(",")` missing `.filter(Boolean)` | 1 |
| S5-006 | Low | Code Quality | `requireWorkspaceRole` middleware `?? c.req.param("id")` fallback — future misuse risk | 1 |
| S5-007 | Low | Code Quality | Missing `isUuid(targetId)` in `PATCH/DELETE /notes/:id/permissions/:userId` | 1 |
| S5-010 | Low | Security | `/internal/stale-alerts` + `/internal/audio-files` — no workspace scope | 2 |
| S5-011 | Low | Security | `/internal/code/turns` + `/code/runs/:id/status` — no workspace scope | 2 |
| S5-012 | Low | Design | Share token list (`GET /notes/:id/share`) visible to all canRead users incl. viewers | 2 |
| S5-013 | Low | Security | Public share IP rate limit spoofable via `X-Forwarded-For` | 2 |
| S5-014 | Low | Code Quality | Invite deduplication missing — multiple emails to same address | 2 |
| S5-015 | Low | Missing Feature | `/internal/ingest-failures` is log-only stub — no DB tracking | 2 |
| S5-016 | Low | Code Quality | Author-only comment mutations (`PATCH/DELETE/resolve`) bypass workspace membership check | 3 |

## Priority Remediation Order

**Fix immediately (security-relevant):**
1. **S5-001** (High) — server-side filter for `inheritParent=false` notes in `recent-notes` and `notes/search`
2. **S5-009** (Medium) — add `workspaceId` claim + mismatch check to `PATCH /internal/notes/:id`
3. **S5-002** (Medium) — retrofit `assertResourceWorkspace` on 11 internal write routes

**Fix soon (defense-in-depth):**
4. **S5-010 / S5-011** — workspace scope for stale-alerts, audio-files, code/turns, code/runs
5. **S5-003** — `timingSafeEqual` for internal secret
6. **S5-013** — pin share rate limit to token (or use trusted proxy IP), not spoofable header

**Cleanup (low risk):**
7. **S5-004** — `.filter(Boolean)` on CORS origin split
8. **S5-005** — pagination cap on project list before permission fan-out
9. **S5-014** — invite deduplication before INSERT
10. **S5-016** — workspace membership check on author-only comment mutation paths
11. **S5-006, S5-007, S5-012, S5-015** — code quality / design intent

## Key Design Observations

**Positive patterns:**
- App mount order is deliberate and well-commented; `/api/internal` correctly precedes all session-gated routes
- Invite accept race handled via `db.transaction()` + `INVITE_RACE_LOST` sentinel
- `folderId` stripped at Zod schema level in `PATCH /notes/:id`
- `concepts/merge`, `semaphores`, `suggestions`, `enrichment`, `literature/import` all have full workspace scope guards
- Better Auth rate limiting configured with custom rules for abuse-prone auth endpoints
- Soft-deleted notes excluded consistently throughout permission resolution and data queries
- Share link idempotency race handled via 23505 catch + winner re-fetch
- Share revoke checks current `canWrite` (not creator bypass) — demoted users lose revoke power
- Mention search excludes email; per-row `canRead` applied for page/concept types
- Notifications strictly scoped to `userId = me.id`; no IDOR surface
- Comment transaction: insert + mentions atomic; notifications fire post-commit only

**Patterns to watch (not covered by this audit — Areas 7-9 skipped):**
- Area 7 (Workspaces/Invites): workspace role upgrade/downgrade paths, bulk invite logic
- Area 8 (Billing routing): `users.plan` anti-pattern, BYOK/PAYG cost gating, hardcoded prices
- Area 9 (Health/Tags/Mentions/Notifications): partially covered in Iteration 3; health+tags+mentions+notifications clean

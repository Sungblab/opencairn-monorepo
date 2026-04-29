# Email Notification Dispatcher — Design Spec

**Status:** Draft (2026-04-29).
**Owner:** Sungbin
**Author:** Sungbin + Claude (Opus 4.7).
**Plan reference:** `docs/superpowers/plans/2026-04-09-plan-2-editor.md` § Task 14 (lifted out into its own plan).
**Related:**

- `docs/architecture/collaboration-model.md` — notification kinds + drawer flow
- `apps/api/src/lib/notification-events.ts` — in-process bus + `persistAndPublish`
- `apps/api/src/lib/email.ts` — Resend / SMTP / console transport selector
- `packages/emails/` — react-email v6 templates + `Layout`/`Button` primitives

## 1. Goal

Add an email channel for the five existing notification kinds (`mention`, `comment_reply`, `share_invite`, `research_complete`, `system`) without touching the in-app drawer/SSE flow. Per-user, per-kind preferences gate delivery and pick a frequency (instant / 15-min digest / daily digest). The dispatcher is single-process inside `apps/api`, protected by a Postgres advisory lock so a future scale-out doesn't double-send.

## 2. Non-Goals

- Marketing or product-update emails — this dispatcher only fans out platform notifications.
- One-click unsubscribe tokens / List-Unsubscribe header — added later when we have a public `/u/:token` surface.
- Workspace- or project-scoped overrides — preferences are per-user only. Users in shared workspaces receive based on their own setting.
- Custom email content per workspace — single OpenCairn-branded template tree.
- Retry queue. Resend's own retry covers transient delivery failures; we record `email_attempts` + `last_email_error` and stop after 3 attempts.
- Auto-detecting recipient locale from request headers. We persist `users.locale` (Phase 5 follow-up (d)) on settings save and use that. Fallback `ko`.

## 3. Current Baseline

- `notifications` table (migration 0024): `(id, user_id, kind, payload, created_at, seen_at, read_at)`.
- Kinds enum `notification_kind`: `mention | comment_reply | research_complete | share_invite | system`.
- `persistAndPublish({ userId, kind, payload })` inserts the row and fires the in-process SSE bus. Five callsites: `comments.ts` (×2 — mention, reply), `share.ts`, `internal.ts` (×2 — research finalize, system import_done).
- `apps/api/src/lib/email.ts` exposes `sendEmail({ to, subject, react, replyTo? })` with Resend / SMTP / console / unconfigured branches; `EMAIL_FROM`, `WEB_BASE_URL`, locale default `ko`.
- `packages/emails/` ships `Layout`, `Button`, `InviteEmail`, `VerificationEmail`, `ResetPasswordEmail`. Vitest snapshot pattern in `packages/emails/tests/`.

The gap is everything between "row inserted" and "bytes sent": preferences, dispatcher loop, per-kind templates, digest grouping, settings UI.

## 4. Architecture

```
persistAndPublish ──► notifications row (existing)
                           │
                           ▼
              dispatcher cron (apps/api, 60s)
                           │
                ┌──────────┴──────────┐
                ▼                     ▼
       advisory lock acquired   skip (lock busy)
                │
                ▼
        SELECT pending notifications JOIN preferences
                │
       ┌────────┴─────────┬─────────────┬────────────────┐
       ▼                  ▼             ▼                ▼
   instant: send    15m digest:     daily digest:    email_enabled=false:
   per-kind tpl     group by user   group by user    set emailed_at, no send
       │                 │               │
       └─────────────────┴───────────────┘
                         ▼
        sendEmail() via packages/emails templates
                         ▼
        UPDATE emailed_at = now(), email_attempts++
                         (or last_email_error on failure)
```

### 4.1 Single-process choice

The dispatcher runs inside `apps/api` as a `setInterval` started at module load, **only** when `EMAIL_DISPATCHER_ENABLED=true`. Postgres `pg_try_advisory_lock(<fixed bigint>)` per tick guarantees mutual exclusion across replicas should the API ever scale horizontally. Worker (Temporal) was rejected because:

1. Every notification source is already in `apps/api`; pushing to Temporal adds a queue hop without serving any current need.
2. `apps/api/src/lib/email.ts` is the only place Resend is configured, and `apps/worker` does not currently link to `packages/emails`.
3. Single-process also matches the existing `notification-events.ts` in-process bus convention.

### 4.2 Frequency semantics

- **`instant`**: Send within ≤ 90 s of insert (1 tick + 30 s grace window so creates inside a transaction don't get fired before commit).
- **`digest_15min`**: Group all of one user's pending rows of one kind into one email at the next 15-min wallclock boundary (`:00`, `:15`, `:30`, `:45` UTC). Avoids cross-kind clobbering — one digest email per user per kind per window. Skipped if zero rows.
- **`digest_daily`**: Same grouping rule but at 09:00 in `users.timezone` (default `Asia/Seoul`). One email per user per kind per day.

### 4.3 Defaults

| Kind                | Default `email_enabled` | Default `frequency` |
| ------------------- | ----------------------- | ------------------- |
| `mention`           | true                    | `instant`           |
| `comment_reply`     | true                    | `instant`           |
| `share_invite`      | true                    | `instant`           |
| `research_complete` | true                    | `instant`           |
| `system`            | true                    | `digest_daily`      |

Defaults are **virtual** — no preference row required. Reads return defaults when no row exists; writes upsert. Avoids per-user backfill on existing accounts.

## 5. Data Model

### 5.1 `notifications` ALTER

```sql
ALTER TABLE notifications
  ADD COLUMN emailed_at         timestamptz,
  ADD COLUMN email_attempts     integer NOT NULL DEFAULT 0,
  ADD COLUMN last_email_error   text;

CREATE INDEX notifications_pending_email_idx
  ON notifications (created_at)
  WHERE emailed_at IS NULL AND email_attempts < 3;
```

The partial index keeps the dispatcher's scan cheap regardless of total notification count.

### 5.2 `user_notification_preferences` (new)

```sql
CREATE TYPE notification_frequency AS ENUM (
  'instant',
  'digest_15min',
  'digest_daily'
);

CREATE TABLE user_notification_preferences (
  user_id        text                   NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  kind           notification_kind      NOT NULL,
  email_enabled  boolean                NOT NULL,
  frequency      notification_frequency NOT NULL,
  created_at     timestamptz            NOT NULL DEFAULT now(),
  updated_at     timestamptz            NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, kind)
);
```

Drizzle schema + zod mirror in `packages/shared/src/notifications.ts`.

### 5.3 `users.locale` / `users.timezone` (Phase 5 follow-up (d) lift-in)

Phase 5 left these as TODO. Adding them now because daily-digest scheduling needs `timezone`, and templates need `locale`:

```sql
ALTER TABLE "user"
  ADD COLUMN locale    text NOT NULL DEFAULT 'ko',
  ADD COLUMN timezone  text NOT NULL DEFAULT 'Asia/Seoul';
```

Includes a CHECK constraint on `locale` ∈ `('ko','en')` to match `i18n.ts` locales.

## 6. Components

### 6.1 `apps/api/src/lib/email-dispatcher.ts`

Single module, three exports:

- `startEmailDispatcher()` — called once from `apps/api/src/app.ts` after route registration. No-op when env-disabled or `NODE_ENV==='test'`.
- `stopEmailDispatcher()` — for SIGTERM and tests.
- `runDispatcherTick()` — exported for tests + on-demand admin endpoint. Acquires `pg_try_advisory_lock(0xE_MA_IL_DI)` (`9223372036854775003n`), runs one pass, releases. Returns `{ instantSent, digestSent, skipped, errors }`.

Internals:

- `loadPending()` — JOINs notifications with effective preferences (using `COALESCE` to apply defaults when row missing), filters `emailed_at IS NULL AND email_attempts < 3 AND created_at < now() - interval '30 seconds'`, returns rows + bucketed kind-frequency pairs.
- `sendInstant(row, user)` — `sendEmail({ to: user.email, ... })` with the per-kind template + locale; updates `emailed_at` on success, `email_attempts++ + last_email_error` on failure.
- `sendDigest(rows, user, kind)` — picks `DigestEmail` template, items list. Same update pattern but UPDATE multiple rows in one statement.
- `dueForFrequency(freq, now, user)` — returns `true` for `instant`. For `digest_15min`, true at the wallclock boundary tick (1-min granularity → match `:00 :15 :30 :45`). For `digest_daily`, true at `09:00` in user's timezone.

### 6.2 `packages/emails/src/templates/notifications/`

Files:

- `mention.tsx`        — "@사용자가 [노트]에서 회원님을 멘션했어요"
- `comment-reply.tsx`  — "[노트]의 코멘트에 답글이 달렸어요"
- `share-invite.tsx`   — "[워크스페이스]에 초대받았어요"
- `research-complete.tsx` — "딥리서치 [주제]가 완료됐어요"
- `system.tsx`         — generic, uses `payload.summary` + optional `linkUrl`
- `digest.tsx`         — accepts `{ items: { summary, linkUrl }[], kindLabel, locale }`

All extend `Layout`. CTA buttons link to `${WEB_BASE_URL}/${locale}/app/...` deep links derived from payload (`noteId` → `/n/:noteId`, `runId` → `/research/:runId`, `inviteToken` → `/invite/:token`). `system` falls back to `linkUrl` from payload, then `${WEB_BASE_URL}` root.

i18n strings live in template props (passed by dispatcher) — not next-intl, since react-email runs server-side at send time. Dispatcher loads strings from a small POJO map keyed by `(locale, kind)`.

### 6.3 `apps/api/src/routes/notification-preferences.ts`

```
GET  /api/notification-preferences                 → { kind, emailEnabled, frequency }[] (5 rows, defaults filled in)
PUT  /api/notification-preferences/:kind           body { emailEnabled, frequency } → upsert
GET  /api/notification-preferences/profile         → { locale, timezone }
PUT  /api/notification-preferences/profile         body { locale?, timezone? }
```

`requireAuth`. Zod schemas in `packages/shared/src/notifications.ts`.

### 6.4 `apps/web/src/app/[locale]/settings/notifications/page.tsx`

Inside the existing account settings shell (Phase 5). 5 rows × 2 columns:

| Kind                | Email | Frequency dropdown            |
| ------------------- | ----- | ----------------------------- |
| Mention             | ☑    | Instant / 15-min / Daily     |
| Reply               | ☑    | Instant / 15-min / Daily     |
| Share invite        | ☑    | Instant / 15-min / Daily     |
| Research complete   | ☑    | Instant / 15-min / Daily     |
| System              | ☑    | Instant / 15-min / Daily     |

Below: locale + timezone selects (locale=ko/en, timezone uses `Intl.supportedValuesOf('timeZone')` filtered to a curated set: Asia/Seoul, Asia/Tokyo, UTC, America/Los_Angeles, America/New_York, Europe/London, Europe/Paris).

Save uses `useMutation` with optimistic update + sonner toast.

### 6.5 i18n

New namespace `account-notifications.json` (ko + en parity):

- `title`, `description`
- `kinds.{mention,comment_reply,share_invite,research_complete,system}.label`
- `kinds.{...}.description`
- `frequencies.{instant,digest_15min,digest_daily}`
- `profile.{locale,timezone,save,saved,error}`

Email body strings live in `packages/emails/src/locale/{ko,en}.ts` (small POJO maps), not in next-intl namespaces, because react-email renders outside the app router.

## 7. Flow

### 7.1 Insert path (unchanged)

`comments.ts` posts comment → `persistAndPublish({ userId: target, kind: 'mention', payload })` → row inserted, SSE fires immediately to the drawer. Dispatcher does **not** intercept here.

### 7.2 Tick path

```
every 60s when EMAIL_DISPATCHER_ENABLED:
  pg_try_advisory_lock(LOCK_KEY) ?
    select rows where emailed_at IS NULL and email_attempts < 3 and created_at < now() - 30s
    join effective preferences (default-fill missing)
    join users (email + locale + timezone)
    for each (user, kind, frequency) bucket:
      if instant: for each row → send + UPDATE row
      else if dueForFrequency(freq, now, user): send digest + UPDATE rows
      else: skip (will retry next tick)
    pg_advisory_unlock(LOCK_KEY)
  else: skip
```

### 7.3 Failure handling

- Resend throws or returns error → catch, log structured event, increment `email_attempts`, set `last_email_error = err.message.slice(0, 500)`. Row stays unsent.
- 3rd failure → row excluded from next selection (partial index), terminal. Visible to admins via direct DB query; no automated alerting in this plan.
- `email_enabled=false` → mark `emailed_at = now()` + `last_email_error = 'disabled'` so the row drops out of the scan immediately. Cheaper than re-evaluating preferences every tick.

## 8. Security & Privacy

- Email body uses plain-text summary from `payload.summary` (already sanitized at insert time — see `notification-events.ts` payload contracts). Templates do not interpolate raw HTML.
- Deep-link URLs always go through `WEB_BASE_URL` env, never user-supplied. Token validation happens at the destination route as today.
- `payload` may contain user IDs of mention sources etc. — these are exposed only inside the recipient's own email (workspace-scoped); no cross-workspace leak path.
- SMTP/Resend transport already redacts in logs (existing `email.ts` behavior).

## 9. Observability

Structured log lines (existing project convention, no new metrics infra):

- `email_dispatcher.tick { instantSent, digestSent, skipped, errors, lockAcquired, durationMs }`
- `email_dispatcher.send { userId, kind, frequency, ok, errorClass? }`
- `email_dispatcher.locked` when `pg_try_advisory_lock` returns false (one log per tick at most).

## 10. Testing

- **Vitest unit** (`apps/api/tests/email-dispatcher/`):
  - `tick.test.ts` — fixed clock + seeded notifications + preferences. Asserts instant rows sent, digest rows held until boundary, disabled rows finalized without send, failed sends increment counter.
  - `frequency.test.ts` — `dueForFrequency` table-driven across DST transitions, custom timezones, leap seconds skipped.
  - `lock.test.ts` — two parallel `runDispatcherTick()` calls — exactly one acquires.
- **Vitest routes** (`apps/api/tests/notification-preferences.test.ts`): GET returns defaults when no row, PUT upserts, profile PATCH validates locale enum.
- **Email rendering** (`packages/emails/tests/notifications.test.tsx`): snapshot per template per locale (5 × 2 = 10 + digest × 2 = 12 snapshots).
- **Web** (`apps/web/src/app/.../settings/notifications/__tests__/`): page renders defaults, toggle persists, frequency change calls API.
- **i18n parity**: `pnpm --filter @opencairn/web i18n:parity` covers `account-notifications.json`.

E2E deferred — tracked as follow-up; needs full SMTP/Resend stack which CI doesn't run.

## 11. Rollout

1. Migration deploys (non-blocking — only adds columns/table/enum).
2. Code deploys with `EMAIL_DISPATCHER_ENABLED=false`. Dispatcher is dormant.
3. Verify in staging: flip env, watch logs, send a test mention to self, confirm email arrives in <90 s.
4. Production flip — manual env update.

`EMAIL_DISPATCHER_ENABLED` defaults to `false` in `.env.example` so self-hosters with no SMTP/Resend don't get errors.

## 12. Out-of-Plan Follow-ups

- Unsubscribe token surface (one-click `/u/:token` + List-Unsubscribe header). Email body adds the link as a "이메일 알림 끄기" footer when ready.
- Workspace-level digest scheduling (e.g., team morning summary).
- Push (web push / mobile) — same dispatcher pattern, different transport.
- Auto-detect recipient locale from `Accept-Language` of last login.
- Move dispatcher to Temporal Schedule if/when API horizontal scale becomes real.

## 13. Open Questions (resolved)

| Q                                                             | Resolution                                                                                                |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Cron in API or worker?                                        | API + advisory lock (§ 4.1).                                                                              |
| Defaults for new users — opt-in or opt-out?                   | Opt-in for everything (`email_enabled=true` default), `system` defaults to daily digest to limit noise.   |
| Digest grouping — per kind or one mixed digest per user?      | Per kind. Avoids the "drowning in one daily email" trap and keeps subjects scannable.                     |
| Where do email body strings live — next-intl or POJO?         | POJO in `packages/emails/src/locale/`. react-email renders outside the next-intl provider tree.           |
| Locale source of truth?                                       | New `users.locale` column (lift Phase 5 follow-up (d) into this plan).                                    |
| Retry policy?                                                 | 3 attempts via partial-index filter + `last_email_error`. No retry queue.                                 |
| Single dispatcher process — what if API scales horizontally? | `pg_try_advisory_lock` per tick. Future Temporal migration documented in § 12.                            |

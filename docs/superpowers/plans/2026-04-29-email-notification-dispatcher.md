# Email Notification Dispatcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver email for the 5 existing in-app notification kinds (mention / comment_reply / share_invite / research_complete / system) with per-user, per-kind preferences and three frequency modes (instant / digest_15min / digest_daily). Dispatcher runs inside `apps/api` as a 60 s `setInterval` guarded by `pg_try_advisory_lock`.

**Architecture:** New `user_notification_preferences` table + `notifications.{emailed_at,email_attempts,last_email_error}` columns + `users.{locale,timezone}` columns. New `apps/api/src/lib/email-dispatcher.ts` selects pending rows, joins effective prefs, sends via existing `apps/api/src/lib/email.ts` using new `packages/emails` templates per kind plus a digest template. Email body strings live in a `packages/emails/src/locale/{ko,en}.ts` POJO because react-email renders outside the next-intl provider tree. New `/api/notification-preferences` routes + `/[locale]/settings/notifications` page back the matrix UI.

**Spec:** `docs/superpowers/specs/2026-04-29-email-notification-dispatcher-design.md`.

**Tech Stack:** Drizzle ORM (Postgres), Hono 4 + Zod (apps/api), react-email v6 (packages/emails), Resend / SMTP / console transport (apps/api/src/lib/email.ts), Next.js 16 + next-intl (apps/web), Vitest, Tailwind 4 + shadcn/ui.

**Dependencies (already on `main`):** Plan 1 (Better Auth `user` table, `email.ts` transport, `packages/emails` v6 setup), App Shell Phase 5 (notifications drawer + `/[locale]/settings/[[...slug]]` shell + `notification-events.ts` `persistAndPublish`), Plan 2C (`share_invite` + `comment_reply` wiring), Plan 4 (`research_complete` finalize wiring).

**Feature flag:** `EMAIL_DISPATCHER_ENABLED` (server env, default `false`). `NEXT_PUBLIC_*` flag is **not** introduced — settings UI ships always-on; dispatch is what's gated.

---

## File Structure

Create:

- `packages/shared/src/notifications.ts` — `NotificationFrequencySchema`, `NotificationPreferenceSchema`, `NotificationPreferencesProfileSchema`, types.
- `packages/shared/tests/notifications.test.ts` — schema contract tests.
- `packages/db/src/schema/notification-preferences.ts` — `user_notification_preferences` table + `notification_frequency` pgEnum.
- `packages/db/tests/notification-preferences.test.ts` — table shape + enum tests.
- `packages/emails/src/locale/index.ts` — POJO `{ ko, en }` with kind labels, frequency labels, button copy.
- `packages/emails/src/templates/notifications/MentionEmail.tsx`
- `packages/emails/src/templates/notifications/CommentReplyEmail.tsx`
- `packages/emails/src/templates/notifications/ShareInviteEmail.tsx`
- `packages/emails/src/templates/notifications/ResearchCompleteEmail.tsx`
- `packages/emails/src/templates/notifications/SystemEmail.tsx`
- `packages/emails/src/templates/notifications/DigestEmail.tsx`
- `packages/emails/tests/notification-templates.test.tsx` — render snapshot per template per locale.
- `apps/api/src/lib/email-dispatcher.ts` — `startEmailDispatcher`, `stopEmailDispatcher`, `runDispatcherTick`, internal helpers.
- `apps/api/src/lib/notification-preferences.ts` — `getEffectivePreferences`, `upsertPreference`, defaults.
- `apps/api/src/routes/notification-preferences.ts` — `GET/PUT /api/notification-preferences`, profile sub-routes.
- `apps/api/tests/notification-preferences.test.ts` — route tests.
- `apps/api/tests/email-dispatcher/tick.test.ts` — instant + digest + disabled + failure cases.
- `apps/api/tests/email-dispatcher/frequency.test.ts` — `dueForFrequency` table-driven.
- `apps/api/tests/email-dispatcher/lock.test.ts` — concurrent `runDispatcherTick` mutex.
- `apps/web/src/app/[locale]/settings/notifications/page.tsx`
- `apps/web/src/app/[locale]/settings/notifications/notifications-form.tsx` — client component.
- `apps/web/src/app/[locale]/settings/notifications/__tests__/notifications-form.test.tsx`
- `apps/web/messages/ko/account-notifications.json`
- `apps/web/messages/en/account-notifications.json`

Modify:

- `packages/shared/src/index.ts` — export `notifications.ts`.
- `packages/db/src/schema/enums.ts` — add `notificationFrequencyEnum`.
- `packages/db/src/schema/notifications.ts` — add `emailed_at`, `email_attempts`, `last_email_error` + `notifications_pending_email_idx`.
- `packages/db/src/schema/users.ts` — add `locale`, `timezone` columns.
- `packages/db/src/index.ts` — export new schema.
- `apps/api/src/app.ts` — mount `/api/notification-preferences`, call `startEmailDispatcher()` after route registration.
- `apps/api/src/lib/email.ts` — extend if needed (probably none — pass through).
- `apps/web/src/i18n.ts` — register `account-notifications` namespace.
- `apps/web/src/app/[locale]/settings/[[...slug]]/page.tsx` — add `notifications` slug branch (Phase 5 settings shell pattern).
- `apps/web/src/app/[locale]/settings/[[...slug]]/settings-nav.tsx` (or equivalent) — add link.
- `.env.example` — document `EMAIL_DISPATCHER_ENABLED`.
- `docs/architecture/api-contract.md` — `/api/notification-preferences` table.
- `docs/contributing/plans-status.md` — new row under Phase 1 follow-ups.

Generate during implementation:

- `packages/db/drizzle/0039_email_dispatcher.sql` (drizzle-kit)
- `packages/db/drizzle/meta/0039_snapshot.json` (drizzle-kit)
- `packages/db/drizzle/meta/_journal.json` (drizzle-kit)

Do not modify in this plan:

- `apps/api/src/lib/notification-events.ts` payload contracts.
- `apps/worker` (no Temporal work; dispatcher is in api).
- Existing `persistAndPublish` callsites in `comments.ts` / `share.ts` / `internal.ts`.
- `apps/web` notifications drawer (`NotificationItem`, etc.).

---

## Task 1: Shared Schemas

**Files:**

- Create: `packages/shared/src/notifications.ts`
- Create: `packages/shared/tests/notifications.test.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Write the failing shared schema tests**

Create `packages/shared/tests/notifications.test.ts` with cases:

- `NotificationFrequencySchema.options` equals `["instant","digest_15min","digest_daily"]`.
- `NotificationKindSchema` re-exports the 5 existing kinds (already shared elsewhere — re-import, do not duplicate).
- `NotificationPreferenceSchema.parse({ kind: "mention", emailEnabled: true, frequency: "instant" })` succeeds.
- `NotificationPreferencesProfileSchema.parse({ locale: "ko", timezone: "Asia/Seoul" })` succeeds; rejects locale `"fr"`; allows missing fields (PATCH semantics).
- `DEFAULT_PREFERENCES` map has all 5 kinds and `system.frequency === "digest_daily"`.

- [ ] **Step 2: Run shared tests and confirm they fail**

```bash
pnpm --filter @opencairn/shared test -- notifications
```

- [ ] **Step 3: Implement schemas**

Create `packages/shared/src/notifications.ts`. Re-import `NotificationKindSchema` if it already exists in `packages/shared`; otherwise mirror the 5-kind union from `packages/db` enum. Export `DEFAULT_PREFERENCES: Record<NotificationKind, { emailEnabled: boolean; frequency: NotificationFrequency }>`.

- [ ] **Step 4: Wire export**

In `packages/shared/src/index.ts` add `export * from "./notifications";`.

- [ ] **Step 5: Tests pass**

```bash
pnpm --filter @opencairn/shared test -- notifications
```

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(shared): notification preference schemas + defaults"
```

---

## Task 2: DB Schema + Migration

**Files:**

- Create: `packages/db/src/schema/notification-preferences.ts`
- Create: `packages/db/tests/notification-preferences.test.ts`
- Modify: `packages/db/src/schema/enums.ts`
- Modify: `packages/db/src/schema/notifications.ts`
- Modify: `packages/db/src/schema/users.ts`
- Modify: `packages/db/src/index.ts`
- Generate: `packages/db/drizzle/0039_email_dispatcher.sql` + meta

- [ ] **Step 1: Write failing schema tests**

Create `packages/db/tests/notification-preferences.test.ts`:

- Asserts `notificationFrequencyEnum` values.
- Asserts `userNotificationPreferences` columns + composite PK.
- Asserts new `notifications` columns exist with correct types/defaults.
- Asserts `users.locale` defaults to `'ko'`, `users.timezone` defaults to `'Asia/Seoul'`.

- [ ] **Step 2: Run db tests and confirm failure**

```bash
pnpm --filter @opencairn/db test -- notification-preferences
```

- [ ] **Step 3: Add `notificationFrequencyEnum`**

`packages/db/src/schema/enums.ts` — append after `notificationKindEnum`:

```ts
export const notificationFrequencyEnum = pgEnum("notification_frequency", [
  "instant",
  "digest_15min",
  "digest_daily",
]);
```

- [ ] **Step 4: Extend `notifications` table**

`packages/db/src/schema/notifications.ts` — add columns + partial index:

```ts
emailedAt: timestamp("emailed_at", { withTimezone: true }),
emailAttempts: integer("email_attempts").notNull().default(0),
lastEmailError: text("last_email_error"),
```

Add to the table builder array:

```ts
index("notifications_pending_email_idx")
  .on(t.createdAt)
  .where(sql`${t.emailedAt} IS NULL AND ${t.emailAttempts} < 3`),
```

- [ ] **Step 5: Extend `users` table**

`packages/db/src/schema/users.ts` — add `locale text NOT NULL DEFAULT 'ko'` (with check `IN ('ko','en')`) and `timezone text NOT NULL DEFAULT 'Asia/Seoul'`.

- [ ] **Step 6: Create `user_notification_preferences` table**

`packages/db/src/schema/notification-preferences.ts`:

```ts
export const userNotificationPreferences = pgTable(
  "user_notification_preferences",
  {
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    kind: notificationKindEnum("kind").notNull(),
    emailEnabled: boolean("email_enabled").notNull(),
    frequency: notificationFrequencyEnum("frequency").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.kind] })],
);
```

- [ ] **Step 7: Export + index**

`packages/db/src/index.ts` — add export.

- [ ] **Step 8: Generate migration**

```bash
pnpm --filter @opencairn/db db:generate
```

Verify `packages/db/drizzle/0039_email_dispatcher.sql` matches § 5 of the spec (no extra ALTERs to unrelated tables; if drizzle pulls in noise, fix the offending source file rather than hand-edit the SQL).

- [ ] **Step 9: Tests pass**

```bash
pnpm --filter @opencairn/db test
```

- [ ] **Step 10: Commit**

```bash
git commit -m "feat(db): email-dispatcher migration 0039 — preferences + emailed_at + user locale"
```

---

## Task 3: Email Locale POJO + Per-kind Templates

**Files:**

- Create: `packages/emails/src/locale/index.ts`
- Create: `packages/emails/src/templates/notifications/MentionEmail.tsx`
- Create: `packages/emails/src/templates/notifications/CommentReplyEmail.tsx`
- Create: `packages/emails/src/templates/notifications/ShareInviteEmail.tsx`
- Create: `packages/emails/src/templates/notifications/ResearchCompleteEmail.tsx`
- Create: `packages/emails/src/templates/notifications/SystemEmail.tsx`
- Modify: `packages/emails/src/index.ts` — re-export the 5 templates + the locale map.

- [ ] **Step 1: Write failing render tests**

Create `packages/emails/tests/notification-templates.test.tsx`:

- For each of the 5 kinds × 2 locales: `render(<Template ...stubProps />)` succeeds, contains kind-specific phrase from POJO, contains CTA href starting with `https://example.com/${locale}/`.
- `Layout` is wrapped (look for footer marker).

- [ ] **Step 2: Confirm failure**

```bash
pnpm --filter @opencairn/emails test -- notification-templates
```

- [ ] **Step 3: Implement locale POJO**

`packages/emails/src/locale/index.ts`:

```ts
export type EmailLocale = "ko" | "en";

export const EMAIL_COPY: Record<EmailLocale, {
  brand: string;
  kindLabels: Record<NotificationKind, string>;
  ctaOpen: string;       // "열어보기" / "Open"
  ctaUnsubscribeFooter: string;  // empty for now; placeholder for follow-up
  digestIntro: (count: number) => string;
  // ... per-kind subject builders
}> = { /* ... */ };
```

Templates accept `locale: EmailLocale` and read this map.

- [ ] **Step 4: Implement 5 per-kind templates**

Each template:

- Wraps `Layout`.
- Uses `Button` with `href = ${webBaseUrl}/${locale}/${deepLinkPath}`.
- Renders one paragraph from `EMAIL_COPY` + the payload-derived primary string (e.g., note title).
- Subject string is exposed via a named export `subject(locale, payload)` so the dispatcher does not duplicate copy.

- [ ] **Step 5: Tests pass**

```bash
pnpm --filter @opencairn/emails test
```

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(emails): 5 per-kind notification templates + locale POJO"
```

---

## Task 4: Digest Email Template

**Files:**

- Create: `packages/emails/src/templates/notifications/DigestEmail.tsx`
- Modify: `packages/emails/src/index.ts`
- Extend: `packages/emails/tests/notification-templates.test.tsx`

- [ ] **Step 1: Add failing digest tests**

Append to `packages/emails/tests/notification-templates.test.tsx`:

- `<DigestEmail locale="ko" kind="mention" items={[...3 items...]} />` renders 3 list rows + count in subject.
- `kindLabel` from `EMAIL_COPY` appears in heading.
- Empty `items` array throws / returns null (caller guarantees non-empty).

- [ ] **Step 2: Confirm failure**

- [ ] **Step 3: Implement `DigestEmail`**

Props: `{ locale, kind, items: { summary, linkUrl, createdAt }[], firstName? }`.

- [ ] **Step 4: Tests pass + commit**

```bash
git commit -m "feat(emails): notification digest template"
```

---

## Task 5: Notification Preferences Helpers

**Files:**

- Create: `apps/api/src/lib/notification-preferences.ts`
- Create: `apps/api/tests/notification-preferences-helpers.test.ts`

- [ ] **Step 1: Failing helper tests**

`apps/api/tests/notification-preferences-helpers.test.ts`:

- `getEffectivePreferences(userId)` returns the 5-row default map when no rows exist.
- After upsert of one row, that row overrides default; others remain default.
- `upsertPreference({ userId, kind, emailEnabled, frequency })` is idempotent and bumps `updated_at`.

- [ ] **Step 2: Confirm failure**

- [ ] **Step 3: Implement helpers**

Use Drizzle. `getEffectivePreferences` does ONE query (`LEFT JOIN unnest(notification_kinds)` or just `SELECT * FROM user_notification_preferences WHERE user_id = $1` + JS merge with `DEFAULT_PREFERENCES`).

- [ ] **Step 4: Tests pass + commit**

```bash
git commit -m "feat(api): notification-preferences helpers"
```

---

## Task 6: Notification Preferences Routes

**Files:**

- Create: `apps/api/src/routes/notification-preferences.ts`
- Create: `apps/api/tests/notification-preferences.test.ts`
- Modify: `apps/api/src/app.ts`

- [ ] **Step 1: Failing route tests**

`apps/api/tests/notification-preferences.test.ts`:

- `GET /api/notification-preferences` returns 5 rows with defaults filled (200).
- `PUT /api/notification-preferences/:kind` body `{ emailEnabled: false, frequency: "instant" }` upserts (200).
- `PUT /api/notification-preferences/:kind` rejects unknown kind (400).
- `GET /api/notification-preferences/profile` returns `{ locale, timezone }`.
- `PUT /api/notification-preferences/profile` body `{ locale: "fr" }` rejects (400).
- All routes 401 without session.

- [ ] **Step 2: Confirm failure**

- [ ] **Step 3: Implement routes**

Hono router with `requireAuth`. Use shared zod schemas. Profile PUT updates `users.locale` / `users.timezone`.

- [ ] **Step 4: Mount in `app.ts`**

After existing routes:

```ts
app.route("/api/notification-preferences", notificationPreferencesRoute);
```

- [ ] **Step 5: Tests pass + commit**

```bash
git commit -m "feat(api): /api/notification-preferences GET/PUT + profile sub-routes"
```

---

## Task 7: Email Dispatcher Core

**Files:**

- Create: `apps/api/src/lib/email-dispatcher.ts`
- Create: `apps/api/tests/email-dispatcher/frequency.test.ts`

- [ ] **Step 1: Failing frequency tests**

`apps/api/tests/email-dispatcher/frequency.test.ts` (table-driven):

- `dueForFrequency("instant", any, anyUser) === true`.
- `dueForFrequency("digest_15min", "2026-04-29T12:00:30Z", user)` true at `:00`/`:15`/`:30`/`:45` ± 30 s grace, else false.
- `dueForFrequency("digest_daily", t, { timezone: "Asia/Seoul" })` true at 09:00 KST window, false otherwise.
- DST transition coverage (America/Los_Angeles spring-forward, fall-back).

- [ ] **Step 2: Implement `dueForFrequency`**

Pure function, no clock dependency (takes `now: Date`). Use `Intl.DateTimeFormat` with `timeZone` option for daily timezone math; never construct local-time strings by hand.

- [ ] **Step 3: Implement dispatcher core**

`apps/api/src/lib/email-dispatcher.ts` exports:

- `LOCK_KEY = 9223372036854775003n` (constant).
- `startEmailDispatcher()` — `if (process.env.NODE_ENV === 'test') return; if (process.env.EMAIL_DISPATCHER_ENABLED !== 'true') { logger.info('email_dispatcher.disabled'); return; }` else `setInterval(runDispatcherTick, 60_000); ref.unref?.()`.
- `stopEmailDispatcher()` — clears the interval.
- `runDispatcherTick({ now = new Date() } = {})` — returns `{ instantSent, digestSent, skipped, errors, lockAcquired }`.

Internal:

- `acquireLock()` — `SELECT pg_try_advisory_lock($1)` returns boolean; on `false` log `email_dispatcher.locked` and return early.
- `selectPending(now)` — single SQL, returns rows enriched with `userEmail`, `userLocale`, `userTimezone`, and the user's effective preference for this kind via JS merge after fetch.
- `processInstant(row)` — picks template, calls `sendEmail`, on success `UPDATE notifications SET emailed_at = now() WHERE id = $1 AND emailed_at IS NULL`, on failure increments + records error.
- `processDigest(rows, kind, user, now)` — calls `DigestEmail`, single `UPDATE WHERE id = ANY($1)`.
- `releaseLock()` — `SELECT pg_advisory_unlock($1)`.

- [ ] **Step 4: Tests pass**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(api): email-dispatcher core + dueForFrequency"
```

---

## Task 8: Dispatcher Tick Tests + Lock Tests

**Files:**

- Create: `apps/api/tests/email-dispatcher/tick.test.ts`
- Create: `apps/api/tests/email-dispatcher/lock.test.ts`

- [ ] **Step 1: Tick tests**

`tick.test.ts` (uses test DB + monkeypatched `sendEmail`):

- Seed: 2 users, 5 notifications across kinds, mix of instant + digest_15min + digest_daily preferences. Some with `email_enabled=false`.
- Run `runDispatcherTick({ now: fixed wallclock at :15 boundary })`. Assert exact counts of sent vs skipped, `emailed_at` populated for all expected rows, disabled rows finalized with `last_email_error='disabled'`.
- Resend stub throws on row #3 → `email_attempts === 1`, `emailed_at IS NULL`, others unaffected.
- Row with `email_attempts = 3` is excluded from selection.

- [ ] **Step 2: Lock tests**

`lock.test.ts`:

- Spawn two `runDispatcherTick()` promises in parallel; assert exactly one returns `lockAcquired: true`, other returns `lockAcquired: false`.

- [ ] **Step 3: Implement what's needed for tests to pass**

Mostly already done in Task 7; this task is the integration verification. If tests reveal bugs, fix in `email-dispatcher.ts`.

- [ ] **Step 4: Commit**

```bash
git commit -m "test(api): email-dispatcher tick + advisory-lock coverage"
```

---

## Task 9: Wire Dispatcher Start

**Files:**

- Modify: `apps/api/src/app.ts`
- Modify: `.env.example`

- [ ] **Step 1: Add `startEmailDispatcher()` call in `app.ts`**

After all `app.route(...)` calls, before export:

```ts
import { startEmailDispatcher } from "./lib/email-dispatcher";
startEmailDispatcher();
```

- [ ] **Step 2: Document env in `.env.example`**

```dotenv
# Email dispatcher — set true to enable the 60s notification email loop.
# Requires EMAIL_PROVIDER=resend|smtp (or inferred from RESEND_API_KEY/SMTP_HOST).
EMAIL_DISPATCHER_ENABLED=false
```

- [ ] **Step 3: Smoke test**

```bash
pnpm --filter @opencairn/api dev
```

In another shell, hit `GET /api/notification-preferences`, then `PUT /api/notification-preferences/mention { emailEnabled: true, frequency: "instant" }`, then in psql `INSERT` a notification row, wait ≤ 90 s, observe console-transport email if `EMAIL_PROVIDER=console` + `EMAIL_DISPATCHER_ENABLED=true`.

- [ ] **Step 4: Commit**

```bash
git commit -m "chore(api): start email dispatcher + document env flag"
```

---

## Task 10: Web Settings Page

**Files:**

- Create: `apps/web/src/app/[locale]/settings/notifications/page.tsx`
- Create: `apps/web/src/app/[locale]/settings/notifications/notifications-form.tsx`
- Create: `apps/web/src/app/[locale]/settings/notifications/__tests__/notifications-form.test.tsx`
- Create: `apps/web/messages/ko/account-notifications.json`
- Create: `apps/web/messages/en/account-notifications.json`
- Modify: `apps/web/src/i18n.ts`
- Modify: `apps/web/src/app/[locale]/settings/[[...slug]]/page.tsx` — recognize `notifications` slug and render the page.
- Modify: settings nav component (locate via Phase 5 settings shell — single source of truth for the side nav).

- [ ] **Step 1: i18n keys**

Author `account-notifications.json` (ko first, then mirror en). 1:1 parity required.

- [ ] **Step 2: Failing form tests**

`notifications-form.test.tsx`:

- Given mocked GET response with 5 default rows, table renders 5 rows with frequency dropdowns set to defaults.
- Toggle off `mention.emailEnabled` → `PUT /api/notification-preferences/mention` called once with `{ emailEnabled: false, frequency: "instant" }`.
- Change `system.frequency` to `instant` → PUT called.
- Profile section: change locale → PUT `/profile`.

- [ ] **Step 3: Implement form**

- Server component fetches initial state.
- Client child handles toggles + sonner toasts.
- Use `useMutation` from `@tanstack/react-query` already in the codebase.

- [ ] **Step 4: Wire route + nav**

Settings shell pattern: add `notifications` slug branch + nav link. Refer to existing `/[locale]/settings/ai` page for the pattern (Deep Research Phase E).

- [ ] **Step 5: i18n parity check**

```bash
pnpm --filter @opencairn/web i18n:parity
```

- [ ] **Step 6: Tests + build pass**

```bash
pnpm --filter @opencairn/web test -- notifications-form
pnpm --filter @opencairn/web typecheck
pnpm --filter @opencairn/web build
```

- [ ] **Step 7: Commit**

```bash
git commit -m "feat(web): /settings/notifications page + i18n"
```

---

## Task 11: Docs + Status Update

**Files:**

- Modify: `docs/architecture/api-contract.md`
- Modify: `docs/contributing/plans-status.md`
- Modify: `CLAUDE.md` — add a one-liner under Plans (Active/next → ✅ Complete).

- [ ] **Step 1: API contract**

Add `/api/notification-preferences` table rows (4 endpoints).

- [ ] **Step 2: Plans status**

Add a new row in Phase 1 follow-ups summarizing the implementation, branch, migration number, test counts.

- [ ] **Step 3: CLAUDE.md plans line**

Move "Plan 2 Task 14 (이메일 dispatcher)" out of the unwritten list and into the Complete bullet.

- [ ] **Step 4: Commit**

```bash
git commit -m "docs(plans): mark email-dispatcher complete + api-contract update"
```

---

## Task 12: opencairn-post-feature

- [ ] Run `pnpm --filter @opencairn/api test`, `pnpm --filter @opencairn/web test`, `pnpm --filter @opencairn/db test`, `pnpm --filter @opencairn/shared test`, `pnpm --filter @opencairn/emails test`.
- [ ] Run `pnpm --filter @opencairn/api typecheck && pnpm --filter @opencairn/web typecheck`.
- [ ] Run `pnpm --filter @opencairn/web i18n:parity`.
- [ ] Manual user-facing verification: dev stack, `/settings/notifications` round-trip, console-transport email visible after seeding a notification with `EMAIL_DISPATCHER_ENABLED=true`.
- [ ] Capture verification command output in commit message of the docs commit.
- [ ] Open PR. Title: `feat: email notification dispatcher (Plan 2 Task 14)`. Body summarizes spec § 1–4 and lists out-of-scope follow-ups (§ 12).

---

## Out-of-Plan Follow-ups (carried forward)

- Unsubscribe token surface (one-click `/u/:token` + List-Unsubscribe header).
- Workspace-level digest scheduling.
- Web push transport.
- Auto-detect recipient locale from `Accept-Language` of last login.
- Move dispatcher to Temporal Schedule when API horizontal scale is real.
- E2E smoke (needs full SMTP/Resend in CI).

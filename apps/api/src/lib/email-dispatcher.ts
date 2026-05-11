import * as React from "react";

import {
  and,
  asc,
  db,
  eq,
  inArray,
  isNull,
  lt,
  sql,
  notifications,
  user,
  userNotificationPreferences,
} from "@opencairn/db";
import type { DB, Tx } from "@opencairn/db";
import {
  CommentReplyEmail,
  DigestEmail,
  EMAIL_COPY,
  MentionEmail,
  ResearchCompleteEmail,
  ShareInviteEmail,
  SystemEmail,
  type DigestItem,
  type EmailLocale,
  type EmailNotificationKind,
} from "@opencairn/emails";
import {
  DEFAULT_PREFERENCES,
  SUPPORTED_LOCALES,
  SUPPORTED_TIMEZONES,
  type NotificationFrequency,
  type NotificationKind,
} from "@opencairn/shared";

import { sendEmail } from "./email";

// Plan 2 Task 14 — outbound email dispatcher.
//
// Architecture: 60-second setInterval inside apps/api, guarded by a
// pg_try_advisory_xact_lock so a future horizontal-scale-out doesn't
// double-send while avoiding session-lock leaks through pooled connections.
// The lock key is a fixed bigint chosen so two locks (this dispatcher + any
// future) can coexist without collision.

const LOCK_KEY = 9223372036854775003n;

const TICK_INTERVAL_MS = 60_000;

// 30s grace window — `persistAndPublish` runs after a transaction commits
// today, but the dispatcher still gives the writer a moment so a notification
// inserted at T=0 doesn't get fired before its triggering row's downstream
// state (e.g., a comment row) is durable. Cheap insurance.
const INSTANT_DELAY_SECONDS = 30;

const MAX_EMAIL_ATTEMPTS = 3;
type DbLike = DB | Tx;

let intervalHandle: NodeJS.Timeout | null = null;
let isTickInProgress = false;

export interface DispatcherTickResult {
  lockAcquired: boolean;
  instantSent: number;
  digestSent: number;
  skipped: number;
  errors: number;
}

interface DispatchUser {
  id: string;
  email: string;
  locale: EmailLocale;
  timezone: string;
}

interface DispatchRow {
  id: string;
  userId: string;
  kind: NotificationKind;
  payload: Record<string, unknown>;
  createdAt: Date;
}

// Pure, exported for direct unit tests.
//
//   instant       — always due as long as the row's grace window has elapsed.
//   digest_15min  — due whenever the wallclock minute is :00, :15, :30, :45.
//   digest_daily  — due once per local day at 09:00 in the user's timezone.
export function dueForFrequency(
  frequency: NotificationFrequency,
  now: Date,
  user: { timezone: string },
): boolean {
  if (frequency === "instant") return true;

  if (frequency === "digest_15min") {
    // UTC minute boundary. The 60s tick interval means we land within
    // ±30s of each :00/:15/:30/:45 — accept any tick whose minute is
    // a multiple of 15.
    const minute = now.getUTCMinutes();
    return minute % 15 === 0;
  }

  // digest_daily — get the user's local hour:minute via Intl.
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: user.timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "-1");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "-1");
  // Window is the single 09:00 tick. With 60s tick interval that's an
  // exact minute match. Tests pin a fake clock at exactly 09:00:00.
  return hour === 9 && minute === 0;
}

function pickReact(
  kind: EmailNotificationKind,
  locale: EmailLocale,
  ctaUrl: string,
  params: { fromName?: string; subjectTitle?: string; detail?: string },
): React.ReactElement {
  const props = { locale, ctaUrl, params };
  switch (kind) {
    case "mention":
      return MentionEmail(props);
    case "comment_reply":
      return CommentReplyEmail(props);
    case "share_invite":
      return ShareInviteEmail(props);
    case "research_complete":
      return ResearchCompleteEmail(props);
    case "system":
      return SystemEmail(props);
  }
}

function cleanWebBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

const WEB_BASE = cleanWebBaseUrl(
  process.env.WEB_BASE_URL ?? "http://localhost:3000",
);

// Compose a deep link from the notification payload. Falls back to the
// app root when the payload doesn't have a kind-specific identifier —
// the user can still find the in-app row from the drawer.
function deepLinkFor(
  kind: NotificationKind,
  locale: EmailLocale,
  payload: Record<string, unknown>,
): string {
  const path = (() => {
    switch (kind) {
      case "mention":
      case "comment_reply": {
        const noteId = payload.noteId;
        return typeof noteId === "string"
          ? `/${locale}/app/n/${noteId}`
          : `/${locale}/app`;
      }
      case "share_invite": {
        const noteId = payload.noteId;
        return typeof noteId === "string"
          ? `/${locale}/app/n/${noteId}`
          : `/${locale}/app`;
      }
      case "research_complete": {
        const runId = payload.runId;
        return typeof runId === "string"
          ? `/${locale}/app/research/${runId}`
          : `/${locale}/app/research`;
      }
      case "system": {
        const linkUrl = payload.linkUrl;
        if (typeof linkUrl === "string" && linkUrl.startsWith("/")) {
          return `/${locale}${linkUrl}`;
        }
        return `/${locale}/app`;
      }
    }
  })();
  return `${WEB_BASE}${path}`;
}

function paramsFromPayload(
  kind: NotificationKind,
  payload: Record<string, unknown>,
) {
  const fromName = typeof payload.fromName === "string" ? payload.fromName : undefined;
  const subjectTitle =
    typeof payload.noteTitle === "string"
      ? payload.noteTitle
      : typeof payload.topic === "string"
      ? payload.topic
      : typeof payload.summary === "string"
      ? payload.summary
      : undefined;
  const detail =
    kind === "share_invite" && typeof payload.role === "string"
      ? payload.role
      : kind === "system" && typeof payload.summary === "string"
      ? payload.summary
      : undefined;
  return { fromName, subjectTitle, detail };
}

// Selects rows that are NOT yet emailed, past the grace window, under
// the retry cap. Joined to user + (optional) preference. Returns rows
// already grouped by (user, kind) so the dispatcher can branch on
// frequency without a second pass.
async function selectPending(
  now: Date,
  client: DbLike = db,
): Promise<
  {
    user: DispatchUser;
    kind: NotificationKind;
    frequency: NotificationFrequency;
    emailEnabled: boolean;
    rows: DispatchRow[];
  }[]
> {
  const cutoff = new Date(now.getTime() - INSTANT_DELAY_SECONDS * 1000);

  // Pull pending notifications joined with the user's email + locale +
  // timezone. We do NOT join the preference table here — the merge over
  // DEFAULT_PREFERENCES happens in JS so we can keep the SQL trivial.
  const rows = await client
    .select({
      id: notifications.id,
      userId: notifications.userId,
      kind: notifications.kind,
      payload: notifications.payload,
      createdAt: notifications.createdAt,
      userEmail: user.email,
      userLocale: user.locale,
      userTimezone: user.timezone,
    })
    .from(notifications)
    .innerJoin(user, eq(user.id, notifications.userId))
    .where(
      and(
        isNull(notifications.emailedAt),
        lt(notifications.emailAttempts, MAX_EMAIL_ATTEMPTS),
        lt(notifications.createdAt, cutoff),
      ),
    )
    .orderBy(asc(notifications.createdAt))
    .limit(500);

  if (rows.length === 0) return [];

  const userIds = Array.from(new Set(rows.map((r) => r.userId)));
  const prefs = await client
    .select({
      userId: userNotificationPreferences.userId,
      kind: userNotificationPreferences.kind,
      emailEnabled: userNotificationPreferences.emailEnabled,
      frequency: userNotificationPreferences.frequency,
    })
    .from(userNotificationPreferences)
    .where(inArray(userNotificationPreferences.userId, userIds));

  const prefMap = new Map<string, { emailEnabled: boolean; frequency: NotificationFrequency }>();
  for (const p of prefs) {
    prefMap.set(`${p.userId}:${p.kind}`, {
      emailEnabled: p.emailEnabled,
      frequency: p.frequency,
    });
  }

  // Group: same user × kind → same bucket.
  type Bucket = {
    user: DispatchUser;
    kind: NotificationKind;
    frequency: NotificationFrequency;
    emailEnabled: boolean;
    rows: DispatchRow[];
  };
  const buckets = new Map<string, Bucket>();

  for (const r of rows) {
    const key = `${r.userId}:${r.kind}`;
    const stored = prefMap.get(key);
    const fallback = DEFAULT_PREFERENCES[r.kind];
    const frequency: NotificationFrequency = stored?.frequency ?? fallback.frequency;
    const emailEnabled = stored?.emailEnabled ?? fallback.emailEnabled;

    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        user: {
          id: r.userId,
          email: r.userEmail,
          locale: ((SUPPORTED_LOCALES as readonly string[]).includes(r.userLocale)
            ? r.userLocale
            : "ko") as EmailLocale,
          timezone: (SUPPORTED_TIMEZONES as readonly string[]).includes(r.userTimezone)
            ? r.userTimezone
            : "Asia/Seoul",
        },
        kind: r.kind,
        frequency,
        emailEnabled,
        rows: [],
      };
      buckets.set(key, bucket);
    }
    bucket.rows.push({
      id: r.id,
      userId: r.userId,
      kind: r.kind,
      payload: r.payload,
      createdAt: r.createdAt,
    });
  }

  return Array.from(buckets.values());
}

async function markSent(rowIds: string[], client: DbLike = db): Promise<void> {
  if (rowIds.length === 0) return;
  await client
    .update(notifications)
    .set({ emailedAt: sql`now()` })
    .where(inArray(notifications.id, rowIds));
}

async function markDisabled(rowIds: string[], client: DbLike = db): Promise<void> {
  if (rowIds.length === 0) return;
  // Set emailed_at so the partial index drops the row from the next scan.
  // last_email_error documents the reason for any later operator query.
  await client
    .update(notifications)
    .set({ emailedAt: sql`now()`, lastEmailError: "disabled" })
    .where(inArray(notifications.id, rowIds));
}

async function recordError(rowId: string, message: string, client: DbLike = db): Promise<void> {
  await client
    .update(notifications)
    .set({
      emailAttempts: sql`${notifications.emailAttempts} + 1`,
      lastEmailError: message.slice(0, 500),
    })
    .where(eq(notifications.id, rowId));
}

async function processInstant(
  bucket: {
    user: DispatchUser;
    kind: NotificationKind;
    rows: DispatchRow[];
  },
  client: DbLike = db,
): Promise<{ sent: number; errors: number }> {
  let sent = 0;
  let errors = 0;
  for (const row of bucket.rows) {
    const params = paramsFromPayload(row.kind, row.payload);
    const ctaUrl = deepLinkFor(row.kind, bucket.user.locale, row.payload);
    const subject = EMAIL_COPY[bucket.user.locale].kinds[row.kind].subject(params);
    try {
      const react = pickReact(row.kind, bucket.user.locale, ctaUrl, params);
      await sendEmail({ to: bucket.user.email, subject, react });
      await markSent([row.id], client);
      sent += 1;
      console.log("[email_dispatcher.send]", {
        userId: bucket.user.id,
        kind: row.kind,
        frequency: "instant",
        ok: true,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await recordError(row.id, message, client);
      errors += 1;
      console.log("[email_dispatcher.send]", {
        userId: bucket.user.id,
        kind: row.kind,
        frequency: "instant",
        ok: false,
        errorClass: err instanceof Error ? err.name : "unknown",
      });
    }
  }
  return { sent, errors };
}

async function processDigest(
  bucket: {
    user: DispatchUser;
    kind: NotificationKind;
    frequency: NotificationFrequency;
    rows: DispatchRow[];
  },
  client: DbLike = db,
): Promise<{ sent: number; errors: number }> {
  const items: DigestItem[] = bucket.rows.map((row) => {
    const summary = (() => {
      const params = paramsFromPayload(row.kind, row.payload);
      const heading = EMAIL_COPY[bucket.user.locale].kinds[row.kind].heading(params);
      const body = EMAIL_COPY[bucket.user.locale].kinds[row.kind].body(params);
      return `${heading} — ${body}`;
    })();
    return {
      summary,
      linkUrl: deepLinkFor(row.kind, bucket.user.locale, row.payload),
    };
  });

  const subject = EMAIL_COPY[bucket.user.locale].digest.subject({
    kind: bucket.kind,
    count: bucket.rows.length,
  });

  try {
    const react = DigestEmail({
      locale: bucket.user.locale,
      kind: bucket.kind,
      items,
      fallbackCtaUrl: `${WEB_BASE}/${bucket.user.locale}/app`,
    });
    await sendEmail({ to: bucket.user.email, subject, react });
    await markSent(bucket.rows.map((r) => r.id), client);
    console.log("[email_dispatcher.send]", {
      userId: bucket.user.id,
      kind: bucket.kind,
      frequency: bucket.frequency,
      ok: true,
      count: bucket.rows.length,
    });
    return { sent: bucket.rows.length, errors: 0 };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // For a digest, increment per-row attempt counter rather than mark all
    // as terminally failed — the next tick can retry.
    for (const row of bucket.rows) {
      await recordError(row.id, message, client);
    }
    console.log("[email_dispatcher.send]", {
      userId: bucket.user.id,
      kind: bucket.kind,
      frequency: bucket.frequency,
      ok: false,
      errorClass: err instanceof Error ? err.name : "unknown",
    });
    return { sent: 0, errors: bucket.rows.length };
  }
}

// Drizzle's `db.execute` return shape varies by driver — postgres-js (the
// driver used in production) returns the row array directly, while
// node-pg returns `{ rows: [...] }`. The `??` form mirrors the convention
// already in apps/api/src/lib/chat-retrieval.ts so both shapes resolve
// without a per-callsite ternary. If we ever standardize on a single
// driver, drop the second arm of the coalesce.
function rowsOf<T>(raw: unknown): T[] {
  const rs = (raw as { rows?: T[] } | undefined)?.rows;
  return rs ?? (raw as T[]);
}

export async function runDispatcherTick(
  opts: { now?: Date; lockKey?: bigint } = {},
): Promise<DispatcherTickResult> {
  const now = opts.now ?? new Date();
  const lockKey = opts.lockKey ?? LOCK_KEY;

  return db.transaction(async (tx) => {
    // Transaction-scoped advisory locks are tied to this transaction's pinned
    // connection and release automatically on commit/rollback.
    const lockRows = await tx.execute<{ pg_try_advisory_xact_lock: boolean }>(
      sql`SELECT pg_try_advisory_xact_lock(${lockKey}) AS pg_try_advisory_xact_lock`,
    );
    const acquired =
      rowsOf<{ pg_try_advisory_xact_lock: boolean }>(lockRows)[0]
        ?.pg_try_advisory_xact_lock === true;

    if (!acquired) {
      console.log("[email_dispatcher.locked]", { now: now.toISOString() });
      return { lockAcquired: false, instantSent: 0, digestSent: 0, skipped: 0, errors: 0 };
    }

    const start = Date.now();
    let instantSent = 0;
    let digestSent = 0;
    let skipped = 0;
    let errors = 0;

    const buckets = await selectPending(now, tx);

    for (const bucket of buckets) {
      if (!bucket.emailEnabled) {
        await markDisabled(bucket.rows.map((r) => r.id), tx);
        skipped += bucket.rows.length;
        continue;
      }

      if (!dueForFrequency(bucket.frequency, now, bucket.user)) {
        skipped += bucket.rows.length;
        continue;
      }

      if (bucket.frequency === "instant") {
        const result = await processInstant(bucket, tx);
        instantSent += result.sent;
        errors += result.errors;
      } else {
        const result = await processDigest(bucket, tx);
        digestSent += result.sent;
        errors += result.errors;
      }
    }

    const durationMs = Date.now() - start;
    console.log("[email_dispatcher.tick]", {
      now: now.toISOString(),
      instantSent,
      digestSent,
      skipped,
      errors,
      durationMs,
    });
    return { lockAcquired: true, instantSent, digestSent, skipped, errors };
  });
}

export function startEmailDispatcher(): void {
  if (process.env.NODE_ENV === "test") return;
  if (process.env.EMAIL_DISPATCHER_ENABLED !== "true") {
    console.log("[email_dispatcher.disabled]", {});
    return;
  }
  if (intervalHandle) return; // idempotent

  intervalHandle = setInterval(() => {
    if (isTickInProgress) return;
    isTickInProgress = true;
    runDispatcherTick()
      .catch((err) => {
        console.error("[email_dispatcher.tick_error]", {
          message: err instanceof Error ? err.message : String(err),
        });
      })
      .finally(() => {
        isTickInProgress = false;
      });
  }, TICK_INTERVAL_MS);
  intervalHandle.unref?.();
  console.log("[email_dispatcher.started]", { intervalMs: TICK_INTERVAL_MS });
}

export function stopEmailDispatcher(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    isTickInProgress = false;
    console.log("[email_dispatcher.stopped]", {});
  }
}

export const _internals = {
  LOCK_KEY,
  INSTANT_DELAY_SECONDS,
  MAX_EMAIL_ATTEMPTS,
  selectPending,
  cleanWebBaseUrl,
  deepLinkFor,
  processInstant,
  processDigest,
  markSent,
  markDisabled,
};

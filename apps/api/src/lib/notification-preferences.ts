import {
  and,
  db,
  eq,
  notificationKindEnum,
  sql,
  user,
  userNotificationPreferences,
} from "@opencairn/db";
import {
  DEFAULT_PREFERENCES,
  type NotificationFrequency,
  type NotificationKind,
  type NotificationPreference,
  type NotificationPreferenceUpsert,
  type NotificationProfile,
  type NotificationProfileUpdate,
  SUPPORTED_LOCALES,
  SUPPORTED_TIMEZONES,
} from "@opencairn/shared";

const NOTIFICATION_KINDS = notificationKindEnum.enumValues as NotificationKind[];

// Read every kind for a user, merging the user's stored rows over the
// virtual defaults. The dispatcher and the GET handler use this.
//
// Returns 5 rows always — never empty — so consumers never have to
// reason about "no row means default".
export async function getEffectivePreferences(
  userId: string,
): Promise<NotificationPreference[]> {
  const rows = await db
    .select({
      kind: userNotificationPreferences.kind,
      emailEnabled: userNotificationPreferences.emailEnabled,
      frequency: userNotificationPreferences.frequency,
    })
    .from(userNotificationPreferences)
    .where(eq(userNotificationPreferences.userId, userId));

  const stored = new Map<NotificationKind, NotificationPreference>();
  for (const row of rows) {
    stored.set(row.kind, {
      kind: row.kind,
      emailEnabled: row.emailEnabled,
      frequency: row.frequency,
    });
  }

  return NOTIFICATION_KINDS.map((kind) => {
    const r = stored.get(kind);
    if (r) return r;
    const fallback = DEFAULT_PREFERENCES[kind];
    return {
      kind,
      emailEnabled: fallback.emailEnabled,
      frequency: fallback.frequency,
    };
  });
}

// Single-kind effective lookup. The dispatcher needs this in its hot path
// to decide whether a notification should email at all.
export async function getEffectivePreferenceForKind(
  userId: string,
  kind: NotificationKind,
): Promise<NotificationPreference> {
  const [row] = await db
    .select({
      emailEnabled: userNotificationPreferences.emailEnabled,
      frequency: userNotificationPreferences.frequency,
    })
    .from(userNotificationPreferences)
    .where(
      and(
        eq(userNotificationPreferences.userId, userId),
        eq(userNotificationPreferences.kind, kind),
      ),
    )
    .limit(1);

  if (row) {
    return { kind, emailEnabled: row.emailEnabled, frequency: row.frequency };
  }
  const fallback = DEFAULT_PREFERENCES[kind];
  return { kind, ...fallback };
}

// Upsert one preference row. Idempotent — calling twice with the same
// payload bumps `updated_at` but the row itself is identical.
export async function upsertPreference(opts: {
  userId: string;
  kind: NotificationKind;
  body: NotificationPreferenceUpsert;
}): Promise<NotificationPreference> {
  const [row] = await db
    .insert(userNotificationPreferences)
    .values({
      userId: opts.userId,
      kind: opts.kind,
      emailEnabled: opts.body.emailEnabled,
      frequency: opts.body.frequency,
    })
    .onConflictDoUpdate({
      target: [userNotificationPreferences.userId, userNotificationPreferences.kind],
      set: {
        emailEnabled: opts.body.emailEnabled,
        frequency: opts.body.frequency,
        // DB-side now() so the bump is monotonic with the existing row's
        // INSERT timestamp (JS Date() can lag the DB clock by milliseconds).
        updatedAt: sql`now()`,
      },
    })
    .returning();

  return {
    kind: row.kind,
    emailEnabled: row.emailEnabled,
    frequency: row.frequency,
  };
}

// users.locale + users.timezone live on the user table. Profile getters
// return the persisted values; the column defaults make this safe even
// for users created before migration 0039.
export async function getProfile(userId: string): Promise<NotificationProfile> {
  const [row] = await db
    .select({ locale: user.locale, timezone: user.timezone })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);

  if (!row) {
    throw new Error(`user ${userId} not found`);
  }

  // Defensive — DB columns are typed as text, so cast through the runtime
  // schema so a manually-tampered row with an unsupported value doesn't
  // crash the handler. Falls back to defaults if invalid.
  return {
    locale: (SUPPORTED_LOCALES as readonly string[]).includes(row.locale)
      ? (row.locale as NotificationProfile["locale"])
      : "ko",
    timezone: (SUPPORTED_TIMEZONES as readonly string[]).includes(row.timezone)
      ? (row.timezone as NotificationProfile["timezone"])
      : "Asia/Seoul",
  };
}

export async function updateProfile(opts: {
  userId: string;
  body: NotificationProfileUpdate;
}): Promise<NotificationProfile> {
  const patch: { locale?: string; timezone?: string; updatedAt: Date } = {
    // user.updatedAt has $onUpdate set already; this keeps the column
    // explicit in case schema changes later.
    updatedAt: new Date(),
  };
  if (opts.body.locale) patch.locale = opts.body.locale;
  if (opts.body.timezone) patch.timezone = opts.body.timezone;

  if (patch.locale || patch.timezone) {
    await db.update(user).set(patch).where(eq(user.id, opts.userId));
  }
  return getProfile(opts.userId);
}

// Re-export for the dispatcher so it doesn't have to know about
// NOTIFICATION_KINDS internal mapping.
export { NOTIFICATION_KINDS };

// Internal — exposed for tests asserting that `frequency` round-trips
// through the upsert without coercion.
export function _isFrequency(value: string): value is NotificationFrequency {
  return value === "instant" || value === "digest_15min" || value === "digest_daily";
}

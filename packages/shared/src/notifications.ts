import { z } from "zod";

// Mirrors `notification_kind` pgEnum in `packages/db/src/schema/enums.ts`.
// Kept in lockstep — adding a kind here also requires a new email template
// branch in `packages/emails` and a renderer branch in `apps/web/.../NotificationItem`.
export const NotificationKindSchema = z.enum([
  "mention",
  "comment_reply",
  "research_complete",
  "share_invite",
  "system",
]);
export type NotificationKind = z.infer<typeof NotificationKindSchema>;

// Email cadence per notification kind. `instant` fires on the next dispatcher
// tick; `digest_15min` flushes at every quarter-hour wallclock boundary;
// `digest_daily` flushes at 09:00 in the user's timezone.
export const NotificationFrequencySchema = z.enum([
  "instant",
  "digest_15min",
  "digest_daily",
]);
export type NotificationFrequency = z.infer<typeof NotificationFrequencySchema>;

// One row of the per-user preferences table. The DB has `(user_id, kind)`
// as the composite PK so the wire shape carries the kind explicitly.
export const NotificationPreferenceSchema = z.object({
  kind: NotificationKindSchema,
  emailEnabled: z.boolean(),
  frequency: NotificationFrequencySchema,
});
export type NotificationPreference = z.infer<typeof NotificationPreferenceSchema>;

// PUT body — kind comes from the URL path, body carries only the writable
// fields. Both required (no partial; the client always sends both toggle
// states for a single row).
export const NotificationPreferenceUpsertSchema = z.object({
  emailEnabled: z.boolean(),
  frequency: NotificationFrequencySchema,
});
export type NotificationPreferenceUpsert = z.infer<
  typeof NotificationPreferenceUpsertSchema
>;

// Locale enum mirrors `apps/web/src/i18n.ts`. CHECK constraint in
// migration 0039 enforces the same set on the DB column.
export const SUPPORTED_LOCALES = ["ko", "en"] as const;
export const NotificationLocaleSchema = z.enum(SUPPORTED_LOCALES);
export type NotificationLocale = z.infer<typeof NotificationLocaleSchema>;

// Curated timezone list — covers the founder, beta users, and major OSS
// contributor regions without dragging in the 600+ IANA entries. Extend as
// real users surface (Africa/Lagos, Australia/Sydney, ...).
export const SUPPORTED_TIMEZONES = [
  "Asia/Seoul",
  "Asia/Tokyo",
  "Asia/Shanghai",
  "Asia/Singapore",
  "Asia/Kolkata",
  "UTC",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "America/Sao_Paulo",
  "Australia/Sydney",
] as const;
export const NotificationTimezoneSchema = z.enum(SUPPORTED_TIMEZONES);
export type NotificationTimezone = z.infer<typeof NotificationTimezoneSchema>;

// GET /api/notification-preferences/profile response shape.
export const NotificationProfileSchema = z.object({
  locale: NotificationLocaleSchema,
  timezone: NotificationTimezoneSchema,
});
export type NotificationProfile = z.infer<typeof NotificationProfileSchema>;

// PUT body — partial; either field may be omitted.
export const NotificationProfileUpdateSchema = z
  .object({
    locale: NotificationLocaleSchema.optional(),
    timezone: NotificationTimezoneSchema.optional(),
  })
  .strict();
export type NotificationProfileUpdate = z.infer<
  typeof NotificationProfileUpdateSchema
>;

// Virtual defaults — the DB stores nothing for users who haven't visited
// /settings/notifications. The dispatcher and the GET handler merge
// `DEFAULT_PREFERENCES` over the user's row(s) before deciding to send.
//
// Rationale per kind:
//   mention / comment_reply / share_invite / research_complete → instant.
//     Recipients act on these (reply, accept invite, read findings); a
//     digest delay defeats the point.
//   system → digest_daily. Cross-feature broadcasts (import done, admin
//     announcements) should not interrupt; one summary email per day is
//     enough.
export const DEFAULT_PREFERENCES: Record<
  NotificationKind,
  { emailEnabled: boolean; frequency: NotificationFrequency }
> = {
  mention: { emailEnabled: true, frequency: "instant" },
  comment_reply: { emailEnabled: true, frequency: "instant" },
  share_invite: { emailEnabled: true, frequency: "instant" },
  research_complete: { emailEnabled: true, frequency: "instant" },
  system: { emailEnabled: true, frequency: "digest_daily" },
};

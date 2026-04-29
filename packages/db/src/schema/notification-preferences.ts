import {
  pgTable,
  text,
  boolean,
  timestamp,
  primaryKey,
} from "drizzle-orm/pg-core";

import { user } from "./users";
import { notificationFrequencyEnum, notificationKindEnum } from "./enums";

// Plan 2 Task 14 — per-user, per-kind email cadence preferences.
//
// Sparse table: a missing (user_id, kind) row means "use DEFAULT_PREFERENCES
// from packages/shared/notifications". The dispatcher and the GET handler
// merge defaults over the rows they read so users who never visit
// /settings/notifications still receive instant mention/reply emails.
//
// Composite PK is `(user_id, kind)`; one row per kind per user. ON DELETE
// CASCADE on the user keeps preferences consistent with account deletion.
export const userNotificationPreferences = pgTable(
  "user_notification_preferences",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    kind: notificationKindEnum("kind").notNull(),
    emailEnabled: boolean("email_enabled").notNull(),
    frequency: notificationFrequencyEnum("frequency").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [primaryKey({ columns: [t.userId, t.kind] })],
);

export type UserNotificationPreference =
  typeof userNotificationPreferences.$inferSelect;
export type UserNotificationPreferenceInsert =
  typeof userNotificationPreferences.$inferInsert;

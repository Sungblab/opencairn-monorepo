import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  index,
  integer,
} from "drizzle-orm/pg-core";
import { user } from "./users";
import { notificationKindEnum } from "./enums";

// App Shell Phase 5 Task 9 — per-user notification log. Drives both the
// drawer (REST list, mark-read) and the live SSE channel. user_id matches
// users.id text type (Better Auth) per the project-wide convention.
//
// Indexes:
//   - notifications_user_unread_idx (partial, WHERE read_at IS NULL): the
//     hot path for the drawer's unread-count badge + first-page fetch.
//   - notifications_user_created_idx: full-history pagination (read + unread).
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    kind: notificationKindEnum("kind").notNull(),
    payload: jsonb("payload").notNull().$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    seenAt: timestamp("seen_at", { withTimezone: true }),
    readAt: timestamp("read_at", { withTimezone: true }),

    // Plan 2 Task 14 — email dispatcher.
    //   emailedAt        — set once Resend/SMTP/console accepts the message.
    //                      The partial pending-email index keys off this column.
    //   emailAttempts    — increments on each Resend failure. After 3 the row
    //                      drops out of the dispatcher's selection.
    //   lastEmailError   — short error class, truncated to 500 chars.
    //                      `'disabled'` is a sentinel for rows finalized
    //                      because the recipient turned email off for the kind.
    emailedAt: timestamp("emailed_at", { withTimezone: true }),
    emailAttempts: integer("email_attempts").notNull().default(0),
    lastEmailError: text("last_email_error"),
  },
  (t) => [
    index("notifications_user_unread_idx")
      .on(t.userId, t.createdAt)
      .where(sql`${t.readAt} IS NULL`),
    index("notifications_user_created_idx").on(t.userId, t.createdAt),
    // Hot path for the dispatcher's tick scan — keeps the selection cheap
    // regardless of total notification count.
    index("notifications_pending_email_idx")
      .on(t.createdAt)
      .where(sql`${t.emailedAt} IS NULL AND ${t.emailAttempts} < 3`),
  ],
);

export type Notification = typeof notifications.$inferSelect;
export type NotificationInsert = typeof notifications.$inferInsert;

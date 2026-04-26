import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  index,
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
  },
  (t) => [
    index("notifications_user_unread_idx")
      .on(t.userId, t.createdAt)
      .where(sql`${t.readAt} IS NULL`),
    index("notifications_user_created_idx").on(t.userId, t.createdAt),
  ],
);

export type Notification = typeof notifications.$inferSelect;
export type NotificationInsert = typeof notifications.$inferInsert;

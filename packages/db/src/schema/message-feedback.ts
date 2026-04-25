import { sql } from "drizzle-orm";
import { pgTable, uuid, text, timestamp, index, unique, check } from "drizzle-orm/pg-core";
import { chatMessages } from "./chat-messages";
import { user } from "./users";

// Thumbs-up / thumbs-down on an individual agent message. Sentiment is a
// free `text` column (instead of an enum) so we can iterate UI labels
// without a migration; the CHECK below pins it to the supported values.
//
// One feedback per (message, user) pair — re-clicking the same button is
// a no-op upsert and switching sides is an UPDATE, never a duplicate row.
export const messageFeedback = pgTable(
  "message_feedback",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    messageId: uuid("message_id")
      .notNull()
      .references(() => chatMessages.id, { onDelete: "cascade" }),
    // Better Auth user.id is text — keep FK column type aligned with users.ts.
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    sentiment: text("sentiment").notNull(),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("message_feedback_message_id_idx").on(t.messageId),
    unique("message_feedback_message_user_unique").on(t.messageId, t.userId),
    check(
      "message_feedback_sentiment_check",
      sql`${t.sentiment} IN ('positive','negative')`,
    ),
  ],
);

export type MessageFeedback = typeof messageFeedback.$inferSelect;
export type MessageFeedbackInsert = typeof messageFeedback.$inferInsert;

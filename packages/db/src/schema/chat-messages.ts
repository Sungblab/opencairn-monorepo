import { pgTable, uuid, jsonb, timestamp, text, index } from "drizzle-orm/pg-core";
import { messageRoleEnum, messageStatusEnum } from "./enums";
import { chatThreads } from "./chat-threads";

// One row per user prompt or agent reply within a thread. We persist the
// rendered content as JSONB rather than markdown so the renderer can replay
// rich blocks (citations, tool calls, attachments) without re-parsing.
//
// Status semantics (see also enums.ts messageStatusEnum):
//   `streaming` → row inserted before the SSE stream emits. Lets a crash
//                 mid-stream leave a recoverable row instead of a ghost.
//   `complete`  → stream ended cleanly (the steady-state value).
//   `failed`    → pipeline threw; partial buffer kept for the retry UI.
// User messages skip the streaming state — they're written synchronously.
export const chatMessages = pgTable(
  "chat_messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => chatThreads.id, { onDelete: "cascade" }),
    role: messageRoleEnum("role").notNull(),
    status: messageStatusEnum("status").notNull().default("complete"),
    // Plate-style block array (see apps/web chat renderer). Always notNull —
    // even an empty agent reply persists as `[]` so downstream code never
    // has to branch on null.
    content: jsonb("content").notNull(),
    // Free-form labels populated by the agent runtime; not a closed enum
    // because new modes / providers ship behind feature flags before the
    // schema would normally see them. Validation lives in apps/api.
    mode: text("mode"),
    provider: text("provider"),
    tokenUsage: jsonb("token_usage"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  // Thread playback is the only hot read path; (thread_id, created_at)
  // keeps the chronological scan index-only.
  (t) => [index("chat_messages_thread_created_idx").on(t.threadId, t.createdAt)],
);

export type ChatMessage = typeof chatMessages.$inferSelect;
export type ChatMessageInsert = typeof chatMessages.$inferInsert;

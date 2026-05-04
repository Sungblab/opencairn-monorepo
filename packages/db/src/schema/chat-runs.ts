import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { chatMessages } from "./chat-messages";
import { chatThreads } from "./chat-threads";
import { chatRunStatusEnum } from "./enums";
import { user } from "./users";
import { workspaces } from "./workspaces";

export const chatRuns = pgTable(
  "chat_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => chatThreads.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    userMessageId: uuid("user_message_id")
      .notNull()
      .references(() => chatMessages.id, { onDelete: "cascade" }),
    agentMessageId: uuid("agent_message_id")
      .notNull()
      .references(() => chatMessages.id, { onDelete: "cascade" }),
    workflowId: text("workflow_id").notNull(),
    status: chatRunStatusEnum("status").notNull().default("queued"),
    currentAttempt: integer("current_attempt").notNull().default(0),
    executionLeaseId: text("execution_lease_id"),
    executionLeaseExpiresAt: timestamp("execution_lease_expires_at", {
      withTimezone: true,
    }),
    mode: text("mode"),
    scope: jsonb("scope"),
    error: jsonb("error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    cancelRequestedAt: timestamp("cancel_requested_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("chat_runs_workflow_id_idx").on(t.workflowId),
    index("chat_runs_thread_status_idx").on(t.threadId, t.status, t.createdAt),
    index("chat_runs_agent_message_idx").on(t.agentMessageId),
  ],
);

export const chatRunEvents = pgTable(
  "chat_run_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => chatRuns.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    executionAttempt: integer("execution_attempt").notNull().default(0),
    event: text("event").notNull(),
    payload: jsonb("payload").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("chat_run_events_run_seq_idx").on(t.runId, t.seq),
    index("chat_run_events_run_created_idx").on(t.runId, t.createdAt),
  ],
);

export type ChatRun = typeof chatRuns.$inferSelect;
export type ChatRunInsert = typeof chatRuns.$inferInsert;
export type ChatRunEvent = typeof chatRunEvents.$inferSelect;
export type ChatRunEventInsert = typeof chatRunEvents.$inferInsert;

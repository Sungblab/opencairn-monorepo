import {
  pgTable,
  uuid,
  text,
  jsonb,
  bigint,
  numeric,
  timestamp,
  pgEnum,
  index,
} from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces";
import { user } from "./users";
import { notes } from "./notes";

// Plan 11A — chat scope foundation. Lives alongside the App Shell Phase 4
// `chat_threads` / `chat_messages` tables (kept for the agent-panel UI). The
// new `conversations` family carries scope chips, RAG mode, pin metadata,
// and per-conversation cost rollups that the older threads schema never had.
//
// The role enum is named `conversation_message_role` because Phase 4's
// `message_role` enum already exists with values ['user','agent']; widening
// it to ['user','assistant','system','tool'] would couple two systems that
// have no other overlap. New enum keeps the boundary clean.
export const scopeTypeEnum = pgEnum("scope_type", ["page", "project", "workspace"]);
export const ragModeEnum = pgEnum("rag_mode", ["strict", "expand"]);
export const conversationMessageRoleEnum = pgEnum("conversation_message_role", [
  "user",
  "assistant",
  "system",
  "tool",
]);

// Inline TS shapes — the canonical Zod schemas live in
// packages/shared/src/chat.ts (Plan 11A Task 2). These types only document
// the jsonb payload for Drizzle inference; runtime validation happens at
// the API edge.
export type AttachedChip = {
  type: "page" | "project" | "workspace" | "memory:l3" | "memory:l4" | "memory:l2";
  id: string;
  label?: string;
  manual: boolean;
};

export type Citation = {
  source_type: "note" | "concept" | "external";
  source_id: string;
  snippet: string;
  locator?: {
    page?: number;
    line_range?: [number, number];
    start_ms?: number;
    end_ms?: number;
  };
};

export type MemoryFlags = {
  l3_global: boolean;
  l3_workspace: boolean;
  l4: boolean;
  l2: boolean;
};

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    // Better Auth user.id is text — same convention as chat_threads,
    // notifications, comments, etc.
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title"),
    scopeType: scopeTypeEnum("scope_type").notNull(),
    // scope_id is text not uuid because workspace scope stores the
    // workspace UUID while project/page scopes store their respective UUIDs.
    // Keeping it as text avoids a cast every read; FK is enforced in the
    // API layer via validateScope() since the target table varies by type.
    scopeId: text("scope_id").notNull(),
    attachedChips: jsonb("attached_chips")
      .$type<AttachedChip[]>()
      .notNull()
      .default([]),
    ragMode: ragModeEnum("rag_mode").notNull().default("strict"),
    memoryFlags: jsonb("memory_flags")
      .$type<MemoryFlags>()
      .notNull()
      .default({ l3_global: true, l3_workspace: true, l4: true, l2: false }),
    // Plan 11B — L1 lossless extract (`session_memory_md`) and L1 lossy
    // compaction (`full_summary`). Columns ship now so 11B can backfill
    // without a follow-up migration.
    sessionMemoryMd: text("session_memory_md"),
    fullSummary: text("full_summary"),
    totalTokensIn: bigint("total_tokens_in", { mode: "number" }).notNull().default(0),
    totalTokensOut: bigint("total_tokens_out", { mode: "number" }).notNull().default(0),
    totalCostKrw: numeric("total_cost_krw", { precision: 12, scale: 4 })
      .notNull()
      .default("0"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("conversations_owner_recent_idx").on(t.workspaceId, t.ownerUserId, t.updatedAt),
    index("conversations_scope_recent_idx").on(t.scopeType, t.scopeId, t.updatedAt),
  ],
);

export const conversationMessages = pgTable(
  "conversation_messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    role: conversationMessageRoleEnum("role").notNull(),
    content: text("content").notNull(),
    citations: jsonb("citations").$type<Citation[]>().notNull().default([]),
    tokensIn: bigint("tokens_in", { mode: "number" }),
    tokensOut: bigint("tokens_out", { mode: "number" }),
    costKrw: numeric("cost_krw", { precision: 12, scale: 4 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("conversation_messages_convo_time_idx").on(t.conversationId, t.createdAt)],
);

// pinned_answers — one row per pin operation. `reason` records why the pin
// went through (clean: no permission delta; confirmed: user accepted the
// citation-visibility warning). It replaces the activity_events row from
// the spec body; a fully-fledged audit log is out of scope for Plan 11A and
// the data lives here unambiguously for Plan 2C-style follow-ups.
export const pinnedAnswers = pgTable(
  "pinned_answers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    messageId: uuid("message_id")
      .notNull()
      .references(() => conversationMessages.id, { onDelete: "cascade" }),
    noteId: uuid("note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    blockId: text("block_id").notNull(),
    pinnedBy: text("pinned_by")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    reason: text("reason"),
    pinnedAt: timestamp("pinned_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("pinned_answers_note_idx").on(t.noteId)],
);

export type Conversation = typeof conversations.$inferSelect;
export type ConversationInsert = typeof conversations.$inferInsert;
export type ConversationMessage = typeof conversationMessages.$inferSelect;
export type ConversationMessageInsert = typeof conversationMessages.$inferInsert;
export type PinnedAnswer = typeof pinnedAnswers.$inferSelect;
export type PinnedAnswerInsert = typeof pinnedAnswers.$inferInsert;

import {
  pgTable,
  uuid,
  text,
  integer,
  numeric,
  timestamp,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { notes } from "./notes";
import { workspaces } from "./workspaces";
import { user } from "./users";

// Plan 11B Phase A — every slash-command invocation appends one row, ok or
// failed. workspace_id is denormalized so usage rollups don't need to join
// through notes. cost_krw mirrors conversation_messages.cost_krw shape.
export const docEditorCalls = pgTable(
  "doc_editor_calls",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    noteId: uuid("note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    command: text("command").notNull(),
    tokensIn: integer("tokens_in").notNull().default(0),
    tokensOut: integer("tokens_out").notNull().default(0),
    costKrw: numeric("cost_krw", { precision: 12, scale: 4 })
      .notNull()
      .default("0"),
    status: text("status").notNull(),
    errorCode: text("error_code"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("doc_editor_calls_user_recent_idx").on(t.userId, t.createdAt),
    index("doc_editor_calls_note_recent_idx").on(t.noteId, t.createdAt),
    check(
      "doc_editor_calls_status_check",
      sql`${t.status} IN ('ok', 'failed')`,
    ),
  ],
);

export type DocEditorCall = typeof docEditorCalls.$inferSelect;
export type DocEditorCallInsert = typeof docEditorCalls.$inferInsert;

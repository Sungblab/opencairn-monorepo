import { pgTable, uuid, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { notes } from "./notes";
import { wikiActionEnum } from "./enums";

export const wikiLogs = pgTable(
  "wiki_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    noteId: uuid("note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    agent: text("agent").notNull(),
    action: wikiActionEnum("action").notNull(),
    diff: jsonb("diff"),
    reason: text("reason"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("wiki_logs_note_id_idx").on(t.noteId)]
);

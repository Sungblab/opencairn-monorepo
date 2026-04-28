import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { notes } from "./notes";
import { workspaces } from "./workspaces";

export const noteEnrichments = pgTable(
  "note_enrichments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    // One artifact per note. The unique index on note_id lets the writer
    // POST endpoint use ON CONFLICT (note_id) DO UPDATE so concurrent
    // ingest retries land on a single row instead of stacking duplicates.
    noteId: uuid("note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    contentType: text("content_type").notNull(),
    status: text("status").notNull().default("pending"),
    artifact: jsonb("artifact").$type<Record<string, unknown>>(),
    provider: text("provider"),
    skipReasons: text("skip_reasons").array(),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("note_enrichments_note_id_unique").on(t.noteId),
    index("note_enrichments_workspace_id_idx").on(t.workspaceId),
  ],
);

export type NoteEnrichment = typeof noteEnrichments.$inferSelect;
export type NoteEnrichmentInsert = typeof noteEnrichments.$inferInsert;

import { pgTable, uuid, text, integer, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { notes } from "./notes";

export const audioFiles = pgTable(
  "audio_files",
  {
    id:          uuid("id").defaultRandom().primaryKey(),
    noteId:      uuid("note_id").references(() => notes.id, { onDelete: "set null" }),
    r2Key:       text("r2_key").notNull(),
    durationSec: integer("duration_sec"),
    voices:      jsonb("voices").$type<Array<{ name: string; style?: string }>>(),
    createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audio_files_note_idx").on(t.noteId),
  ]
);

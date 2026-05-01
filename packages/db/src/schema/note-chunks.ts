import { sql } from "drizzle-orm";
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
import { tsvector, vector3072 } from "./custom-types";
import { notes } from "./notes";
import { projects } from "./projects";
import { workspaces } from "./workspaces";

export type NoteChunkSourceOffsets = {
  start: number;
  end: number;
};

export const noteChunks = pgTable(
  "note_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    noteId: uuid("note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    chunkIndex: integer("chunk_index").notNull(),
    headingPath: text("heading_path").notNull().default(""),
    contentText: text("content_text").notNull(),
    contentTsv: tsvector("content_tsv").notNull().default(sql`''::tsvector`),
    embedding: vector3072("embedding"),
    tokenCount: integer("token_count").notNull(),
    sourceOffsets: jsonb("source_offsets")
      .$type<NoteChunkSourceOffsets>()
      .notNull(),
    contentHash: text("content_hash").notNull(),
    deletedAt: timestamp("deleted_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("note_chunks_note_index_unique").on(t.noteId, t.chunkIndex),
    index("note_chunks_content_hash_idx").on(t.contentHash),
    index("note_chunks_active_project_idx").on(t.projectId, t.deletedAt),
    index("note_chunks_active_workspace_idx").on(t.workspaceId, t.deletedAt),
    index("note_chunks_content_tsv_idx").using("gin", t.contentTsv),
  ],
);

export type NoteChunk = typeof noteChunks.$inferSelect;
export type NewNoteChunk = typeof noteChunks.$inferInsert;

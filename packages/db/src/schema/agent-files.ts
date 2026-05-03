import { sql } from "drizzle-orm";
import {
  integer,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { folders } from "./folders";
import { notes } from "./notes";
import { projects } from "./projects";
import { user } from "./users";
import { workspaces } from "./workspaces";

export const agentFiles = pgTable(
  "agent_files",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    folderId: uuid("folder_id").references(() => folders.id, {
      onDelete: "set null",
    }),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    filename: text("filename").notNull(),
    extension: text("extension").notNull(),
    kind: text("kind").notNull(),
    mimeType: text("mime_type").notNull(),
    objectKey: text("object_key").notNull(),
    bytes: integer("bytes").notNull(),
    contentHash: text("content_hash").notNull(),
    source: text("source").notNull().default("agent_chat"),
    chatThreadId: uuid("chat_thread_id"),
    chatMessageId: uuid("chat_message_id"),
    parentFileId: uuid("parent_file_id").references(
      (): AnyPgColumn => agentFiles.id,
      { onDelete: "set null" },
    ),
    versionGroupId: uuid("version_group_id").notNull(),
    version: integer("version").notNull().default(1),
    ingestWorkflowId: text("ingest_workflow_id"),
    ingestStatus: text("ingest_status").notNull().default("not_started"),
    sourceNoteId: uuid("source_note_id").references(() => notes.id, {
      onDelete: "set null",
    }),
    canvasNoteId: uuid("canvas_note_id").references(() => notes.id, {
      onDelete: "set null",
    }),
    compileStatus: text("compile_status").notNull().default("not_started"),
    compiledObjectKey: text("compiled_object_key"),
    compiledMimeType: text("compiled_mime_type"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("agent_files_project_folder_deleted_idx").on(
      t.projectId,
      t.folderId,
      t.deletedAt,
    ),
    index("agent_files_workspace_created_idx").on(t.workspaceId, t.createdAt),
    index("agent_files_version_group_version_idx").on(t.versionGroupId, t.version),
    uniqueIndex("agent_files_object_key_idx").on(t.objectKey),
    uniqueIndex("agent_files_version_unique_idx").on(t.versionGroupId, t.version),
    index("agent_files_live_project_idx")
      .on(t.projectId)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);

export type AgentFile = typeof agentFiles.$inferSelect;
export type AgentFileInsert = typeof agentFiles.$inferInsert;

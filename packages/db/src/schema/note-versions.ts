import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { byteaU8 } from "./custom-types";
import { notes } from "./notes";
import { projects } from "./projects";
import { user } from "./users";
import { workspaces } from "./workspaces";

export const noteVersionActorTypeEnum = pgEnum("note_version_actor_type", [
  "user",
  "agent",
  "system",
]);

export const noteVersionSourceEnum = pgEnum("note_version_source", [
  "auto_save",
  "title_change",
  "ai_edit",
  "restore",
  "manual_checkpoint",
  "import",
]);

export const noteVersions = pgTable(
  "note_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    noteId: uuid("note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    title: text("title").notNull(),
    content: jsonb("content").$type<unknown>().notNull(),
    contentText: text("content_text").notNull().default(""),
    contentHash: text("content_hash").notNull(),
    yjsState: byteaU8("yjs_state"),
    yjsStateVector: byteaU8("yjs_state_vector"),
    actorId: text("actor_id").references(() => user.id, {
      onDelete: "set null",
    }),
    actorType: noteVersionActorTypeEnum("actor_type").notNull().default("user"),
    source: noteVersionSourceEnum("source").notNull(),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("note_versions_note_version_idx").on(t.noteId, t.version),
    index("note_versions_note_created_idx").on(t.noteId, t.createdAt.desc()),
    index("note_versions_workspace_created_idx").on(
      t.workspaceId,
      t.createdAt.desc(),
    ),
    index("note_versions_actor_created_idx").on(t.actorId, t.createdAt.desc()),
  ],
);

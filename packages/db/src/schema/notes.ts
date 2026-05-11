import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  jsonb,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { projects } from "./projects";
import { workspaces } from "./workspaces";
import { folders } from "./folders";
import { noteTypeEnum, sourceTypeEnum, canvasLanguageEnum } from "./enums";
import { tsvector, vector3072 } from "./custom-types";

export const notes = pgTable(
  "notes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    folderId: uuid("folder_id").references(() => folders.id, {
      onDelete: "set null",
    }),
    inheritParent: boolean("inherit_parent").notNull().default(true),
    title: text("title").notNull().default(""),
    // Plate Value is `Array<PlateNode>`. Kept as `unknown` so both array and legacy
    // object payloads round-trip through jsonb without a cast dance.
    content: jsonb("content").$type<unknown>(),
    contentText: text("content_text").default(""),
    contentTsv: tsvector("content_tsv"),
    embedding: vector3072("embedding"),
    type: noteTypeEnum("type").notNull().default("note"),
    sourceType: sourceTypeEnum("source_type"),
    // Plan 7 Canvas Phase 1. Non-null iff sourceType='canvas' (notes_canvas_language_check).
    canvasLanguage: canvasLanguageEnum("canvas_language"),
    sourceFileKey: text("source_file_key"),
    sourceUrl: text("source_url"),
    mimeType: text("mime_type"),
    isAuto: boolean("is_auto").notNull().default(false),
    doi: text("doi"),
    // Hocuspocus가 기존 notes.content를 Y.Doc으로 seed한 시각. 재시작 시 덮어쓰기 방지 가드.
    yjsStateLoadedAt: timestamp("yjs_state_loaded_at", { withTimezone: true }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow().$onUpdate(() => new Date()),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    index("notes_project_id_idx").on(t.projectId),
    index("notes_workspace_id_idx").on(t.workspaceId),
    index("notes_folder_id_idx").on(t.folderId),
    index("notes_type_idx").on(t.type),
    index("notes_deleted_at_idx").on(t.deletedAt),
    // Literature dedupe: at most one note per (workspace, doi). Partial so
    // notes without a DOI (the vast majority) skip the index entirely.
    uniqueIndex("notes_workspace_doi_idx")
      .on(t.workspaceId, t.doi)
      .where(sql`${t.doi} IS NOT NULL`),
    // Predicate mirrors `0022_canvas_language_column.sql`. The `::text` cast on
    // `source_type` is required because the migration runs in a transaction
    // that adds the 'canvas' enum value, and Postgres rejects direct enum
    // literal use in the same transaction (55P04). Strict iff: a canvas note
    // MUST have canvas_language NOT NULL, and a non-canvas note MUST have
    // canvas_language NULL. Without the second branch's NULL clamp, a row
    // with sourceType='manual' AND canvas_language='python' would slip past.
    check(
      "notes_canvas_language_check",
      sql`(${t.sourceType}::text = 'canvas' AND ${t.canvasLanguage} IS NOT NULL)
          OR ((${t.sourceType} IS NULL OR ${t.sourceType}::text <> 'canvas') AND ${t.canvasLanguage} IS NULL)`,
    ),
  ]
);

export const noteLinks = pgTable(
  "note_links",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    targetId: uuid("target_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    context: text("context"),
  },
  (t) => [
    index("note_links_source_id_idx").on(t.sourceId),
    index("note_links_target_id_idx").on(t.targetId),
  ]
);

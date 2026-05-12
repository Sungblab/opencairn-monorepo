import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { notes } from "./notes";
import { projects } from "./projects";
import { user } from "./users";
import { workspaces } from "./workspaces";

export type PdfAnnotationPayload = Array<Record<string, unknown>>;

export const sourcePdfAnnotations = pgTable(
  "source_pdf_annotations",
  {
    noteId: uuid("note_id")
      .primaryKey()
      .references(() => notes.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    annotations: jsonb("annotations")
      .$type<PdfAnnotationPayload>()
      .notNull()
      .default([]),
    updatedBy: text("updated_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    index("source_pdf_annotations_workspace_project_idx").on(
      t.workspaceId,
      t.projectId,
    ),
    index("source_pdf_annotations_updated_by_idx").on(t.updatedBy),
  ],
);

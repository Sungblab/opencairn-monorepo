import { relations, sql } from "drizzle-orm";
import {
  index,
  integer,
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
import { workspaces } from "./workspaces";

export const noteAnalysisStatusEnum = pgEnum("note_analysis_status", [
  "queued",
  "running",
  "completed",
  "failed",
]);

export const noteAnalysisJobs = pgTable(
  "note_analysis_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    noteId: uuid("note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    contentHash: text("content_hash").notNull(),
    yjsStateVector: byteaU8("yjs_state_vector"),
    analysisVersion: integer("analysis_version").notNull().default(1),
    status: noteAnalysisStatusEnum("status").notNull().default("queued"),
    runAfter: timestamp("run_after", { withTimezone: true }).notNull().defaultNow(),
    lastQueuedAt: timestamp("last_queued_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastStartedAt: timestamp("last_started_at", { withTimezone: true }),
    lastCompletedAt: timestamp("last_completed_at", { withTimezone: true }),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("note_analysis_jobs_note_unique").on(t.noteId),
    index("note_analysis_jobs_due_idx").on(t.status, t.runAfter),
    index("note_analysis_jobs_project_status_idx").on(
      t.projectId,
      t.status,
      t.updatedAt,
    ),
    index("note_analysis_jobs_workspace_status_idx").on(
      t.workspaceId,
      t.status,
      t.updatedAt,
    ),
    index("note_analysis_jobs_content_hash_idx").on(t.contentHash),
  ],
);

export const noteAnalysisJobsRelations = relations(
  noteAnalysisJobs,
  ({ one }) => ({
    workspace: one(workspaces, {
      fields: [noteAnalysisJobs.workspaceId],
      references: [workspaces.id],
    }),
    project: one(projects, {
      fields: [noteAnalysisJobs.projectId],
      references: [projects.id],
    }),
    note: one(notes, {
      fields: [noteAnalysisJobs.noteId],
      references: [notes.id],
    }),
  }),
);

export type NoteAnalysisJob = typeof noteAnalysisJobs.$inferSelect;
export type NewNoteAnalysisJob = typeof noteAnalysisJobs.$inferInsert;

export const incrementNoteAnalysisVersion = sql`${noteAnalysisJobs.analysisVersion} + 1`;

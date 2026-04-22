import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { user } from "./users";
import { workspaces } from "./workspaces";
import { projects } from "./projects";
import { notes } from "./notes";
import { importSourceEnum, jobStatusEnum } from "./enums";

// One-shot import job (Drive file batch or Notion ZIP). Owned by the user
// who started the import, scoped to a workspace. Progress counters updated
// via Temporal signal; see apps/worker ImportWorkflow.
export const importJobs = pgTable(
  "import_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    source: importSourceEnum("source").notNull(),
    targetProjectId: uuid("target_project_id").references(() => projects.id),
    targetParentNoteId: uuid("target_parent_note_id").references(
      () => notes.id
    ),
    workflowId: text("workflow_id").notNull().unique(),
    status: jobStatusEnum("status").notNull().default("queued"),
    totalItems: integer("total_items").notNull().default(0),
    completedItems: integer("completed_items").notNull().default(0),
    failedItems: integer("failed_items").notNull().default(0),
    sourceMetadata: jsonb("source_metadata").notNull(),
    errorSummary: text("error_summary"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    index("idx_import_jobs_workspace").on(t.workspaceId, t.createdAt),
    index("idx_import_jobs_user").on(t.userId, t.createdAt),
  ]
);

export type ImportJob = typeof importJobs.$inferSelect;
export type ImportJobInsert = typeof importJobs.$inferInsert;

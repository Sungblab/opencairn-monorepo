import {
  pgTable,
  uuid,
  text,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { user } from "./users";
import { workspaces } from "./workspaces";
import { projects } from "./projects";

// Binds a Temporal ``IngestWorkflow`` id to the user + workspace + project
// that dispatched it, so ``GET /api/ingest/status/:workflowId`` can
// enforce an owner check instead of treating the workflow id as a
// capability URL (the old comment on that handler conceded this).
//
// One row per dispatch — the ``workflow_id`` unique index rejects
// accidental double-inserts on idempotent retries. Rows are deliberately
// kept beyond workflow completion so historical status queries keep
// returning 403 (not 404) for non-owners.
// [Tier 1 item 1-5 / Plan 3 H-1]
export const ingestJobs = pgTable(
  "ingest_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workflowId: text("workflow_id").notNull().unique(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    // Coarse label for status-page filtering / ops dashboards. Deliberately
    // a plain text column rather than a pg enum so adding a new dispatch
    // path (e.g. "mobile-share") does not require a migration.
    source: text("source").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Owner lookups: "show me the user's recent ingest jobs" ordered newest first.
    index("ingest_jobs_user_created_idx").on(t.userId, t.createdAt),
    // Workspace-scoped ops view.
    index("ingest_jobs_workspace_created_idx").on(t.workspaceId, t.createdAt),
  ]
);

export type IngestJob = typeof ingestJobs.$inferSelect;
export type IngestJobInsert = typeof ingestJobs.$inferInsert;

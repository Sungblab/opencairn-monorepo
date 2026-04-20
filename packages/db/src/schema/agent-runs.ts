import { sql } from "drizzle-orm";
import { index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { projects } from "./projects";
import { user } from "./users";
import { workspaces } from "./workspaces";

// page_id is intentionally NOT foreign-keyed. The owning table (`pages` or
// `notes`) evolves across plans; keep this as a soft reference to avoid
// cross-plan migration ordering issues. Integrity is enforced at the
// application layer.
//
// parent_run_id is a self-reference (handoff tree). We also skip the FK here
// so a failed parent run's deletion path doesn't cascade-orphan its children
// unexpectedly — enforced at the application layer.

export const agentRuns = pgTable(
  "agent_runs",
  {
    runId: uuid("run_id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    pageId: uuid("page_id"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    agentName: text("agent_name").notNull(),
    parentRunId: uuid("parent_run_id"),
    workflowId: text("workflow_id").notNull(),

    // 'running' | 'completed' | 'failed' | 'awaiting_input'
    status: text("status").notNull(),
    startedAt: timestamp("started_at").notNull().defaultNow(),
    endedAt: timestamp("ended_at"),
    durationMs: integer("duration_ms"),

    totalTokensIn: integer("total_tokens_in").notNull().default(0),
    totalTokensOut: integer("total_tokens_out").notNull().default(0),
    totalTokensCached: integer("total_tokens_cached").notNull().default(0),
    totalCostKrw: integer("total_cost_krw").notNull().default(0),
    toolCallCount: integer("tool_call_count").notNull().default(0),
    modelCallCount: integer("model_call_count").notNull().default(0),

    errorClass: text("error_class"),
    errorMessage: text("error_message"),

    trajectoryUri: text("trajectory_uri").notNull(),
    trajectoryBytes: integer("trajectory_bytes").notNull().default(0),

    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("agent_runs_workspace_status_idx").on(
      t.workspaceId,
      t.status,
      t.startedAt.desc(),
    ),
    index("agent_runs_parent_idx")
      .on(t.parentRunId)
      .where(sql`${t.parentRunId} IS NOT NULL`),
    index("agent_runs_workflow_idx").on(t.workflowId),
  ],
);

export type AgentRun = typeof agentRuns.$inferSelect;
export type NewAgentRun = typeof agentRuns.$inferInsert;

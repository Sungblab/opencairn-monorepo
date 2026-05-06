import { relations, sql } from "drizzle-orm";
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
import { agentActionRiskEnum } from "./agent-actions";
import { projects } from "./projects";
import { user } from "./users";
import { workspaces } from "./workspaces";

export const agenticPlanStatusEnum = pgEnum("agentic_plan_status", [
  "draft",
  "approval_required",
  "queued",
  "running",
  "blocked",
  "completed",
  "failed",
  "cancelled",
]);

export const agenticPlanStepStatusEnum = pgEnum("agentic_plan_step_status", [
  "draft",
  "approval_required",
  "queued",
  "running",
  "blocked",
  "completed",
  "failed",
  "cancelled",
  "skipped",
]);

export const agenticPlanStepKindEnum = pgEnum("agentic_plan_step_kind", [
  "note.review_update",
  "document.generate",
  "file.export",
  "code.run",
  "code.repair",
  "import.retry",
  "agent.run",
  "manual.review",
]);

export const agenticPlans = pgTable(
  "agentic_plans",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    actorUserId: text("actor_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    goal: text("goal").notNull(),
    status: agenticPlanStatusEnum("status").notNull().default("approval_required"),
    target: jsonb("target").$type<Record<string, unknown>>().notNull().default({}),
    plannerKind: text("planner_kind").notNull().default("deterministic"),
    summary: text("summary").notNull(),
    currentStepOrdinal: integer("current_step_ordinal"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    index("agentic_plans_project_status_idx").on(t.projectId, t.status, t.updatedAt),
    index("agentic_plans_workspace_created_idx").on(t.workspaceId, t.createdAt),
    index("agentic_plans_goal_search_idx").using(
      "gin",
      sql`to_tsvector('simple', ${t.title} || ' ' || ${t.goal})`,
    ),
  ],
);

export const agenticPlanSteps = pgTable(
  "agentic_plan_steps",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => agenticPlans.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    kind: agenticPlanStepKindEnum("kind").notNull(),
    title: text("title").notNull(),
    rationale: text("rationale").notNull(),
    status: agenticPlanStepStatusEnum("status").notNull().default("approval_required"),
    risk: agentActionRiskEnum("risk").notNull().default("low"),
    input: jsonb("input").$type<Record<string, unknown>>().notNull().default({}),
    linkedRunType: text("linked_run_type"),
    linkedRunId: text("linked_run_id"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("agentic_plan_steps_plan_ordinal_idx").on(t.planId, t.ordinal),
    index("agentic_plan_steps_plan_status_idx").on(t.planId, t.status),
    index("agentic_plan_steps_linked_run_idx")
      .on(t.linkedRunType, t.linkedRunId)
      .where(sql`${t.linkedRunId} IS NOT NULL`),
  ],
);

export const agenticPlansRelations = relations(agenticPlans, ({ one, many }) => ({
  workspace: one(workspaces, {
    fields: [agenticPlans.workspaceId],
    references: [workspaces.id],
  }),
  project: one(projects, {
    fields: [agenticPlans.projectId],
    references: [projects.id],
  }),
  actor: one(user, {
    fields: [agenticPlans.actorUserId],
    references: [user.id],
  }),
  steps: many(agenticPlanSteps),
}));

export const agenticPlanStepsRelations = relations(agenticPlanSteps, ({ one }) => ({
  plan: one(agenticPlans, {
    fields: [agenticPlanSteps.planId],
    references: [agenticPlans.id],
  }),
}));

export type AgenticPlanRow = typeof agenticPlans.$inferSelect;
export type AgenticPlanInsert = typeof agenticPlans.$inferInsert;
export type AgenticPlanStepRow = typeof agenticPlanSteps.$inferSelect;
export type AgenticPlanStepInsert = typeof agenticPlanSteps.$inferInsert;

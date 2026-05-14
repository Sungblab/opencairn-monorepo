import { sql } from "drizzle-orm";
import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { projects } from "./projects";
import { user } from "./users";
import { workspaces } from "./workspaces";

export const taskFeedback = pgTable(
  "task_feedback",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    artifactId: uuid("artifact_id"),
    rating: text("rating").notNull(),
    reason: text("reason"),
    comment: text("comment"),
    followUpIntent: text("follow_up_intent"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("task_feedback_project_created_idx").on(t.projectId, t.createdAt),
    index("task_feedback_artifact_idx").on(t.artifactId),
    unique("task_feedback_target_user_unique").on(
      t.targetType,
      t.targetId,
      t.userId,
    ),
    check(
      "task_feedback_target_type_check",
      sql`${t.targetType} IN ('chat_run','workflow_run','agent_action','agent_file','document_generation')`,
    ),
    check(
      "task_feedback_rating_check",
      sql`${t.rating} IN ('useful','not_useful','skipped')`,
    ),
  ],
);

export type TaskFeedback = typeof taskFeedback.$inferSelect;
export type TaskFeedbackInsert = typeof taskFeedback.$inferInsert;

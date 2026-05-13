import { sql } from "drizzle-orm";
import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { projects } from "./projects";
import { user } from "./users";
import { workspaces } from "./workspaces";

export const agentActionStatusEnum = pgEnum("agent_action_status", [
  "draft",
  "approval_required",
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
  "expired",
  "reverted",
]);

export const agentActionRiskEnum = pgEnum("agent_action_risk", [
  "low",
  "write",
  "destructive",
  "external",
  "expensive",
]);

export const agentActionKindEnum = pgEnum("agent_action_kind", [
  "workflow.placeholder",
  "interaction.choice",
  "note.create",
  "note.create_from_markdown",
  "note.update",
  "note.rename",
  "note.move",
  "note.delete",
  "note.restore",
  "note.comment",
  "file.create",
  "file.update",
  "file.delete",
  "file.compile",
  "file.generate",
  "file.export",
  "import.upload",
  "import.markdown_zip",
  "import.drive",
  "import.notion",
  "import.literature",
  "import.web",
  "export.note",
  "export.project",
  "export.file",
  "export.workspace",
  "export.provider",
  "code_project.create",
  "code_project.patch",
  "code_project.rename",
  "code_project.delete",
  "code_project.install",
  "code_project.run",
  "code_project.preview",
  "code_project.package",
]);

export const agentActions = pgTable(
  "agent_actions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    requestId: uuid("request_id").notNull(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    actorUserId: text("actor_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    sourceRunId: text("source_run_id"),
    kind: agentActionKindEnum("kind").notNull(),
    status: agentActionStatusEnum("status").notNull().default("draft"),
    risk: agentActionRiskEnum("risk").notNull(),
    input: jsonb("input").$type<Record<string, unknown>>().notNull().default({}),
    preview: jsonb("preview").$type<Record<string, unknown>>(),
    result: jsonb("result").$type<Record<string, unknown>>(),
    errorCode: text("error_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("agent_actions_request_id_idx").on(
      t.projectId,
      t.actorUserId,
      t.requestId,
    ),
    index("agent_actions_project_status_idx").on(t.projectId, t.status, t.createdAt),
    index("agent_actions_workspace_created_idx").on(t.workspaceId, t.createdAt),
    index("agent_actions_source_run_idx")
      .on(t.sourceRunId)
      .where(sql`${t.sourceRunId} IS NOT NULL`),
  ],
);

export type AgentActionRow = typeof agentActions.$inferSelect;
export type AgentActionInsert = typeof agentActions.$inferInsert;

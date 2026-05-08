import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { ltree } from "./custom-types";
import { projects } from "./projects";
import { workspaces } from "./workspaces";

export const projectTreeNodeKindEnum = pgEnum("project_tree_node_kind", [
  "folder",
  "note",
  "agent_file",
  "code_workspace",
  "source_bundle",
  "artifact_group",
  "artifact",
]);

export const projectTreeTargetTableEnum = pgEnum("project_tree_target_table", [
  "folders",
  "notes",
  "agent_files",
  "code_workspaces",
]);

export const projectTreeNodes = pgTable(
  "project_tree_nodes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id").references(
      (): AnyPgColumn => projectTreeNodes.id,
      { onDelete: "cascade" },
    ),
    kind: projectTreeNodeKindEnum("kind").notNull(),
    targetTable: projectTreeTargetTableEnum("target_table"),
    targetId: uuid("target_id"),
    label: text("label").notNull(),
    icon: text("icon"),
    position: integer("position").notNull().default(0),
    path: ltree("path").notNull(),
    sourceWorkflowId: text("source_workflow_id"),
    sourceObjectKey: text("source_object_key"),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("project_tree_nodes_project_parent_idx").on(
      t.projectId,
      t.parentId,
      t.position,
      t.createdAt,
    ),
    index("project_tree_nodes_project_kind_idx").on(t.projectId, t.kind),
    index("project_tree_nodes_source_workflow_idx").on(t.sourceWorkflowId),
    uniqueIndex("project_tree_nodes_target_unique_idx")
      .on(t.targetTable, t.targetId)
      .where(sql`${t.targetTable} IS NOT NULL AND ${t.targetId} IS NOT NULL`),
    check(
      "project_tree_nodes_target_pair_check",
      sql`(${t.targetTable} IS NULL AND ${t.targetId} IS NULL) OR (${t.targetTable} IS NOT NULL AND ${t.targetId} IS NOT NULL)`,
    ),
  ],
);

export type ProjectTreeNode = typeof projectTreeNodes.$inferSelect;
export type NewProjectTreeNode = typeof projectTreeNodes.$inferInsert;

import { pgTable, uuid, text, timestamp, index, pgEnum } from "drizzle-orm/pg-core";
import { user } from "./users";
import { workspaces } from "./workspaces";

export const projectDefaultRoleEnum = pgEnum("project_default_role", ["editor", "viewer"]);

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").default(""),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    defaultRole: projectDefaultRoleEnum("default_role").notNull().default("editor"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    index("projects_workspace_id_idx").on(t.workspaceId),
    index("projects_created_by_idx").on(t.createdBy),
  ]
);

import { pgTable, uuid, text, timestamp, pgEnum, uniqueIndex } from "drizzle-orm/pg-core";
import { user } from "./users";
import { projects } from "./projects";

export const projectRoleEnum = pgEnum("project_role", ["editor", "viewer"]);

export const projectPermissions = pgTable(
  "project_permissions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: projectRoleEnum("role").notNull(),
    grantedBy: text("granted_by")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("project_permissions_unique").on(t.projectId, t.userId)]
);

import { pgTable, uuid, text, timestamp, boolean, pgEnum, uniqueIndex } from "drizzle-orm/pg-core";
import { user } from "./users";
import { notes } from "./notes";

export const pageRoleEnum = pgEnum("page_role", ["editor", "viewer", "none"]);

export const pagePermissions = pgTable(
  "page_permissions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    pageId: uuid("page_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: pageRoleEnum("role").notNull(),
    inheritParent: boolean("inherit_parent").notNull().default(true),
    grantedBy: text("granted_by")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("page_permissions_unique").on(t.pageId, t.userId)]
);

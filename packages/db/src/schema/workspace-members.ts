import { pgTable, uuid, text, timestamp, pgEnum, primaryKey, index } from "drizzle-orm/pg-core";
import { user } from "./users";
import { workspaces } from "./workspaces";

export const workspaceRoleEnum = pgEnum("workspace_role", ["owner", "admin", "member", "guest"]);

export const workspaceMembers = pgTable(
  "workspace_members",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: workspaceRoleEnum("role").notNull().default("member"),
    invitedBy: text("invited_by").references(() => user.id, { onDelete: "set null" }),
    joinedAt: timestamp("joined_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.userId] }),
    index("workspace_members_user_id_idx").on(t.userId),
    // Needed for FK SET NULL performance when a user who issued invites is
    // deleted — without this, the cascade falls back to a seq scan.
    index("workspace_members_invited_by_idx").on(t.invitedBy),
  ]
);

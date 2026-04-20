import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";
import { user } from "./users";
import { workspaces } from "./workspaces";
import { workspaceRoleEnum } from "./workspace-members";

export const workspaceInvites = pgTable(
  "workspace_invites",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: workspaceRoleEnum("role").notNull().default("member"),
    token: text("token").notNull().unique(),
    invitedBy: text("invited_by")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at").notNull(),
    acceptedAt: timestamp("accepted_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("workspace_invites_email_idx").on(t.email), index("workspace_invites_token_idx").on(t.token)]
);

import { sql } from "drizzle-orm";
import { pgTable, uuid, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
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
      .references(() => user.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at").notNull(),
    acceptedAt: timestamp("accepted_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("workspace_invites_email_idx").on(t.email),
    index("workspace_invites_token_idx").on(t.token),
    // invited_by needed for audit joins + FK SET NULL performance.
    index("workspace_invites_invited_by_idx").on(t.invitedBy),
    // Partial unique: forbids two open invites to the same (workspace, email)
    // pair, while still allowing a fresh invite after the prior one was
    // accepted (acceptedAt IS NOT NULL leaves the key outside the unique
    // set). Closes the email-bomb / race primitive in Plan 1 H-1.
    uniqueIndex("workspace_invites_ws_email_pending_idx")
      .on(t.workspaceId, t.email)
      .where(sql`${t.acceptedAt} IS NULL`),
  ]
);

import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces";
import { user } from "./users";

// Phase 4 chat thread root. One row per agent-panel conversation, scoped to
// a workspace + the user who owns it. We don't share threads cross-user yet
// (no team-chat in Phase 4), so cascading on user delete is safe — there is
// no other reader who would care about an orphaned thread.
//
// `archivedAt` is a soft delete: the agent-panel sidebar filters it out but
// audit/billing reconstruction can still walk old token usage.
export const chatThreads = pgTable(
  "chat_threads",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    // Better Auth user.id is text — keep FK column type aligned with users.ts.
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [
    index("chat_threads_workspace_id_idx").on(t.workspaceId),
    index("chat_threads_user_id_idx").on(t.userId),
    // Sidebar list query is "threads in this workspace ordered by recency",
    // which scans this composite directly and avoids a workspace-wide sort.
    index("chat_threads_updated_at_idx").on(t.workspaceId, t.updatedAt),
  ],
);

export type ChatThread = typeof chatThreads.$inferSelect;
export type ChatThreadInsert = typeof chatThreads.$inferInsert;

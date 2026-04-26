import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  pgEnum,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { user } from "./users";
import { notes } from "./notes";
import { workspaces } from "./workspaces";

// Plan 2C — public share links. Notion model: token = secret, no expiry,
// no password. Soft-revoke via revokedAt; partial index keeps the active
// token lookup O(1).
//
// `editor` role is reserved in the enum but the MVP UI only surfaces
// viewer/commenter (live editing requires Hocuspocus auth extension —
// follow-up plan).
export const shareRoleEnum = pgEnum("share_role", [
  "viewer",
  "commenter",
  "editor",
]);

export const shareLinks = pgTable(
  "share_links",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    noteId: uuid("note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    token: text("token").notNull(),
    role: shareRoleEnum("role").notNull().default("viewer"),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("share_links_token_unique").on(t.token),
    index("share_links_note_id_idx").on(t.noteId),
    index("share_links_workspace_id_idx").on(t.workspaceId),
    // Hot path: token validation against active links only.
    index("share_links_active_token_idx")
      .on(t.token)
      .where(sql`${t.revokedAt} IS NULL`),
    // Defence-in-depth for the application-level idempotency check in
    // POST /notes/:id/share. Two concurrent POSTs could otherwise pass
    // the SELECT and both INSERT, leaving the workspace with duplicate
    // active links for the same (note, role) pair. A partial unique
    // index forces the second writer to fail with a 23505, which the
    // route catches and downgrades to a re-fetch + reuse path.
    uniqueIndex("share_links_active_role_unique")
      .on(t.noteId, t.role)
      .where(sql`${t.revokedAt} IS NULL`),
  ],
);

export type ShareLink = typeof shareLinks.$inferSelect;
export type ShareLinkInsert = typeof shareLinks.$inferInsert;

import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  index,
  pgEnum,
  primaryKey,
} from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces";
import { notes } from "./notes";
import { user } from "./users";

export const mentionedTypeEnum = pgEnum("mentioned_type", [
  "user",
  "page",
  "concept",
  "date",
]);

export const comments = pgTable(
  "comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    noteId: uuid("note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    // Intentionally no FK: orphan replies are preferred over thread-nuking cascades.
    // Integrity enforced app-side.
    parentId: uuid("parent_id"),
    anchorBlockId: text("anchor_block_id"),
    authorId: text("author_id")
      .notNull()
      .references(() => user.id),
    body: text("body").notNull(),
    bodyAst: jsonb("body_ast"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedBy: text("resolved_by").references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("comments_note_id_idx").on(t.noteId, t.createdAt.desc()),
    index("comments_parent_id_idx")
      .on(t.parentId)
      .where(sql`${t.parentId} IS NOT NULL`),
    index("comments_anchor_idx")
      .on(t.noteId, t.anchorBlockId)
      .where(sql`${t.anchorBlockId} IS NOT NULL`),
  ]
);

export const commentMentions = pgTable(
  "comment_mentions",
  {
    commentId: uuid("comment_id")
      .notNull()
      .references(() => comments.id, { onDelete: "cascade" }),
    mentionedType: mentionedTypeEnum("mentioned_type").notNull(),
    mentionedId: text("mentioned_id").notNull(),
  },
  (t) => [
    primaryKey({
      columns: [t.commentId, t.mentionedType, t.mentionedId],
    }),
    index("comment_mentions_target_idx").on(t.mentionedType, t.mentionedId),
  ]
);

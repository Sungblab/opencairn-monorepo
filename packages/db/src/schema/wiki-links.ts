import {
  pgTable,
  uuid,
  timestamp,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { notes } from "./notes";
import { workspaces } from "./workspaces";

// Plan 5 Phase 1 — reverse index of wiki-link Plate nodes.
// Populated inline by Hocuspocus persistence.store on every flush; backfilled
// once via migration 0023. workspace_id mirrors the source note's workspace
// so backlinks queries can be workspace-scoped without a join through projects.
//
// FK ON DELETE CASCADE handles HARD-deletes only. Soft-deletes
// (`notes.deleted_at`) are filtered in API queries — see notes/:id/backlinks.
export const wikiLinks = pgTable(
  "wiki_links",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourceNoteId: uuid("source_note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    targetNoteId: uuid("target_note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique("wiki_links_source_target_unique").on(t.sourceNoteId, t.targetNoteId),
    index("wiki_links_target_idx").on(t.targetNoteId),
    index("wiki_links_workspace_idx").on(t.workspaceId),
  ]
);

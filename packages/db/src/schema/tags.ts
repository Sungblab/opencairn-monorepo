import { pgTable, uuid, text, timestamp, index, primaryKey } from "drizzle-orm/pg-core";
import { projects } from "./projects";
import { notes } from "./notes";

export const tags = pgTable(
  "tags",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color").default("#6b7280"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("tags_project_id_idx").on(t.projectId)]
);

export const noteTags = pgTable(
  "note_tags",
  {
    noteId: uuid("note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.noteId, t.tagId] })]
);

import {
  pgTable,
  uuid,
  text,
  real,
  integer,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { projects } from "./projects";
import { concepts } from "./concepts";
import { notes } from "./notes";
import { user } from "./users";

export const flashcards = pgTable(
  "flashcards",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    conceptId: uuid("concept_id").references(() => concepts.id, {
      onDelete: "set null",
    }),
    noteId: uuid("note_id").references(() => notes.id, {
      onDelete: "set null",
    }),
    deckName: text("deck_name").notNull().default("default"),
    front: text("front").notNull(),
    back: text("back").notNull(),
    easeFactor: real("ease_factor").notNull().default(2.5),
    intervalDays: integer("interval_days").notNull().default(1),
    nextReview: timestamp("next_review").notNull().defaultNow(),
    reviewCount: integer("review_count").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("flashcards_project_id_idx").on(t.projectId),
    index("flashcards_next_review_idx").on(t.projectId, t.nextReview),
  ]
);

export const reviewLogs = pgTable("review_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  flashcardId: uuid("flashcard_id")
    .notNull()
    .references(() => flashcards.id, { onDelete: "cascade" }),
  rating: integer("rating").notNull(),
  reviewedAt: timestamp("reviewed_at").notNull().defaultNow(),
});

export const understandingScores = pgTable(
  "understanding_scores",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    conceptId: uuid("concept_id")
      .notNull()
      .references(() => concepts.id, { onDelete: "cascade" }),
    score: real("score").notNull().default(0),
    lastAssessed: timestamp("last_assessed").notNull().defaultNow(),
  },
  (t) => [index("understanding_scores_user_id_idx").on(t.userId)]
);

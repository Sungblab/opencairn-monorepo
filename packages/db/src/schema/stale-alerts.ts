import { pgTable, uuid, real, text, timestamp, index } from "drizzle-orm/pg-core";
import { notes } from "./notes";

export const staleAlerts = pgTable(
  "stale_alerts",
  {
    id:             uuid("id").defaultRandom().primaryKey(),
    noteId:         uuid("note_id").notNull().references(() => notes.id, { onDelete: "cascade" }),
    stalenessScore: real("staleness_score").notNull(),
    reason:         text("reason").notNull(),
    detectedAt:     timestamp("detected_at", { withTimezone: true }).notNull().defaultNow(),
    reviewedAt:     timestamp("reviewed_at", { withTimezone: true }),
  },
  (t) => [
    index("stale_alerts_note_idx").on(t.noteId),
  ]
);

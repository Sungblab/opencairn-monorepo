import {
  pgTable,
  uuid,
  text,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { projects } from "./projects";

// project_semaphore_slots — row-count semaphore for per-project agent
// concurrency control (Plan 4 Task 8). Each active slot is one row; capacity
// is enforced at acquire time by counting non-expired rows for the project
// and rejecting inserts that would exceed `max_concurrent`.
//
// Why a table instead of a Temporal mutex workflow:
//   1. Worker cannot touch Postgres directly (architectural rule) — mutex
//      state must live behind the internal API either way.
//   2. A mutex workflow per project multiplies long-running workflows and
//      adds signal-queue complexity without buying us anything beyond what a
//      counted-slot table already gives us.
//   3. `expires_at` is a crash-safety belt: if a holder process dies before
//      calling release, the slot frees itself automatically after N minutes
//      so the project doesn't deadlock.
export const projectSemaphoreSlots = pgTable(
  "project_semaphore_slots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    // Opaque holder identifier supplied by the worker — usually the
    // Temporal workflow id (e.g. "compiler-<noteId>" or "research-<uuid>").
    holderId: text("holder_id").notNull(),
    // Human-readable purpose string ("compiler" / "research" / ...). Useful
    // when surfacing "project X is busy running Compiler" in the UI later.
    purpose: text("purpose").notNull(),
    acquiredAt: timestamp("acquired_at").notNull().defaultNow(),
    // Hard expiry — acquire activity requests N minutes, workflow-side
    // heartbeat renews the slot if it approaches this deadline. See
    // `/api/internal/semaphores/acquire`.
    expiresAt: timestamp("expires_at").notNull(),
  },
  (t) => [
    index("project_semaphore_slots_project_idx").on(t.projectId, t.expiresAt),
    // One holder_id never holds two slots for the same project — acquire
    // uses ON CONFLICT on this index to make the operation idempotent.
    uniqueIndex("project_semaphore_slots_holder_idx").on(
      t.projectId,
      t.holderId,
    ),
  ],
);

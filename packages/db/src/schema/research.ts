import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { user } from "./users";
import { workspaces } from "./workspaces";
import { projects } from "./projects";
import { notes } from "./notes";
import {
  researchStatusEnum,
  researchModelEnum,
  researchTurnRoleEnum,
  researchTurnKindEnum,
  researchArtifactKindEnum,
  researchBillingPathEnum,
} from "./enums";

// One row per Deep Research run. workflowId mirrors id so Temporal lookups
// stay idempotent — the API layer starts the workflow with id=runId and
// stores the value here for introspection on replay. noteId is populated
// only when status transitions to completed.
export const researchRuns = pgTable(
  "research_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    // Better Auth user.id is text, not uuid — FK type must match. See
    // packages/db/src/schema/user-preferences.ts for the same pattern.
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    topic: text("topic").notNull(),
    model: researchModelEnum("model").notNull(),
    billingPath: researchBillingPathEnum("billing_path").notNull(),
    status: researchStatusEnum("status").notNull().default("planning"),
    // Google Interactions resource id for the current (or last) interaction.
    // Chained via previous_interaction_id on each new turn so Google stitches
    // context across planning ↔ iteration ↔ execution.
    currentInteractionId: text("current_interaction_id"),
    approvedPlanText: text("approved_plan_text"),
    // Always equals id today — stored explicitly so introspection tools don't
    // need to know the mapping, and future migrations (e.g. re-run with new
    // workflow id) have a clean place to diverge.
    workflowId: text("workflow_id").notNull(),
    noteId: uuid("note_id").references(() => notes.id, {
      onDelete: "set null",
    }),
    error: jsonb("error").$type<{
      code: string;
      message: string;
      retryable: boolean;
    }>(),
    totalCostUsdCents: integer("total_cost_usd_cents"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    index("research_runs_workspace_status_idx").on(t.workspaceId, t.status),
    index("research_runs_user_created_idx").on(t.userId, t.createdAt),
  ],
);

// Turn = one user or agent message. seq monotonically increases per run so
// the UI can render the conversation in order without relying on createdAt
// (which can collide under fast iteration).
export const researchRunTurns = pgTable(
  "research_run_turns",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => researchRuns.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    role: researchTurnRoleEnum("role").notNull(),
    kind: researchTurnKindEnum("kind").notNull(),
    // Google interaction id this turn produced (plan_proposal) or was sent
    // against (user_feedback). Null for user_edit (purely local) and approval.
    interactionId: text("interaction_id"),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("research_run_turns_run_seq_idx").on(t.runId, t.seq)],
);

// Artifact = one streamed event during executing. seq monotonic per run.
// Kept for debug + cost reconstruction; persist_report reads them back when
// materializing the final note. Cascaded on run delete so forgotten runs
// don't leak artifacts.
export const researchRunArtifacts = pgTable(
  "research_run_artifacts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => researchRuns.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    kind: researchArtifactKindEnum("kind").notNull(),
    // Shapes by kind (informal — no JSON schema today):
    //   thought_summary: { text: string }
    //   text_delta:      { text: string }
    //   image:           { url: string, mimeType: string, base64?: string }
    //   citation:        { sourceUrl: string, title: string }
    payload: jsonb("payload").notNull().$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("research_run_artifacts_run_seq_idx").on(t.runId, t.seq),
  ],
);

export type ResearchRun = typeof researchRuns.$inferSelect;
export type ResearchRunInsert = typeof researchRuns.$inferInsert;
export type ResearchRunTurn = typeof researchRunTurns.$inferSelect;
export type ResearchRunTurnInsert = typeof researchRunTurns.$inferInsert;
export type ResearchRunArtifact = typeof researchRunArtifacts.$inferSelect;
export type ResearchRunArtifactInsert =
  typeof researchRunArtifacts.$inferInsert;

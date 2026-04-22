import { pgEnum } from "drizzle-orm/pg-core";

export const userPlanEnum = pgEnum("user_plan", ["free", "pro", "byok"]);

export const noteTypeEnum = pgEnum("note_type", ["note", "wiki", "source"]);

export const sourceTypeEnum = pgEnum("source_type", [
  "manual",
  "pdf",
  "audio",
  "video",
  "image",
  "youtube",
  "web",
  "notion",
  "unknown",
]);

export const integrationProviderEnum = pgEnum("integration_provider", [
  "google_drive",
]);

export const importSourceEnum = pgEnum("import_source", [
  "google_drive",
  "notion_zip",
]);

export const jobStatusEnum = pgEnum("job_status", [
  "queued",
  "running",
  "completed",
  "failed",
]);

export const wikiActionEnum = pgEnum("wiki_action", [
  "create",
  "update",
  "merge",
  "link",
  "unlink",
]);

export const conversationScopeEnum = pgEnum("conversation_scope", [
  "project",
  "global",
]);

export const messageRoleEnum = pgEnum("message_role", ["user", "assistant"]);

// OpenAI is intentionally excluded (2026-04-15 decision — see
// docs/superpowers/specs/2026-04-13-multi-llm-provider-design.md). Enforced
// at DB layer so API routes can't write a string the factory will reject
// at request time.
export const llmProviderEnum = pgEnum("llm_provider_kind", ["gemini", "ollama"]);

// Plan 3b batch-embedding lifecycle. Values mirror
// packages/llm/src/llm/batch_types.py BATCH_STATE_* constants so Python and
// TypeScript sides can round-trip without a lookup table. `timeout` is
// OpenCairn-specific (caller gave up waiting) and has no provider state.
export const embeddingBatchStateEnum = pgEnum("embedding_batch_state", [
  "pending",
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "expired",
  "timeout",
]);

// Deep Research (Spec 2026-04-22) — run lifecycle.
// Most values map 1:1 to a Google Interactions API state. Exceptions:
// - awaiting_approval: local UX state (plan received, user hasn't approved yet)
// - cancelled: user cancel OR 24h abandonment timeout (distinguished via error.code)
export const researchStatusEnum = pgEnum("research_status", [
  "planning",
  "awaiting_approval",
  "researching",
  "completed",
  "failed",
  "cancelled",
]);

// Two models exposed to users (spec §2). Adding a new Google model = new enum
// value + UI gate by availability date. No backfill needed since model column
// is immutable per run.
export const researchModelEnum = pgEnum("research_model", [
  "deep-research-preview-04-2026",
  "deep-research-max-preview-04-2026",
]);

// Turn record role. `system` reserved for future audit entries (retry / policy
// notes from the workflow itself).
export const researchTurnRoleEnum = pgEnum("research_turn_role", [
  "system",
  "user",
  "agent",
]);

// Turn record kind. `plan_proposal` comes from the agent; the other 3 are
// user-originated so the UI can render them differently.
export const researchTurnKindEnum = pgEnum("research_turn_kind", [
  "plan_proposal",
  "user_feedback",
  "user_edit",
  "approval",
]);

// Artifact kind — one row per streamed event we want to preserve for debug
// and report reconstruction. Matches the subset of Google InteractionEvent
// kinds that carry persistable payloads.
export const researchArtifactKindEnum = pgEnum("research_artifact_kind", [
  "thought_summary",
  "text_delta",
  "image",
  "citation",
]);

// Billing path (spec §7). Populated at run creation, immutable thereafter.
// Managed runs further require FEATURE_MANAGED_DEEP_RESEARCH=true; otherwise
// the workflow fails fast with error.code=managed_disabled.
export const researchBillingPathEnum = pgEnum("research_billing_path", [
  "byok",
  "managed",
]);

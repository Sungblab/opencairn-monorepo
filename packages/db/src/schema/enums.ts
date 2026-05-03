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
  "markdown",
  "unknown",
  "canvas",
  "paper",
]);

// Plan 7 Canvas Phase 1 — language pinned at note creation. The CHECK on
// `notes` enforces `canvasLanguage IS NOT NULL ↔ sourceType = 'canvas'`,
// so adding a value here without a matching runtime route is harmless but
// every value MUST have a sandbox runtime in apps/web.
export const canvasLanguageEnum = pgEnum("canvas_language", [
  "python",
  "javascript",
  "html",
  "react",
]);

export const integrationProviderEnum = pgEnum("integration_provider", [
  "google_drive",
]);

export const importSourceEnum = pgEnum("import_source", [
  "google_drive",
  "notion_zip",
  "markdown_zip",
  "literature_search",
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

// Chat schema (conversations/messages tables + conversation_scope/message_role
// enums) was a Plan 1 stub that never had any code referencing it. Plan 11A
// (`2026-04-20-plan-11a-chat-scope-foundation.md`) replaces the table shape
// entirely — new `scope_type` enum with `['page','project','workspace']`,
// separate `scopeType`+`scopeId` columns, plus rag_mode/chips/memory_flags.
// Removed here (migration 0019) so Plan 11A starts from a clean slate.

// Phase 4 (App Shell agent panel, plan 2026-04-23) reintroduces a slimmer
// chat schema — `chat_threads` + `chat_messages` + `message_feedback`. The
// new `message_role` enum drops the legacy `assistant` value in favour of
// `agent` (matches the rest of the runtime/UI vocabulary).
export const messageRoleEnum = pgEnum("message_role", ["user", "agent"]);

// Streaming persistence states for chat-messages.ts `status` column.
//   `streaming` → placeholder inserted before SSE emits, so a crash mid-
//                 stream leaves a row we can recover instead of a ghost.
//   `complete`  → stream ended cleanly (the steady-state value).
//   `failed`    → pipeline threw; partial buffer preserved for retry UI.
export const messageStatusEnum = pgEnum("message_status", [
  "streaming",
  "complete",
  "failed",
]);

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

// App Shell Phase 5 Task 9 — notification kinds. New rows MUST add a
// matching renderer branch in apps/web NotificationItem; an unmapped kind
// renders the raw payload summary which is fine but unbranded.
export const notificationKindEnum = pgEnum("notification_kind", [
  "mention",
  "comment_reply",
  "research_complete",
  "share_invite",
  "system",
]);

// Email-dispatcher cadence per notification kind (Plan 2 Task 14, 2026-04-29).
// instant       → next dispatcher tick (≤ 90s)
// digest_15min  → flushed at every quarter-hour wallclock boundary
// digest_daily  → flushed at 09:00 in the user's timezone
export const notificationFrequencyEnum = pgEnum("notification_frequency", [
  "instant",
  "digest_15min",
  "digest_daily",
]);

export const mcpServerStatusEnum = pgEnum("mcp_server_status", [
  "active",
  "disabled",
  "auth_expired",
]);

export const connectorProviderEnum = pgEnum("connector_provider", [
  "google_drive",
  "github",
  "notion",
  "mcp_custom",
]);

export const connectorAuthTypeEnum = pgEnum("connector_auth_type", [
  "oauth",
  "pat",
  "static_header",
  "none",
]);

export const connectorAccountStatusEnum = pgEnum("connector_account_status", [
  "active",
  "disabled",
  "auth_expired",
  "revoked",
]);

export const connectorSourceKindEnum = pgEnum("connector_source_kind", [
  "drive_folder",
  "drive_file",
  "github_repo",
  "notion_workspace",
  "notion_page_tree",
  "mcp_server",
]);

export const connectorSyncModeEnum = pgEnum("connector_sync_mode", [
  "one_shot",
  "manual_resync",
  "scheduled",
]);

export const connectorSourceStatusEnum = pgEnum("connector_source_status", [
  "active",
  "disabled",
  "auth_expired",
  "deleted",
]);

export const connectorJobTypeEnum = pgEnum("connector_job_type", [
  "import",
  "sync",
  "refresh_tools",
  "preview",
]);

export const connectorRiskLevelEnum = pgEnum("connector_risk_level", [
  "safe_read",
  "import",
  "write",
  "destructive",
  "external_send",
  "unknown",
]);

export const connectorExternalObjectTypeEnum = pgEnum(
  "connector_external_object_type",
  [
    "file",
    "folder",
    "page",
    "database",
    "repo",
    "issue",
    "pull_request",
    "comment",
    "action_run",
    "code_file",
    "mcp_result",
  ],
);

// Plan 8 — Connector/Curator/Synthesis agents surface actionable insights as
// suggestions. `type` encodes which agent produced the row and what the user
// should do; `status` tracks the lifecycle through acceptance or dismissal.
export const suggestionTypeEnum = pgEnum("suggestion_type", [
  "connector_link",
  "curator_orphan",
  "curator_duplicate",
  "curator_contradiction",
  "curator_external_source",
  "synthesis_insight",
]);

export const suggestionStatusEnum = pgEnum("suggestion_status", [
  "pending",
  "accepted",
  "rejected",
  "expired",
]);

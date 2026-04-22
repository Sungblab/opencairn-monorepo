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
  "unknown",
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

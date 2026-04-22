import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "./users";
import { bytea } from "./custom-types";
import { llmProviderEnum } from "./enums";

// Per-user LLM provider configuration. Gemini by default; switch to Ollama
// for fully-local BYOK stacks. `openai` is intentionally not supported
// (2026-04-15 decision — see docs/superpowers/specs/2026-04-13-multi-llm-provider-design.md).
export const userPreferences = pgTable("user_preferences", {
  // Better Auth user.id is text, not uuid — FK type must match.
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  llmProvider: llmProviderEnum("llm_provider").notNull().default("gemini"),
  llmModel: text("llm_model").notNull().default("gemini-3-flash-preview"),
  embedModel: text("embed_model").notNull().default("gemini-embedding-001"),
  ttsModel: text("tts_model"),
  ollamaBaseUrl: text("ollama_base_url"),
  // Deep Research (Spec 2026-04-22) BYOK key. AES-256-GCM encrypted, wire
  // layout iv(12)||tag(16)||ct — same scheme as user_integrations so the
  // existing worker decrypt helper round-trips. Nullable until the user
  // registers a key via Settings (Phase D).
  byokApiKeyEncrypted: bytea("byok_api_key_encrypted"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type UserPreferences = typeof userPreferences.$inferSelect;
export type UserPreferencesInsert = typeof userPreferences.$inferInsert;

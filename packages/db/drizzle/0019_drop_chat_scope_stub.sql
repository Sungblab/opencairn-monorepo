-- Drop the Plan 1 chat stub: `conversations` + `messages` tables plus their
-- `conversation_scope` + `message_role` enums. Zero code references (never
-- wired since foundation). Plan 11A
-- (`docs/superpowers/plans/2026-04-20-plan-11a-chat-scope-foundation.md`)
-- redefines the entire schema from scratch with a `scope_type` enum
-- (`['page','project','workspace']`), split `scopeType`+`scopeId` columns,
-- `ragMode`, `attachedChips`, `memoryFlags`, and a fuller `message_role`
-- ENUM incl. 'system'/'tool'. Dropping now resolves the `conversation_scope`
-- drift flagged by the 2026-04-25 cross-doc audit.
DROP TABLE IF EXISTS "messages" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "conversations" CASCADE;--> statement-breakpoint
DROP TYPE IF EXISTS "public"."conversation_scope";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."message_role";
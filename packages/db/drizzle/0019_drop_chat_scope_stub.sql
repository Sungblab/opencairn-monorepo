-- Drop the original chat stub: `conversations` + `messages` tables plus their
-- `conversation_scope` + `message_role` enums. Zero code references (never
-- wired since foundation). Scoped chat redefines the entire schema with a
-- `scope_type` enum
-- (`['page','project','workspace']`), split `scopeType`+`scopeId` columns,
-- `ragMode`, `attachedChips`, `memoryFlags`, and a fuller `message_role`
-- ENUM incl. 'system'/'tool'. Dropping now resolves the `conversation_scope`
-- drift found during cross-doc review.
DROP TABLE IF EXISTS "messages" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "conversations" CASCADE;--> statement-breakpoint
DROP TYPE IF EXISTS "public"."conversation_scope";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."message_role";

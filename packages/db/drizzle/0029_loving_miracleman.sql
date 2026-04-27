CREATE TYPE "public"."conversation_message_role" AS ENUM('user', 'assistant', 'system', 'tool');--> statement-breakpoint
CREATE TYPE "public"."rag_mode" AS ENUM('strict', 'expand');--> statement-breakpoint
CREATE TYPE "public"."scope_type" AS ENUM('page', 'project', 'workspace');--> statement-breakpoint
CREATE TABLE "conversation_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" "conversation_message_role" NOT NULL,
	"content" text NOT NULL,
	"citations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tokens_in" bigint,
	"tokens_out" bigint,
	"cost_krw" numeric(12, 4),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"owner_user_id" text NOT NULL,
	"title" text,
	"scope_type" "scope_type" NOT NULL,
	"scope_id" text NOT NULL,
	"attached_chips" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rag_mode" "rag_mode" DEFAULT 'strict' NOT NULL,
	"memory_flags" jsonb DEFAULT '{"l3_global":true,"l3_workspace":true,"l4":true,"l2":false}'::jsonb NOT NULL,
	"session_memory_md" text,
	"full_summary" text,
	"total_tokens_in" bigint DEFAULT 0 NOT NULL,
	"total_tokens_out" bigint DEFAULT 0 NOT NULL,
	"total_cost_krw" numeric(12, 4) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pinned_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid NOT NULL,
	"note_id" uuid NOT NULL,
	"block_id" text NOT NULL,
	"pinned_by" text NOT NULL,
	"reason" text,
	"pinned_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pinned_answers" ADD CONSTRAINT "pinned_answers_message_id_conversation_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."conversation_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pinned_answers" ADD CONSTRAINT "pinned_answers_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pinned_answers" ADD CONSTRAINT "pinned_answers_pinned_by_user_id_fk" FOREIGN KEY ("pinned_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversation_messages_convo_time_idx" ON "conversation_messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "conversations_owner_recent_idx" ON "conversations" USING btree ("workspace_id","owner_user_id","updated_at");--> statement-breakpoint
CREATE INDEX "conversations_scope_recent_idx" ON "conversations" USING btree ("scope_type","scope_id","updated_at");--> statement-breakpoint
CREATE INDEX "pinned_answers_note_idx" ON "pinned_answers" USING btree ("note_id");